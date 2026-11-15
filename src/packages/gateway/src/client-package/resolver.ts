import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  INSTANCE_CREDENTIAL_PREFIX,
  clientSource,
  createChildProcessEnv,
} from "@atom-neo/shared";
import type { ClientConfig, ClientSource } from "@atom-neo/shared";
import { ENV_NAME_PATTERN, parseManifest, resolveEntry } from "./manifest";
import type { Manifest } from "./manifest";
import { findPackage } from "./registry";

const RESERVED_ENTRY_ARGS = new Set(["--secret", "--port", "--gateway-url"]);

export type ResolvedClientConfig = {
  id: string;
  platform: string;
  command: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  clientArgs?: Record<string, string>;
  stdio: "inherit" | "ignore";
  source: ClientSource;
};

export type ResolveOptions = {
  packageRoot: (id: string, version: string) => string;
  /** Base for relative `directory` sources; defaults to process.cwd(). */
  baseDir?: string;
  readEnv?: (key: string) => string | undefined;
  baseEnv?: NodeJS.ProcessEnv;
};

function describeSource(source: ClientSource): string {
  return source.type === "package"
    ? `package ${source.id}@${source.version}`
    : `directory ${source.directory}`;
}

function clientError(config: ClientConfig, source: ClientSource, message: string): Error {
  return new Error(`Client ${config.id} (${describeSource(source)}): ${message}`);
}

function readManifest(config: ClientConfig, source: ClientSource, root: string): Manifest {
  const path = join(root, "manifest.json");
  try {
    return parseManifest(readFileSync(path, "utf-8"));
  } catch (error) {
    throw clientError(config, source, `${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function buildClientEnv(config: ClientConfig, manifest: Manifest, options: ResolveOptions): NodeJS.ProcessEnv {
  const readEnv = options.readEnv ?? ((key: string) => process.env[key]);
  const injected: NodeJS.ProcessEnv = {};

  for (const [field, declared] of Object.entries(manifest.config ?? {})) {
    if (!declared.required) continue;
    if (declared.secret) {
      if (config.credentials?.[field] === undefined) {
        throw new Error(`Client ${config.id} is missing required credential ${field}`);
      }
    } else if (config.clientArgs?.[field] === undefined) {
      throw new Error(`Client ${config.id} is missing required argument --${field}`);
    }
  }

  for (const [field, ref] of Object.entries(config.credentials ?? {})) {
    if (ref === "ATOM_ADMIN_TOKEN") {
      throw new Error(`Client ${config.id} credential ${field} must not reference ATOM_ADMIN_TOKEN`);
    }
    if (!ref.startsWith(INSTANCE_CREDENTIAL_PREFIX)) {
      throw new Error(
        `Client ${config.id} credential ${field} must reference an ${INSTANCE_CREDENTIAL_PREFIX}* variable`,
      );
    }
    if (!ENV_NAME_PATTERN.test(ref)) {
      throw new Error(`Client ${config.id} credential ${field} has invalid env name "${ref}"`);
    }

    const declared = manifest.config?.[field];
    if (!declared) {
      throw new Error(`Client ${config.id} credential ${field} is not declared in the manifest`);
    }
    if (!declared.secret) {
      throw new Error(`Client ${config.id} credential ${field} is not a secret manifest field`);
    }
    if (!declared.env) {
      throw new Error(`Client ${config.id} credential ${field} has no env declaration`);
    }
    if (!ENV_NAME_PATTERN.test(declared.env)) {
      throw new Error(`Client ${config.id} credential ${field} has invalid env name "${declared.env}"`);
    }
    if (declared.env === "ATOM_ADMIN_TOKEN" || declared.env.startsWith(INSTANCE_CREDENTIAL_PREFIX)) {
      throw new Error(`Client ${config.id} credential ${field} must not write to reserved env ${declared.env}`);
    }

    const value = readEnv(ref);
    if (!value) throw new Error(`Client ${config.id} missing credential ${ref}`);
    injected[declared.env] = value;
  }

  return createChildProcessEnv(options.baseEnv ?? process.env, injected);
}

export function resolveClient(config: ClientConfig, options: ResolveOptions): ResolvedClientConfig {
  const source = clientSource(config);
  let root: string;
  try {
    root = source.type === "package"
      ? options.packageRoot(source.id, source.version)
      : resolve(options.baseDir ?? process.cwd(), source.directory);
  } catch (error) {
    throw clientError(config, source, error instanceof Error ? error.message : String(error));
  }
  const manifestPath = join(root, "manifest.json");
  const manifest = readManifest(config, source, root);

  if (source.type === "package") {
    if (manifest.id !== source.id) {
      throw clientError(
        config,
        source,
        `${manifestPath}: manifest id "${manifest.id}" does not match package id "${source.id}"`,
      );
    }
    if (manifest.version !== source.version) {
      throw clientError(
        config,
        source,
        `${manifestPath}: manifest version "${manifest.version}" does not match package version "${source.version}"`,
      );
    }
  }

  let command: readonly string[];
  try {
    command = resolveEntry(manifest, source.type);
  } catch (error) {
    throw clientError(
      config,
      source,
      `${manifestPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const reserved = command.find((argument) => RESERVED_ENTRY_ARGS.has(argument.split("=")[0]!));
  if (reserved) {
    throw clientError(config, source, `entry must not define reserved argument ${reserved}`);
  }

  return {
    id: config.id,
    platform: manifest.platform,
    command,
    cwd: root,
    env: buildClientEnv(config, manifest, options),
    ...(config.clientArgs === undefined ? {} : { clientArgs: config.clientArgs }),
    stdio: config.stdio ?? "inherit",
    source,
  };
}

export function resolveClients(
  configs: readonly ClientConfig[],
  options: ResolveOptions,
): ResolvedClientConfig[] {
  const seen = new Set<string>();
  for (const config of configs) {
    if (seen.has(config.id)) throw new Error(`Duplicate gateway client id: ${config.id}`);
    seen.add(config.id);
  }
  return configs.map((config) => resolveClient(config, options));
}

/**
 * Registry-backed package lookup. Packages must be registered; a package for another host
 * target is rejected even if its directory happens to exist.
 */
export function sandboxPackageRoot(sandbox: string): (id: string, version: string) => string {
  return (id, version) => {
    const installed = findPackage(sandbox, id, version);
    if (!installed) {
      throw new Error(`Client package ${id}@${version} is not installed in ${sandbox}`);
    }

    const target = `${process.platform}-${process.arch}`;
    if (installed.target !== target) {
      throw new Error(
        `Client package ${id}@${version} target "${installed.target}" is not supported on ${target}`,
      );
    }

    const root = join(sandbox, installed.path);
    if (!existsSync(join(root, "manifest.json"))) {
      throw new Error(`Client package ${id}@${version} is registered but missing at ${root}`);
    }
    return root;
  };
}
