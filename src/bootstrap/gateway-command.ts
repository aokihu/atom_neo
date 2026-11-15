import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  installClient,
  listPackages,
  packClient,
  parseManifest,
  removePackage,
  resolveEntry,
} from "@atom-neo/gateway";
import type { Manifest } from "@atom-neo/gateway";
import { upsertInstance } from "@atom-neo/shared";
import type { BootArguments, GatewayCommand } from "./cli";
import { readRuntimeFile } from "./runtime-file";

export type GatewayCommandDeps = {
  fetchImpl?: typeof fetch;
  stdout?: (line: string) => void;
  /** Base for relative install/load/pack targets; defaults to process.cwd(). */
  cwd?: string;
};

type JsonRecord = Record<string, unknown>;
type Print = (line: string) => void;

const ADMIN_TOKEN_HEADER = "x-atom-admin-token";

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readManifest(root: string): Manifest {
  const path = join(root, "manifest.json");
  try {
    return parseManifest(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read client manifest at ${path}: ${reasonOf(error)}`);
  }
}

/** Non-secret manifest defaults are safe to persist; required fields without a value are never fabricated. */
function defaultClientArgs(manifest: Manifest): Record<string, string> {
  const args: Record<string, string> = {};
  for (const [name, field] of Object.entries(manifest.config ?? {})) {
    if (!field.secret && field.default !== undefined) args[name] = field.default;
  }
  return args;
}

function requiredSecretFields(manifest: Manifest): string[] {
  return Object.entries(manifest.config ?? {})
    .filter(([, field]) => field.required && field.secret)
    .map(([name]) => name);
}

function resolveUninstallTarget(sandbox: string, target: string): { id: string; version: string } {
  const at = target.indexOf("@");
  if (at !== -1) {
    const id = target.slice(0, at);
    const version = target.slice(at + 1);
    if (!id || !version || version.includes("@")) {
      throw new Error(`Invalid package target "${target}"; expected <id> or <id>@<version>`);
    }
    return { id, version };
  }

  const versions = listPackages(sandbox).filter(entry => entry.id === target).map(entry => entry.version);
  if (versions.length === 0) throw new Error(`Package ${target} is not installed`);
  if (versions.length > 1) {
    throw new Error(
      `Package ${target} has multiple installed versions (${versions.join(", ")}); specify ${target}@<version>`,
    );
  }
  return { id: target, version: versions[0]! };
}

function notRunning(sandbox: string): Error {
  return new Error(`Gateway is not running for sandbox ${sandbox}; start it with --mode core-gateway`);
}

function runtimeFor(sandbox: string) {
  try {
    return readRuntimeFile(sandbox, "gateway");
  } catch {
    throw notRunning(sandbox);
  }
}

async function adminRequest(
  args: Pick<BootArguments, "sandbox">,
  deps: GatewayCommandDeps,
  path: string,
  init: { method: "GET" | "POST"; body?: string },
): Promise<string> {
  const runtime = runtimeFor(args.sandbox);
  const headers: Record<string, string> = { [ADMIN_TOKEN_HEADER]: runtime.token };
  if (init.body !== undefined) headers["content-type"] = "application/json";

  let response: Response;
  try {
    response = await (deps.fetchImpl ?? fetch)(`${runtime.url.replace(/\/+$/, "")}${path}`, {
      method: init.method,
      headers,
      ...(init.body === undefined ? {} : { body: init.body }),
    });
  } catch {
    throw notRunning(args.sandbox);
  }

  let text: string;
  try {
    text = await response.text();
  } catch {
    throw notRunning(args.sandbox);
  }

  if (!response.ok) {
    const detail = text.trim() || response.statusText || "no response body";
    throw new Error(`Gateway admin request failed (${response.status}): ${detail}`);
  }
  return text;
}

function parseAdminJson(text: string): unknown {
  try {
    return text.length === 0 ? null : JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON from Gateway admin API: ${reasonOf(error)}`);
  }
}

function clientsOf(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (isRecord(body) && Array.isArray(body.clients)) return body.clients;
  throw new Error("Unexpected Gateway client list response");
}

function formatClient(client: unknown): string {
  if (!isRecord(client)) return String(client);

  const parts = [String(client.id ?? "unknown")];
  const state = client.state
    ?? (client.running === true ? "running" : client.running === false ? "idle" : undefined);
  if (state !== undefined) parts.push(String(state));

  const source = client.source;
  if (isRecord(source)) {
    if (source.type === "package") parts.push(`package ${String(source.id)}@${String(source.version)}`);
    else if (source.type === "directory") parts.push(`directory ${String(source.directory)}`);
  }

  if (client.platform !== undefined) parts.push(String(client.platform));
  if (client.port !== undefined) parts.push(`port ${client.port}`);
  return parts.join("  ");
}

function firstArray(...values: unknown[]): unknown[] | undefined {
  return values.find((value): value is unknown[] => Array.isArray(value));
}

/** Accept the flat and nested diagnostic response shapes used by the admin API. */
function diagnosticsView(body: unknown): { events: unknown[]; client: unknown } {
  if (Array.isArray(body)) return { events: body, client: undefined };
  if (!isRecord(body)) return { events: [], client: undefined };

  const nested = isRecord(body.diagnostics) ? body.diagnostics : undefined;
  const events = firstArray(body.events, body.diagnostics, nested?.events) ?? [];
  const client = body.client
    ?? body.clientDiagnostics
    ?? nested?.client
    ?? (body.checks !== undefined || typeof body.status === "string" ? body : undefined);
  return { events, client };
}

