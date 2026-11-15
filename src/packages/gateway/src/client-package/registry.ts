import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import type { Stats } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { listInstances, withFileLock, writeFileAtomic } from "@atom-neo/shared";
import type { FileLockOptions } from "@atom-neo/shared";
import { z } from "zod";

/** One installed package version recorded in `.atom/gateway/packages.json`. */
export type PackageRecord = {
  target: string;
  /** Package root relative to the sandbox, e.g. `.atom/gateway/packages/id/version/target`. */
  path: string;
  source: string;
  installedAt: string;
  /** SHA-256 of the archive contents; distinguishes same-version/different-content installs. */
  sha256: string;
};

export type PackageRegistry = {
  version: 1;
  packages: Record<string, Record<string, PackageRecord>>;
};

export type PackageRegistration = {
  id: string;
  version: string;
  target: string;
  path: string;
  source: string;
  sha256: string;
  installedAt?: string;
};

export type RegistryLockOptions = { lock?: FileLockOptions };

export type RemovePackageOptions = RegistryLockOptions & { removeFiles?: boolean };

export type RemovePackageResult = {
  record: PackageRecord;
  /** `leftover` means the registry entry is gone but the renamed package directory remains. */
  files: "retained" | "removed" | "missing" | "leftover";
  leftoverPath?: string;
};

const DEFAULT_LOCK_TIMEOUT_MS = 5_000;
const DEFAULT_LOCK_RETRY_MS = 25;

const PackageRecordSchema = z.strictObject({
  target: z.string().min(1),
  path: z.string().min(1),
  source: z.string().min(1),
  installedAt: z.string().min(1),
  sha256: z.string().min(1),
});

const PackageRegistrySchema = z.strictObject({
  version: z.literal(1),
  packages: z.record(z.string(), z.record(z.string(), PackageRecordSchema)),
});

export function registryPath(sandbox: string): string {
  return join(sandbox, ".atom", "gateway", "packages.json");
}

function registryLockPath(sandbox: string): string {
  return join(sandbox, ".atom", "gateway", "packages.lock");
}

/**
 * Serialize a registry read-modify-write across processes. The lock is not reclaimed automatically:
 * if a process crashes while holding it, remove `.atom/gateway/packages.lock` manually after
 * confirming no process still owns it.
 */
function withRegistryLock<T>(sandbox: string, options: RegistryLockOptions, action: () => T): T {
  const lockPath = registryLockPath(sandbox);
  return withFileLock(lockPath, action, {
    timeoutMs: DEFAULT_LOCK_TIMEOUT_MS,
    retryMs: DEFAULT_LOCK_RETRY_MS,
    lockedMessage: `Package registry is locked: ${lockPath}`,
    ...options.lock,
  });
}

function parseRegistry(path: string, text: string): PackageRegistry {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid packages.json at ${path}: ${reason}`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`Invalid packages.json at ${path}: expected a JSON object`);
  }
  const version = (raw as Record<string, unknown>).version;
  if (version !== 1) {
    throw new Error(`Unsupported packages.json version at ${path}: ${JSON.stringify(version)}`);
  }

  const result = PackageRegistrySchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "<root>"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid packages.json at ${path}: ${issues}`);
  }
  return result.data;
}

/** Read the registry; a missing file is an empty v1 registry. */
export function readRegistry(sandbox: string): PackageRegistry {
  const path = registryPath(sandbox);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, packages: {} };
    throw error;
  }
  return parseRegistry(path, text);
}

function writeRegistry(sandbox: string, registry: PackageRegistry): void {
  writeFileAtomic(registryPath(sandbox), `${JSON.stringify(registry, null, 2)}\n`);
}

function ownVersions(registry: PackageRegistry, id: string): Record<string, PackageRecord> | undefined {
  return Object.hasOwn(registry.packages, id) ? registry.packages[id] : undefined;
}

function ownRecord(registry: PackageRegistry, id: string, version: string): PackageRecord | undefined {
  const versions = ownVersions(registry, id);
  return versions !== undefined && Object.hasOwn(versions, version) ? versions[version] : undefined;
}

function withoutPackage(registry: PackageRegistry, id: string, version: string): PackageRegistry {
  const versions = ownVersions(registry, id)!;
  const remaining = Object.fromEntries(Object.entries(versions).filter(([current]) => current !== version));
  const packages = Object.keys(remaining).length === 0
    ? Object.fromEntries(Object.entries(registry.packages).filter(([current]) => current !== id))
    : { ...registry.packages, [id]: remaining };
  return { version: 1, packages };
}

