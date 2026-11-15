import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listInstances, writeFileAtomic } from "@atom-neo/shared";
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

export function findPackage(sandbox: string, id: string, version: string): PackageRecord | undefined {
  return ownRecord(readRegistry(sandbox), id, version);
}

/**
 * Register one installed package version. Identical content is idempotent and keeps the original
 * record; a different target/path/sha256 at the same version is rejected.
 */
export function registerPackage(sandbox: string, registration: PackageRegistration): PackageRecord {
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
}

/**
 * Remove one registry entry after checking package clients. Package files are left in place;
 * uninstall owns their cleanup.
 */
export function removePackage(sandbox: string, id: string, version: string): void {
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

  const remaining = Object.fromEntries(Object.entries(versions).filter(([current]) => current !== version));
  const packages = Object.keys(remaining).length === 0
    ? Object.fromEntries(Object.entries(registry.packages).filter(([current]) => current !== id))
    : { ...registry.packages, [id]: remaining };
  writeRegistry(sandbox, { version: 1, packages });
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