function formatEvent(event: unknown): string {
  if (!isRecord(event)) return String(event);

  const prefix = [event.at, event.level, event.stage]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ");
  const message = typeof event.message === "string" ? event.message : JSON.stringify(event);
  return prefix ? `${prefix}: ${message}` : message;
}

function printEvents(events: readonly unknown[], print: Print): void {
  for (const event of events) print(formatEvent(event));
}

function clientStatus(client: unknown): string {
  if (client === undefined || client === null) return "unavailable";
  if (typeof client === "string") return client;
  if (!isRecord(client)) return String(client);
  if (typeof client.status === "string") {
    if (client.status === "unreachable" && typeof client.error === "string") {
      return `unreachable (${client.error})`;
    }
    return client.status;
  }
  if (client.ok === true) return "ok";
  if (client.ok === false) return "failed";
  if (Array.isArray(client.checks)) return "ok";
  return "unknown";
}

function printChecks(client: unknown, print: Print): void {
  if (!isRecord(client) || !Array.isArray(client.checks)) return;

  for (const check of client.checks) {
    if (!isRecord(check)) {
      print(`  ${String(check)}`);
      continue;
    }
    const name = String(check.name ?? check.id ?? "check");
    const status = check.ok === true ? "ok" : check.ok === false ? "failed" : "unknown";
    const error = typeof check.error === "string" ? ` - ${check.error}` : "";
    print(`  ${name}: ${status}${error}`);
  }
}

function printCheck(body: unknown, target: string, print: Print): void {
  const { events, client } = diagnosticsView(body);
  print(`Local diagnostics for ${target}:`);
  if (events.length === 0) print("  (none)");
  else printEvents(events, line => print(`  ${line}`));
  print(`Client check: ${clientStatus(client)}`);
  printChecks(client, print);
}

function printLogs(body: unknown, target: string, print: Print): void {
  const { events } = diagnosticsView(body);
  if (events.length === 0) {
    print(`No diagnostic events for ${target}.`);
    return;
  }
  printEvents(events, print);
}

/**
 * Run one `atom gateway` action. Offline package/registration actions never touch a running
 * Gateway; online actions discover it through the runtime file and never start it themselves.
 * `command.force` is accepted for CLI parity, but registry/content/reference safety is authoritative.
 */
export async function runGatewayCommand(
  command: GatewayCommand,
  args: Pick<BootArguments, "sandbox">,
  deps: GatewayCommandDeps = {},
): Promise<void> {
  const print: Print = deps.stdout ?? console.log;
  const cwd = deps.cwd ?? process.cwd();
  const printJson = (value: unknown): void => print(JSON.stringify(value, null, 2));

  switch (command.action) {
    case "install": {
      const record = await installClient(args.sandbox, resolve(cwd, command.target!));
      const manifest = readManifest(join(args.sandbox, record.path));
      const installed = { id: manifest.id, version: manifest.version, ...record };
      if (command.json) {
        printJson(installed);
        return;
      }
      print(`Installed ${manifest.id}@${manifest.version} (${record.target})`);
      print(`  path: ${record.path}`);
      print(`  source: ${record.source}`);
      print(`  sha256: ${record.sha256}`);
      return;
    }

    case "load": {
      const root = resolve(cwd, command.target!);
      const manifest = readManifest(root);
      resolveEntry(manifest, "directory");

      const clientArgs = defaultClientArgs(manifest);
      const instance = {
        id: command.id ?? manifest.id,
        directory: root,
        ...(Object.keys(clientArgs).length > 0 ? { clientArgs } : {}),
        stdio: "inherit" as const,
      };
      const result = upsertInstance(args.sandbox, instance);
      const missingSecrets = requiredSecretFields(manifest);

      if (command.json) {
        printJson({
          ...result,
          instance,
          warnings: missingSecrets.map(field => `Required secret field "${field}" is not configured`),
        });
        return;
      }

      print(`Loaded ${manifest.id} from ${root}; saved, not started`);
      if (missingSecrets.length > 0) {
        print(
          `Warning: required secret fields are not configured: ${missingSecrets.join(", ")}. Configure them before starting.`,
        );
      }
      return;
    }

    case "pack": {
      const out = await packClient(resolve(cwd, command.target!), {
        out: command.out,
        target: command.targetPlatform,
      });
      if (command.json) printJson({ path: out });
      else print(out);
      return;
    }

    case "uninstall": {
      const { id, version } = resolveUninstallTarget(args.sandbox, command.target!);
      removePackage(args.sandbox, id, version);
      if (command.json) printJson({ id, version, removed: true });
      else print(`Uninstalled ${id}@${version}`);
      return;
    }

    case "list": {
      const text = await adminRequest(args, deps, "/admin/clients", { method: "GET" });
      if (command.json) {
        print(text);
        return;
      }
      const clients = clientsOf(parseAdminJson(text));
      if (clients.length === 0) {
        print("No configured clients.");
        return;
      }
      for (const client of clients) print(formatClient(client));
      return;
    }

    case "start":
    case "stop":
    case "reload": {
      const target = command.target!;
      const text = await adminRequest(args, deps, "/admin/clients", {
        method: "POST",
        body: JSON.stringify({ action: command.action, clientId: target }),
      });
      if (command.json) print(text);
      else print(`${command.action} ${target}: ok`);
      return;
    }

    case "check":
    case "logs": {
      const target = command.target!;
      const text = await adminRequest(
        args,
        deps,
        `/admin/clients/${encodeURIComponent(target)}/diagnostics`,
        { method: "GET" },
      );
      if (command.json) {
        print(text);
        return;
      }
      if (command.action === "logs") printLogs(parseAdminJson(text), target, print);
      else printCheck(parseAdminJson(text), target, print);
      return;
    }
  }
}
