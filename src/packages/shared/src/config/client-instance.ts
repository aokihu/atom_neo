import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { upsertEnv } from "../utils/env-file";
import { writeFileAtomic } from "../utils/fs";
import { ClientConfigSchema, type ClientConfig } from "./client";
import { ConfigSchema } from "./schema";

export type InstanceWriteResult = {
  saved: true;
  applied: false;
  configPath: string;
  envPath?: string;
};

/** Injectable writer for rollback tests; production uses writeFileAtomic. */
export type InstanceFileWriter = typeof writeFileAtomic;
export type InstanceWriteOptions = { writeFile?: InstanceFileWriter };

type JsonObject = Record<string, unknown>;
type FileSnapshot = { exists: boolean; content: string; mode?: number };
type ConfigMutation = { config: JsonObject; secrets?: Record<string, string> };

const CREDENTIAL_PREFIX = "ATOM_CLIENT_";
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function gatewayDir(sandbox: string): string {
  return join(sandbox, ".atom", "gateway");
}

function configFile(sandbox: string): string {
  return join(sandbox, "config.json");
}

function envFile(sandbox: string): string {
  return join(sandbox, ".env");
}

function stateFile(sandbox: string): string {
  return join(gatewayDir(sandbox), "state.json");
}

function snapshot(path: string): FileSnapshot {
  try {
    return {
      exists: true,
      content: readFileSync(path, "utf8"),
      mode: statSync(path).mode & 0o777,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false, content: "" };
    throw error;
  }
}

function parseConfig(path: string, file: FileSnapshot): JsonObject {
  if (!file.exists) return ConfigSchema.parse({}) as unknown as JsonObject;
  let value: unknown;
  try {
    value = JSON.parse(file.content);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid config.json at ${path}: ${reason}`);
  }
  if (!isRecord(value)) throw new Error(`Invalid config.json at ${path}: expected a JSON object`);
  return value;
}

function readGateway(config: JsonObject): JsonObject {
  if (config.gateway === undefined) return {};
  if (!isRecord(config.gateway)) throw new Error('Invalid config.json: "gateway" must be an object');
  return config.gateway;
}

function readClients(gateway: JsonObject): unknown[] {
  if (gateway.clients === undefined) return [];
  if (!Array.isArray(gateway.clients)) throw new Error('Invalid config.json: "gateway.clients" must be an array');
  return gateway.clients;
}

function revisionOf(file: FileSnapshot): number {
  if (!file.exists) return 0;
  try {
    const state: unknown = JSON.parse(file.content);
    if (!isRecord(state)) return 0;
    const revision = state.configRevision;
    return typeof revision === "number" && Number.isInteger(revision) && revision >= 0 ? revision : 0;
  } catch {
    return 0;
  }
}

function restore(path: string, file: FileSnapshot, writeFile: InstanceFileWriter): void {
  if (file.exists) writeFile(path, file.content, file.mode === undefined ? {} : { mode: file.mode });
  else rmSync(path, { force: true });
}

function withLock<T>(sandbox: string, action: () => T): T {
  const directory = gatewayDir(sandbox);
  mkdirSync(directory, { recursive: true });
  const lockPath = join(directory, "config.lock");

  let descriptor: number;
  try {
    descriptor = openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`Gateway config is locked: ${lockPath}`);
    }
    throw error;
  }

  try {
    try {
      writeFileSync(descriptor, `${process.pid}\n`, "utf8");
    } finally {
      closeSync(descriptor);
    }
    return action();
  } finally {
    rmSync(lockPath, { force: true });
  }
}

function commit(
  sandbox: string,
  mutate: (config: JsonObject) => ConfigMutation,
  options: InstanceWriteOptions = {},
): InstanceWriteResult {
  const configPath = configFile(sandbox);
  const envPath = envFile(sandbox);
  const statePath = stateFile(sandbox);
  const writeFile = options.writeFile ?? writeFileAtomic;

  return withLock(sandbox, () => {
    const previousConfig = snapshot(configPath);
    const previousEnv = snapshot(envPath);
    const previousState = snapshot(statePath);
    const config = parseConfig(configPath, previousConfig);
    const mutation = mutate(config);
    const revision = revisionOf(previousState) + 1;

    let envTouched = false;
    let configTouched = false;
    let stateTouched = false;
    try {
      if (mutation.secrets && Object.keys(mutation.secrets).length > 0) {
        writeFile(envPath, upsertEnv(previousEnv.content, mutation.secrets), { mode: 0o600 });
        envTouched = true;
      }
      writeFile(configPath, `${JSON.stringify(mutation.config, null, 2)}\n`);
      configTouched = true;
      writeFile(statePath, `${JSON.stringify({ version: 1, configRevision: revision })}\n`);
      stateTouched = true;
    } catch (error) {
      const rollbacks: Array<[string, FileSnapshot, boolean]> = [
        [envPath, previousEnv, envTouched],
        [configPath, previousConfig, configTouched],
        [statePath, previousState, stateTouched],
      ];
      const failures: string[] = [];
      for (const [path, file, touched] of rollbacks) {
        if (!touched) continue;
        try {
          restore(path, file, writeFile);
        } catch (rollbackError) {
          failures.push(`${path}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
        }
      }
      if (failures.length > 0) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`${reason} (rollback failed for ${failures.join("; ")})`, { cause: error });
      }
      throw error;
    }

    return {
      saved: true,
      applied: false,
      configPath,
      ...(envTouched ? { envPath } : {}),
    };
  });
}

