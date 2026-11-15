import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { upsertInstance } from "@atom-neo/shared";
import type { ClientConfig, InstanceWriteResult } from "@atom-neo/shared";
import { parseManifest } from "./manifest";
import type { Manifest } from "./manifest";
import { findPackage } from "./registry";

export type ConfigureInstanceSource =
  | { type: "package"; id: string; version: string }
  | { type: "directory"; path: string };

export type ConfigureInstanceInput = {
  sandbox: string;
  id: string;
  source: ConfigureInstanceSource;
  values?: Record<string, string>;
  stdio?: "inherit" | "ignore";
};

export type ConfigureInstanceResult = InstanceWriteResult & {
  manifest: Manifest;
  client: ClientConfig;
};

type PackageSource = Extract<ConfigureInstanceSource, { type: "package" }>;

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readManifest(root: string): Manifest {
  const path = join(root, "manifest.json");
  try {
    return parseManifest(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read client manifest at ${path}: ${reasonOf(error)}`);
  }
}

function packageSource(sandbox: string, source: PackageSource): { root: string; manifest: Manifest } {
  const record = findPackage(sandbox, source.id, source.version);
  if (record === undefined) {
    throw new Error(`Client package ${source.id}@${source.version} is not installed in ${sandbox}`);
  }

  const root = join(sandbox, record.path);
  const path = join(root, "manifest.json");
  const manifest = readManifest(root);
  if (manifest.id !== source.id) {
    throw new Error(`${path}: manifest id "${manifest.id}" does not match package id "${source.id}"`);
  }
  if (manifest.version !== source.version) {
    throw new Error(
      `${path}: manifest version "${manifest.version}" does not match package version "${source.version}"`,
    );
  }
  if (manifest.target === undefined) {
    throw new Error(`${path}: manifest target is missing; installed packages must be target-stamped`);
  }
  if (manifest.target !== record.target) {
    throw new Error(
      `${path}: manifest target "${manifest.target}" does not match installed target "${record.target}"`,
    );
  }
  return { root, manifest };
}

function resolveSource(
  sandbox: string,
  source: ConfigureInstanceSource,
): { root: string; manifest: Manifest } {
  if (source.type === "package") return packageSource(sandbox, source);
  const root = resolve(sandbox, source.path);
  return { root, manifest: readManifest(root) };
}

function mapValues(
  id: string,
  manifest: Manifest,
  values: Record<string, string>,
): { clientArgs: Record<string, string>; secrets: Record<string, string> } {
  const clientArgs: Record<string, string> = {};
  const secrets: Record<string, string> = {};

  for (const [name, field] of Object.entries(manifest.config ?? {})) {
    let value: string | undefined = values[name];
    // Required fields need an explicit value; manifest defaults only fill optional fields.
    if (value === undefined && !field.secret && !field.required) value = field.default;

    if (value === undefined || value === "") {
      if (!field.required) continue;
      throw new Error(
        field.secret
          ? `Client ${id} is missing required credential ${name}`
          : `Client ${id} is missing required argument --${name}`,
      );
    }

    if (field.enum !== undefined && !field.enum.includes(value)) {
      const target = field.secret ? `credential ${name}` : `argument --${name}`;
      throw new Error(`Client ${id} ${target} must be one of: ${field.enum.join(", ")}`);
    }

    if (field.secret) secrets[name] = value;
    else clientArgs[name] = value;
  }

  return { clientArgs, secrets };
}

/**
 * Validate and persist one offline Gateway client instance.
 * Secrets go through `upsertInstance`, which writes normalized credential refs;
 * no process is started, so the result is always `applied: false`.
 */
export function configureInstance(input: ConfigureInstanceInput): ConfigureInstanceResult {
  const { root, manifest } = resolveSource(input.sandbox, input.source);
  const { clientArgs, secrets } = mapValues(input.id, manifest, input.values ?? {});

  const client: ClientConfig = {
    id: input.id,
    ...(input.source.type === "package"
      ? { package: { id: input.source.id, version: input.source.version } }
      : { directory: root }),
    ...(Object.keys(clientArgs).length > 0 ? { clientArgs } : {}),
    stdio: input.stdio ?? "inherit",
  };

  return {
    ...upsertInstance(input.sandbox, client, secrets),
    manifest,
    client,
  };
}
