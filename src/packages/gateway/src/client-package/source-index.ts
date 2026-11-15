import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { z } from "zod";

/** One downloadable client archive in a Gateway source index. */
export type SourceIndexEntry = {
  id: string;
  version: string;
  target: string;
  url: string;
  sha256: string;
  size?: number;
};

/** Official source index v1. */
export type SourceIndex = { version: 1; entries: SourceIndexEntry[] };

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const TARGET_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const SHA256_PATTERN = /^[a-fA-F0-9]{64}$/;
const HTTP_LOCATION_PATTERN = /^https?:\/\//i;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 1024 * 1024;

const SourceIndexEntrySchema = z.strictObject({
  id: z.string().min(1, "source index id must not be empty"),
  version: z.string().regex(VERSION_PATTERN, "source index version must use major.minor.patch"),
  target: z.string().regex(TARGET_PATTERN, "source index target must use lowercase letters, digits, or hyphens"),
  url: z
    .url("source index url must be a valid URL")
    .refine((url) => /^https?:\/\//i.test(url), "source index url must use http or https"),
  sha256: z
    .string()
    .regex(SHA256_PATTERN, "source index sha256 must be 64 hexadecimal characters")
    .transform((value) => value.toLowerCase()),
  size: z.number().int("source index size must be an integer").positive("source index size must be positive").optional(),
});

const SourceIndexSchema = z.strictObject({
  version: z.literal(1),
  entries: z.array(SourceIndexEntrySchema),
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function indexError(location: string, message: string): Error {
  return new Error(`Invalid source index at ${location}: ${message}`);
}

function loadError(location: string, message: string): never {
  throw new Error(`Cannot load source index at ${location}: ${message}`);
}

function validateSourceIndex(raw: unknown, location: string): SourceIndex {
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    const version = (raw as Record<string, unknown>).version;
    if (version !== 1) throw indexError(location, `unsupported version ${JSON.stringify(version)}`);
  }

  const result = SourceIndexSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "<root>"}: ${issue.message}`)
      .join("; ");
    throw indexError(location, issues);
  }

  const seen = new Set<string>();
  for (const entry of result.data.entries) {
    const key = `${entry.id}\u0000${entry.version}\u0000${entry.target}`;
    if (seen.has(key)) throw indexError(location, `duplicate entry ${entry.id}@${entry.version} (${entry.target})`);
    seen.add(key);
  }
  return result.data;
}

function versionParts(version: string): [number, number, number] {
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(`Invalid source version "${version}": expected major.minor.patch`);
  }
  const [major, minor, patch] = version.split(".").map(Number);
  return [major!, minor!, patch!];
}

/** Parse and validate a source index document. */
export function parseSourceIndex(text: string, location = "source index"): SourceIndex {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw indexError(location, `invalid JSON: ${errorMessage(error)}`);
  }
  return validateSourceIndex(raw, location);
}

/**
 * Load a source index from an http(s) URL or a local file. HTTP loads are bounded by
 * `maxBytes` and `timeoutMs`; every error names the original location.
 */
export async function loadSourceIndex(
  location: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number; maxBytes?: number } = {},
): Promise<SourceIndex> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  if (HTTP_LOCATION_PATTERN.test(location)) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const fetchImpl = options.fetchImpl ?? fetch;
    let response: Response;
    try {
      response = await fetchImpl(location, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      loadError(location, timedOut ? `request timed out after ${timeoutMs}ms` : errorMessage(error));
    }

    if (!response.ok) {
      loadError(location, `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`);
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength !== null) {
      const length = Number(contentLength);
      if (Number.isFinite(length) && length > maxBytes) {
        loadError(location, `response exceeds ${maxBytes} bytes (content-length ${length})`);
      }
    }

    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      loadError(location, errorMessage(error));
    }
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes > maxBytes) loadError(location, `response exceeds ${maxBytes} bytes (${bytes} bytes)`);
    return parseSourceIndex(text, location);
  }

  let text: string;
  try {
    text = readFileSync(resolve(location), "utf8");
  } catch (error) {
    loadError(location, errorMessage(error));
  }
  return parseSourceIndex(text, location);
}

/** Compare semantic `major.minor.patch` versions numerically. */
export function compareSourceVersions(a: string, b: string): number {
  const left = versionParts(a);
  const right = versionParts(b);
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index]! < right[index]! ? -1 : 1;
  }
  return 0;
}

/**
 * Select an archive for `id`, resolving the highest version when `version` is omitted.
 * The default target is the current host.
 */
export function selectSourceEntry(
  index: SourceIndex,
  request: { id: string; version?: string; target?: string },
): SourceIndexEntry {
  const target = request.target ?? `${process.platform}-${process.arch}`;
  const idEntries = index.entries.filter((entry) => entry.id === request.id);
  if (idEntries.length === 0) throw new Error(`Unknown source package "${request.id}"`);

  const candidates = idEntries.filter((entry) => entry.target === target);
  if (candidates.length === 0) {
    throw new Error(`Unsupported target "${target}" for source package "${request.id}"`);
  }

  if (request.version !== undefined) {
    const exact = candidates.find((entry) => entry.version === request.version);
    if (exact === undefined) {
      throw new Error(
        `Source package ${request.id}@${request.version} is not available for target ${target}`,
      );
    }
    return exact;
  }

  return candidates.reduce((best, entry) =>
    compareSourceVersions(entry.version, best.version) > 0 ? entry : best,
  );
}

/** Hash an archive and build a validated index entry for `baseUrl`. */
export async function createSourceIndexEntry(options: {
  archivePath: string;
  baseUrl: string;
  id: string;
  version: string;
  target: string;
}): Promise<SourceIndexEntry> {
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(options.archivePath);
  } catch (error) {
    throw new Error(`Cannot read source archive at ${options.archivePath}: ${errorMessage(error)}`);
  }

  const filename = basename(options.archivePath);
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const entry: SourceIndexEntry = {
    id: options.id,
    version: options.version,
    target: options.target,
    url: `${baseUrl}/${filename}`,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.byteLength,
  };
  return sourceIndexDocument([entry]).entries[0]!;
}

/** Build a validated source index document, rejecting duplicate id/version/target triples. */
export function sourceIndexDocument(entries: readonly SourceIndexEntry[]): SourceIndex {
  return validateSourceIndex({ version: 1, entries: [...entries] }, "source index document");
}