/** Resolve `record.path` and reject anything that is absolute or outside the sandbox. */
function resolvePackageDir(sandbox: string, record: PackageRecord): string {
  if (isAbsolute(record.path) || /^[A-Za-z]:/.test(record.path)) {
    throw new Error(`Cannot remove package files: package path must be relative to the sandbox: ${record.path}`);
  }

  const root = resolve(sandbox);
  const directory = resolve(root, record.path);
  const path = relative(root, directory);
  if (path === "") {
    throw new Error(`Cannot remove package files: package path must not be the sandbox root: ${record.path}`);
  }
  if (path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw new Error(`Cannot remove package files: package path is outside the sandbox: ${record.path}`);
  }
  return directory;
}

export function findPackage(sandbox: string, id: string, version: string): PackageRecord | undefined {
  return ownRecord(readRegistry(sandbox), id, version);
}

/**
 * Register one installed package version. Identical content is idempotent and keeps the original
 * record; a different target/path/sha256 at the same version is rejected.
 */
export function registerPackage(
  sandbox: string,
  registration: PackageRegistration,
  options: RegistryLockOptions = {},
): PackageRecord {
  return withRegistryLock(sandbox, options, () => {
    const registry = readRegistry(sandbox);
    const existing = ownRecord(registry, registration.id, registration.version);
    if (existing) {
      if (
        existing.target === registration.target
        && existing.path === registration.path
        && existing.sha256 === registration.sha256
      ) {
        return existing;
      }
      throw new Error(`Package ${registration.id}@${registration.version} already installed with different content`);
    }

    const record: PackageRecord = {
      target: registration.target,
      path: registration.path,
      source: registration.source,
      installedAt: registration.installedAt ?? new Date().toISOString(),
      sha256: registration.sha256,
    };
    const versions = { ...(ownVersions(registry, registration.id) ?? {}), [registration.version]: record };
    writeRegistry(sandbox, {
      version: 1,
      packages: { ...registry.packages, [registration.id]: versions },
    });
    return record;
  });
}

/**
 * Remove one registry entry after checking package clients. Package files are kept unless
 * `removeFiles` is true; deletion renames the directory aside first so a registry write failure
 * can restore it.
 */
export function removePackage(
  sandbox: string,
  id: string,
  version: string,
  options: RemovePackageOptions = {},
): RemovePackageResult {
  return withRegistryLock(sandbox, options, (): RemovePackageResult => {
    const registry = readRegistry(sandbox);
    const versions = ownVersions(registry, id);
    if (!versions || !Object.hasOwn(versions, version)) {
      throw new Error(`Package ${id}@${version} is not installed`);
    }

    for (const client of listInstances(sandbox)) {
      if (client.package?.id === id && client.package.version === version) {
        throw new Error(`Package ${id}@${version} is referenced by client ${client.id}`);
      }
    }

    const record = versions[version]!;
    const updated = withoutPackage(registry, id, version);

    if (options.removeFiles !== true) {
      writeRegistry(sandbox, updated);
      return { record, files: "retained" };
    }

    const directory = resolvePackageDir(sandbox, record);
    let stat: Stats | undefined;
    try {
      stat = lstatSync(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (stat === undefined) {
      writeRegistry(sandbox, updated);
      return { record, files: "missing" };
    }
    if (!stat.isDirectory()) {
      throw new Error(`Cannot remove package files: package path is not a directory: ${record.path}`);
    }

    const trashRoot = join(resolve(sandbox), ".atom", "gateway", "tmp");
    mkdirSync(trashRoot, { recursive: true });
    const trash = join(trashRoot, `uninstall-${randomUUID()}`);
    renameSync(directory, trash);
    try {
      writeRegistry(sandbox, updated);
    } catch (error) {
      try {
        renameSync(trash, directory);
      } catch {
        // Best effort only: the registry write error is the actionable failure.
      }
      throw error;
    }

    try {
      rmSync(trash, { recursive: true, force: false });
      return { record, files: "removed" };
    } catch {
      return { record, files: "leftover", leftoverPath: trash };
    }
  });
}

/** All installed packages in deterministic id-then-version order. */
export function listPackages(sandbox: string): { id: string; version: string; record: PackageRecord }[] {
  const { packages } = readRegistry(sandbox);
  const entries: { id: string; version: string; record: PackageRecord }[] = [];
  for (const id of Object.keys(packages).sort()) {
    for (const version of Object.keys(packages[id]!).sort()) {
      entries.push({ id, version, record: packages[id]![version]! });
    }
  }
  return entries;
}
