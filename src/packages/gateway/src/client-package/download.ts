import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isAllowedSourceUrl, sourceUrlError } from "./source-url";

export type DownloadArtifact = {
  url: string;
  sha256: string;
  size?: number;
};

export type DownloadOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
  /** Parent dir for the temporary download dir; defaults to os.tmpdir(). */
  tempDir?: string;
};

export type DownloadedArtifact = {
  path: string;
  sha256: string;
  size: number;
  cleanup: () => void;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const TEMP_PREFIX = "atom-client-download-";
const FILE_NAME = "artifact.tar.gz";

function isAbortError(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === "AbortError" || name === "TimeoutError";
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The body may already be errored or locked; cleanup happens via the caller.
  }
}

/**
 * Download `artifact.url` into a unique temp directory and verify its sha256.
 *
 * The response body is streamed to disk while hashing, enforcing `maxBytes`.
 * Any failure removes the temp directory before the error is rethrown.
 */
export async function downloadVerifiedArtifact(
  artifact: DownloadArtifact,
  options: DownloadOptions = {},
): Promise<DownloadedArtifact> {
  if (!isAllowedSourceUrl(artifact.url)) throw sourceUrlError(artifact.url);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const fetchImpl = options.fetchImpl ?? fetch;
  const signal = AbortSignal.timeout(timeoutMs);
  const tempDir = mkdtempSync(join(options.tempDir ?? tmpdir(), TEMP_PREFIX));
  const path = join(tempDir, FILE_NAME);

  try {
    const hash = createHash("sha256");
    let size = 0;

    try {
      const response = await fetchImpl(artifact.url, { signal });
      if (response.status < 200 || response.status > 299) {
        await discardBody(response);
        throw new Error(`Download failed with HTTP ${response.status} for ${artifact.url}`);
      }

      const declared = Number.parseInt(response.headers.get("content-length") ?? "", 10);
      if (Number.isFinite(declared) && declared > maxBytes) {
        await discardBody(response);
        throw new Error(`Download exceeds maximum size of ${maxBytes} bytes for ${artifact.url}`);
      }

      const body = response.body;
      if (body === null) throw new Error(`Download response has no body for ${artifact.url}`);

      const handle = await open(path, "wx", 0o600);
      try {
        const reader = body.getReader();
        let finished = false;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;

            size += value.byteLength;
            if (size > maxBytes) {
              throw new Error(`Download exceeds maximum size of ${maxBytes} bytes for ${artifact.url}`);
            }

            hash.update(value);
            for (let offset = 0; offset < value.byteLength; ) {
              const { bytesWritten } = await handle.write(value, offset, value.byteLength - offset);
              offset += bytesWritten;
            }
          }
          finished = true;
        } finally {
          if (!finished) await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (signal.aborted || isAbortError(error)) {
        throw new Error(`Download timed out after ${timeoutMs}ms`, { cause: error });
      }
      throw error;
    }

    const actual = hash.digest("hex");
    if (actual !== artifact.sha256) {
      throw new Error(
        `Checksum mismatch for ${artifact.url}: expected ${artifact.sha256}, got ${actual}`,
      );
    }

    return {
      path,
      sha256: actual,
      size,
      cleanup: () => rmSync(tempDir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
}
