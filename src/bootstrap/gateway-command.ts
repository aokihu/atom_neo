import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  installClient,
  installSourcePackage,
  listPackages,
  packClient,
  parseManifest,
  removePackage,
  resolveEntry,
} from "@atom-neo/gateway";
import type { Manifest } from "@atom-neo/gateway";
import { clientSource, listInstances, upsertInstance } from "@atom-neo/shared";
import type { BootArguments, GatewayCommand } from "./cli";
import { upgradeClientInstance } from "./gateway-upgrade";
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

function officialSource(command: GatewayCommand): string | undefined {
  return command.source || process.env.ATOM_GATEWAY_SOURCE_INDEX || undefined;
}

function parseOfficialTarget(target: string): { id: string; version?: string } {
  const at = target.lastIndexOf("@");
  if (at === -1) return { id: target };
  const id = target.slice(0, at);
  const version = target.slice(at + 1);
  if (!id || !version) throw new Error(`Invalid official client target "${target}"; expected <id>[@version]`);
  return { id, version };
}

function isLocalArchive(target: string, cwd: string): boolean {
  try {
    return statSync(resolve(cwd, target)).isFile();
  } catch {
    return false;
  }
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

function readGatewayRuntime(sandbox: string) {
  try {
    return readRuntimeFile(sandbox, "gateway");
  } catch {
    return undefined;
  }
}

function runtimeFor(sandbox: string) {
  const runtime = readGatewayRuntime(sandbox);
  if (!runtime) throw notRunning(sandbox);
  return runtime;
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
  if (client.registered === false) {
    parts.push("configured", "unregistered");
  } else {
    const state = client.state
      ?? (client.running === true ? "running" : client.running === false ? "idle" : undefined);
    if (state !== undefined) parts.push(String(state));
  }

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
      if (!isLocalArchive(command.target!, cwd)) {
        const official = parseOfficialTarget(command.target!);
        const source = officialSource(command);
        const result = await installSourcePackage(args.sandbox, official.id, {
          source,
          version: official.version,
          fetchImpl: deps.fetchImpl,
        });
        const manifest = readManifest(join(args.sandbox, result.record.path));
        const installed = {
          id: manifest.id,
          version: manifest.version,
          ...result.record,
          ...(result.entry === undefined
            ? {}
            : { url: result.entry.url, archiveSha256: result.entry.sha256, size: result.entry.size }),
          cached: result.cached,
        };
        if (command.json) {
          printJson(installed);
          return;
        }
        print(`Installed ${manifest.id}@${manifest.version} (${result.record.target})${result.cached ? " [already installed]" : ""}`);
        print(`  path: ${result.record.path}`);
        print(`  source: ${result.record.source}`);
        print(`  sha256: ${result.record.sha256}`);
        if (result.entry) print(`  archive: ${result.entry.url}`);
        return;
      }

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

    case "upgrade": {
      const instanceId = command.target!;
      const current = listInstances(args.sandbox).find(instance => instance.id === instanceId);
      if (!current) throw new Error(`Unknown client instance: ${instanceId}`);
      if (!current.package) {
        throw new Error(`Client instance ${instanceId} uses a directory source; upgrade packages explicitly or load a new directory`);
      }

      const install = await installSourcePackage(args.sandbox, current.package.id, {
        source: officialSource(command),
        version: command.version,
        fetchImpl: deps.fetchImpl,
      });
      const newVersion = install.entry?.version ?? command.version;
      if (!newVersion) throw new Error("Upgrade requires a target version from the source index or --version");
      const online = readGatewayRuntime(args.sandbox) !== undefined;
      const apply = online
        ? async (): Promise<"reloaded" | "registered"> => {
          const clients = clientsOf(parseAdminJson(await adminRequest(args, deps, "/admin/clients", { method: "GET" })));
          const registered = clients.some(client => isRecord(client) && client.id === instanceId);
          await adminRequest(args, deps, "/admin/clients", {
            method: "POST",
            body: JSON.stringify({ action: registered ? "reload" : "register", clientId: instanceId }),
          });
          return registered ? "reloaded" : "registered";
        }
        : undefined;
      const upgraded = await upgradeClientInstance(args.sandbox, instanceId, newVersion, { apply });

      if (command.json) {
        printJson({
          id: instanceId,
          packageId: upgraded.packageId,
          previousVersion: upgraded.oldVersion,
          version: upgraded.newVersion,
          changed: upgraded.changed,
          cached: install.cached,
          offline: !online,
          applied: upgraded.applied,
          rolledBack: upgraded.rolledBack,
          ...(install.entry === undefined
            ? {}
            : { url: install.entry.url, archiveSha256: install.entry.sha256, size: install.entry.size }),
        });
        return;
      }

      const action = upgraded.changed
        ? `Upgraded ${instanceId} ${upgraded.oldVersion} -> ${upgraded.newVersion}`
        : `${instanceId} already at ${upgraded.newVersion}`;
      const applied = upgraded.applied
        ? `; ${upgraded.applied}`
        : "; saved, not applied (Gateway offline)";
      print(`${action}${applied}`);
      if (install.entry) print(`  archive: ${install.entry.url}`);
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
      const online = readGatewayRuntime(args.sandbox) !== undefined;
      let registered = false;
      let registerError: string | undefined;
      if (online) {
        try {
          await adminRequest(args, deps, "/admin/clients", {
            method: "POST",
            body: JSON.stringify({ action: "register", clientId: instance.id }),
          });
          registered = true;
        } catch (error) {
          registerError = reasonOf(error);
        }
      }

      if (command.json) {
        printJson({
          ...result,
          instance,
          online,
          registered,
          offline: !online,
          ...(registerError === undefined ? {} : { error: registerError }),
          warnings: missingSecrets.map(field => `Required secret field "${field}" is not configured`),
        });
      } else {
        const status = !online
          ? "saved, not started (Gateway offline)"
          : registered ? "saved and registered, not started" : `saved, but register failed: ${registerError}`;
        print(`Loaded ${instance.id} from ${root}; ${status}`);
        if (missingSecrets.length > 0) {
          print(
            `Warning: required secret fields are not configured: ${missingSecrets.join(", ")}. Configure them before starting.`,
          );
        }
      }
      if (registerError !== undefined) throw new Error(registerError);
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
      const result = removePackage(args.sandbox, id, version, { removeFiles: true });
      if (command.json) {
        printJson({
          id,
          version,
          removed: true,
          files: result.files,
          ...(result.leftoverPath === undefined ? {} : { leftoverPath: result.leftoverPath }),
        });
      } else {
        print(`Uninstalled ${id}@${version}`);
        if (result.files === "missing") print("  package directory was already missing");
        if (result.leftoverPath) print(`  warning: package files remain at ${result.leftoverPath}`);
      }
      return;
    }

    case "list": {
      const configured = listInstances(args.sandbox);
      const configuredById = new Map(configured.map(instance => [instance.id, instance]));
      const offline = readGatewayRuntime(args.sandbox) === undefined;
      const adminClients = offline
        ? []
        : clientsOf(parseAdminJson(await adminRequest(args, deps, "/admin/clients", { method: "GET" })));
      const registeredIds = new Set(
        adminClients.filter(isRecord).map(client => typeof client.id === "string" ? client.id : undefined),
      );
      const clients: unknown[] = adminClients.map(client => isRecord(client)
        ? { ...client, configured: configuredById.has(String(client.id)), registered: true }
        : client);
      for (const instance of configured) {
        if (registeredIds.has(instance.id)) continue;
        clients.push({
          id: instance.id,
          source: clientSource(instance),
          state: "unregistered",
          configured: true,
          registered: false,
        });
      }

      if (command.json) {
        printJson({ clients, offline });
        return;
      }
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