function normalizedPart(value: string, label: string): string {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (normalized === "") throw new Error(`Cannot build a credential reference: ${label} is empty after normalization`);
  return normalized;
}

/** Canonical sandbox env name for a client credential field. */
export function credentialRef(instanceId: string, field: string): string {
  return `${CREDENTIAL_PREFIX}${normalizedPart(instanceId, "instance id")}_${normalizedPart(field, "field")}`;
}

function validateCredentialRef(field: string, ref: string): void {
  if (
    !ref.startsWith(CREDENTIAL_PREFIX)
    || !ENV_NAME.test(ref)
    || !/[A-Za-z0-9]/.test(ref.slice(CREDENTIAL_PREFIX.length))
  ) {
    throw new Error(
      `Invalid credential reference for field "${field}": expected an env name starting with ${CREDENTIAL_PREFIX}`,
    );
  }
}

function parseClientEntry(entry: unknown, index: number): ClientConfig {
  const parsed = ClientConfigSchema.safeParse(entry);
  if (parsed.success) return parsed.data;
  const id = isRecord(entry) && entry.id !== undefined ? ` (id: ${String(entry.id)})` : "";
  const details = parsed.error.issues
    .map(issue => `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid gateway client at index ${index}${id}: ${details}`);
}

function assertUniqueCredentialRefs(clients: readonly unknown[]): void {
  const owners = new Map<string, string>();
  for (const entry of clients) {
    if (!isRecord(entry) || typeof entry.id !== "string" || !isRecord(entry.credentials)) continue;
    for (const [field, ref] of Object.entries(entry.credentials)) {
      if (typeof ref !== "string") continue;
      const owner = `${entry.id}.${field}`;
      const previous = owners.get(ref);
      if (previous) throw new Error(`Credential reference ${ref} is shared by ${previous} and ${owner}`);
      owners.set(ref, owner);
    }
  }
}

/** Read gateway clients from config.json, reporting invalid entries instead of hiding them. */
export function listInstances(sandbox: string): ClientConfig[] {
  const path = configFile(sandbox);
  const config = parseConfig(path, snapshot(path));
  return readClients(readGateway(config)).map(parseClientEntry);
}

/** Current config revision; missing or malformed state counts as 0. */
export function readConfigRevision(sandbox: string): number {
  return revisionOf(snapshot(stateFile(sandbox)));
}

/**
 * Add or replace one gateway client, optionally writing its secrets to `.env`.
 * The config, env, and state files are rolled back if any write fails.
 */
export function upsertInstance(
  sandbox: string,
  instance: ClientConfig,
  secrets: Record<string, string> = {},
  options: InstanceWriteOptions = {},
): InstanceWriteResult {
  const parsed = ClientConfigSchema.parse(instance);
  const credentials = { ...(parsed.credentials ?? {}) };
  for (const [field, ref] of Object.entries(credentials)) validateCredentialRef(field, ref);

  const envUpdates: Record<string, string> = {};
  for (const [field, value] of Object.entries(secrets)) {
    const ref = credentialRef(parsed.id, field);
    credentials[field] = ref;
    envUpdates[ref] = value;
  }

  const next: ClientConfig = Object.keys(credentials).length > 0 ? { ...parsed, credentials } : parsed;

  return commit(sandbox, config => {
    const gateway = readGateway(config);
    const clients = [...readClients(gateway)];
    clients.forEach(parseClientEntry);
    const index = clients.findIndex(entry => isRecord(entry) && entry.id === next.id);
    if (index === -1) clients.push(next);
    else clients[index] = next;
    assertUniqueCredentialRefs(clients);
    return { config: { ...config, gateway: { ...gateway, clients } }, secrets: envUpdates };
  }, options);
}

/** Remove one gateway client without deleting its credential values from `.env`. */
export function removeInstance(sandbox: string, id: string, options: InstanceWriteOptions = {}): void {
  commit(sandbox, config => {
    const gateway = readGateway(config);
    const clients = readClients(gateway);
    const index = clients.findIndex(entry => isRecord(entry) && entry.id === id);
    if (index === -1) throw new Error(`Unknown client instance: ${id}`);
    return {
      config: { ...config, gateway: { ...gateway, clients: clients.filter((_, current) => current !== index) } },
    };
  }, options);
}
