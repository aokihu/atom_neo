import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listPackages } from "@atom-neo/gateway";
import { removeInstance, upsertInstance } from "@atom-neo/shared";
import { parseArguments } from "./cli";
import type { BootArguments, GatewayCommand, GatewayCommandAction } from "./cli";
import { runGatewayCommand } from "./gateway-command";
import { publishRuntimeFile, readRuntimeFile } from "./runtime-file";

const HOST_TARGET = `${process.platform}-${process.arch}`;
const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(directory);
  return directory;
}

function gatewayArgs(
  sandbox: string,
  action: GatewayCommandAction,
  target?: string,
  extra: readonly string[] = [],
): { args: BootArguments; command: GatewayCommand } {
  const parsed = parseArguments([
    "gateway",
    action,
    ...(target === undefined ? [] : [target]),
    "--sandbox",
    sandbox,
    ...extra,
  ]);
  if (parsed === "help") throw new Error("Unexpected help output");
  return { args: parsed, command: parsed.gatewayCommand! };
}

function capture(): { lines: string[]; stdout: (line: string) => void } {
  const lines: string[] = [];
  return { lines, stdout: (line) => lines.push(line) };
}

function writeClient(root: string, options: { version?: string } = {}): void {
  mkdirSync(join(root, "bin"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "bin", "echo-bot"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  writeFileSync(join(root, "src", "main.ts"), "export {};\n");

  const manifest = {
    manifest_version: 1,
    id: "echo-bot",
    name: "Echo Bot",
    version: options.version ?? "1.0.0",
    platform: "test",
    entry: {
      production: ["bin/echo-bot"],
      development: ["bun", "run", "src/main.ts"],
    },
    config: {
      mode: { label: "Mode", type: "string", default: "longpoll" },
      token: { label: "Token", type: "string", required: true, secret: true, env: "ECHO_BOT_TOKEN" },
      endpoint: { label: "Endpoint", type: "string", required: true },
    },
  };
  writeFileSync(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

function adminHeader(init: RequestInit | undefined): string | null {
  const headers = init?.headers;
  if (headers === undefined) return null;
  if (headers instanceof Headers) return headers.get("x-atom-admin-token");
  if (Array.isArray(headers)) return new Headers(headers).get("x-atom-admin-token");
  return headers["x-atom-admin-token"] ?? null;
}

describe("offline gateway commands", () => {
  test("packs, installs, and uninstalls a client package", async () => {
    const sandbox = tempDir("atom-gateway-pack-");
    const clientRoot = join(sandbox, "client");
    writeClient(clientRoot);

    const archive = join(sandbox, "dist", "echo-bot.tar.gz");
    const packed = capture();
    const pack = gatewayArgs(sandbox, "pack", clientRoot, ["--out", archive]);
    await runGatewayCommand(pack.command, pack.args, { stdout: packed.stdout });

    expect(packed.lines).toEqual([archive]);
    expect(existsSync(archive)).toBe(true);

    const installed = capture();
    const install = gatewayArgs(sandbox, "install", archive);
    await runGatewayCommand(install.command, install.args, { stdout: installed.stdout });

    const packageRoot = join(sandbox, ".atom", "gateway", "packages", "echo-bot", "1.0.0", HOST_TARGET);
    expect(existsSync(join(packageRoot, "bin", "echo-bot"))).toBe(true);
    expect(existsSync(join(packageRoot, "manifest.json"))).toBe(true);

    const packages = listPackages(sandbox);
    expect(packages.map(entry => `${entry.id}@${entry.version}`)).toEqual(["echo-bot@1.0.0"]);
    expect(packages[0]!.record.target).toBe(HOST_TARGET);
    expect(packages[0]!.record.path).toBe(
      `.atom/gateway/packages/echo-bot/1.0.0/${HOST_TARGET}`,
    );

    const installText = installed.lines.join("\n");
    expect(installText).toContain("Installed echo-bot@1.0.0");
    expect(installText).toContain(HOST_TARGET);
    expect(installText).toContain(".atom/gateway/packages/echo-bot/1.0.0");
    expect(installText).toContain(archive);
    expect(installText).toContain(packages[0]!.record.sha256);

    const removed = capture();
    const uninstall = gatewayArgs(sandbox, "uninstall", "echo-bot@1.0.0");
    await runGatewayCommand(uninstall.command, uninstall.args, { stdout: removed.stdout });

    expect(removed.lines.join("\n")).toContain("Uninstalled echo-bot@1.0.0");
    expect(listPackages(sandbox)).toEqual([]);
    // removePackage owns registry removal only; G5 owns package file cleanup.
    expect(existsSync(packageRoot)).toBe(true);
  });

  test("loads a development directory with defaults and warns about unconfigured secrets", async () => {
    const sandbox = tempDir("atom-gateway-load-");
    const clientRoot = join(sandbox, "clients", "echo-bot");
    writeClient(clientRoot);
    writeFileSync(join(sandbox, ".env"), "ATOM_CLIENT_ECHO_BOT_TOKEN=super-secret-value\n");

    const loaded = capture();
    const load = gatewayArgs(sandbox, "load", "clients/echo-bot");
    await runGatewayCommand(load.command, load.args, { stdout: loaded.stdout });

    const config = JSON.parse(readFileSync(join(sandbox, "config.json"), "utf8"));
    expect(config.gateway.clients).toHaveLength(1);
    const instance = config.gateway.clients[0];
    expect(instance.id).toBe("echo-bot");
    expect(instance.directory).toBe(clientRoot);
    expect(instance.stdio).toBe("inherit");
    expect(instance.clientArgs).toEqual({ mode: "longpoll" });
    expect(instance.package).toBeUndefined();
    expect(instance.credentials).toBeUndefined();

    const text = loaded.lines.join("\n");
    expect(text).toContain("saved, not started");
    expect(text).toMatch(/warning/i);
    expect(text).toContain("token");
    expect(text).not.toContain("super-secret-value");

    const jsonOutput = capture();
    const jsonLoad = gatewayArgs(sandbox, "load", "clients/echo-bot", ["--json"]);
    await runGatewayCommand(jsonLoad.command, jsonLoad.args, { stdout: jsonOutput.stdout });
    const record = JSON.parse(jsonOutput.lines.join("\n"));
    expect(record).toMatchObject({
      saved: true,
      applied: false,
      instance: { id: "echo-bot", directory: clientRoot, clientArgs: { mode: "longpoll" } },
    });
    expect(JSON.stringify(record)).not.toContain("super-secret-value");
  });

  test("offline actions need no runtime and online actions explain a missing one", async () => {
    const sandbox = tempDir("atom-gateway-offline-");
    const clientRoot = join(sandbox, "client");
    writeClient(clientRoot);

    const load = gatewayArgs(sandbox, "load", clientRoot);
    await expect(runGatewayCommand(load.command, load.args, { stdout: () => {} })).resolves.toBeUndefined();

    let calls = 0;
    const deps = {
      stdout: () => {},
      fetchImpl: (async () => {
        calls++;
        throw new Error("fetch must not run without a runtime file");
      }) as typeof fetch,
    };
    const list = gatewayArgs(sandbox, "list");
    await expect(runGatewayCommand(list.command, list.args, deps)).rejects.toThrow(
      `Gateway is not running for sandbox ${sandbox}; start it with --mode core-gateway`,
    );
    expect(calls).toBe(0);

    publishRuntimeFile(sandbox, "gateway", {
      url: "http://127.0.0.1:4100",
      token: "admin-token",
      instanceId: "gateway-test",
    });
    await expect(runGatewayCommand(list.command, list.args, deps)).rejects.toThrow(
      `Gateway is not running for sandbox ${sandbox}; start it with --mode core-gateway`,
    );
    expect(calls).toBe(1);
  });

  test("uninstall supports id@version, single-version fallback, and reference protection", async () => {
    const sandbox = tempDir("atom-gateway-uninstall-");

    for (const version of ["1.0.0", "1.1.0"]) {
      const clientRoot = join(sandbox, `client-${version}`);
      writeClient(clientRoot, { version });
      const archive = join(sandbox, `echo-bot-${version}.tar.gz`);

      const pack = gatewayArgs(sandbox, "pack", clientRoot, ["--out", archive]);
      await runGatewayCommand(pack.command, pack.args, { stdout: () => {} });

      const install = gatewayArgs(sandbox, "install", archive);
      await runGatewayCommand(install.command, install.args, { stdout: () => {} });
    }

    expect(listPackages(sandbox).map(entry => entry.version)).toEqual(["1.0.0", "1.1.0"]);

    const ambiguous = gatewayArgs(sandbox, "uninstall", "echo-bot");
    await expect(runGatewayCommand(ambiguous.command, ambiguous.args, { stdout: () => {} }))
      .rejects.toThrow(/multiple installed versions/);

    const explicit = capture();
    const explicitRemove = gatewayArgs(sandbox, "uninstall", "echo-bot@1.0.0");
    await runGatewayCommand(explicitRemove.command, explicitRemove.args, { stdout: explicit.stdout });
    expect(explicit.lines.join("\n")).toContain("Uninstalled echo-bot@1.0.0");
    expect(listPackages(sandbox).map(entry => entry.version)).toEqual(["1.1.0"]);

    upsertInstance(sandbox, {
      id: "echo-client",
      package: { id: "echo-bot", version: "1.1.0" },
      stdio: "inherit",
    });

    const referenced = gatewayArgs(sandbox, "uninstall", "echo-bot");
    await expect(runGatewayCommand(referenced.command, referenced.args, { stdout: () => {} }))
      .rejects.toThrow(/referenced by client echo-client/);

    removeInstance(sandbox, "echo-client");
    const fallback = capture();
    const fallbackRemove = gatewayArgs(sandbox, "uninstall", "echo-bot");
    await runGatewayCommand(fallbackRemove.command, fallbackRemove.args, { stdout: fallback.stdout });
    expect(fallback.lines.join("\n")).toContain("Uninstalled echo-bot@1.1.0");
    expect(listPackages(sandbox)).toEqual([]);
  });
});

describe("online gateway commands", () => {
  test("list, lifecycle actions, check, and logs use the admin API", async () => {
    const sandbox = tempDir("atom-gateway-online-");
    publishRuntimeFile(sandbox, "gateway", {
      url: "http://127.0.0.1:4200/",
      token: "admin-token",
      instanceId: "gateway-test",
    });

    const clients = [{
      id: "echo-bot",
      platform: "test",
      source: { type: "package", id: "echo-bot", version: "1.0.0" },
      running: true,
      desired: true,
      state: "running",
      port: 4100,
    }];
    const diagnostics = {
      id: "echo-bot",
      diagnostics: [{
        at: "2026-11-15T00:00:00.000Z",
        stage: "process",
        level: "info",
        message: "process started",
      }],
      client: {
        status: "ok",
        checks: [{ name: "echo.ping", ok: true, at: "2026-11-15T00:00:01.000Z" }],
      },
    };

    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith("/diagnostics")) return Response.json(diagnostics);
      if (init?.method === "POST") return Response.json({ results: [{ id: "echo-bot", ok: true }], clients });
      return Response.json({ clients });
    }) as typeof fetch;
    const deps = { fetchImpl, stdout: () => {} };

    const list = capture();
    const listArgs = gatewayArgs(sandbox, "list");
    await runGatewayCommand(listArgs.command, listArgs.args, { ...deps, stdout: list.stdout });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://127.0.0.1:4200/admin/clients");
    expect(calls[0]!.init?.method).toBe("GET");
    expect(adminHeader(calls[0]!.init)).toBe("admin-token");
    expect(list.lines.join("\n")).toContain("echo-bot");
    expect(list.lines.join("\n")).toContain("running");

    const listJson = capture();
    const listJsonArgs = gatewayArgs(sandbox, "list", undefined, ["--json"]);
    await runGatewayCommand(listJsonArgs.command, listJsonArgs.args, { ...deps, stdout: listJson.stdout });
    expect(JSON.parse(listJson.lines.join("\n"))).toEqual({ clients });

    for (const action of ["start", "stop", "reload"] as const) {
      calls.length = 0;
      const output = capture();
      const request = gatewayArgs(sandbox, action, "echo-bot");
      await runGatewayCommand(request.command, request.args, { ...deps, stdout: output.stdout });

      expect(calls).toHaveLength(1);
      expect(calls[0]!.url).toBe("http://127.0.0.1:4200/admin/clients");
      expect(calls[0]!.init?.method).toBe("POST");
      expect(adminHeader(calls[0]!.init)).toBe("admin-token");
      expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ action, clientId: "echo-bot" });
      expect(output.lines.join("\n")).toContain(`${action} echo-bot: ok`);
    }

    for (const action of ["check", "logs"] as const) {
      calls.length = 0;
      const output = capture();
      const request = gatewayArgs(sandbox, action, "echo-bot");
      await runGatewayCommand(request.command, request.args, { ...deps, stdout: output.stdout });

      expect(calls).toHaveLength(1);
      expect(calls[0]!.url).toBe("http://127.0.0.1:4200/admin/clients/echo-bot/diagnostics");
      expect(calls[0]!.init?.method).toBe("GET");
      expect(adminHeader(calls[0]!.init)).toBe("admin-token");

      const text = output.lines.join("\n");
      expect(text).toContain("process started");
      if (action === "check") {
        expect(text).toContain("Local diagnostics");
        expect(text).toContain("Client check: ok");
        expect(text).toContain("echo.ping: ok");
      } else {
        expect(text).not.toContain("Client check");
      }
    }

    const checkJson = capture();
    const checkJsonArgs = gatewayArgs(sandbox, "check", "echo-bot", ["--json"]);
    await runGatewayCommand(checkJsonArgs.command, checkJsonArgs.args, { ...deps, stdout: checkJson.stdout });
    expect(JSON.parse(checkJson.lines.join("\n"))).toEqual(diagnostics);

    calls.length = 0;
    const encoded = gatewayArgs(sandbox, "check", "echo bot");
    await runGatewayCommand(encoded.command, encoded.args, { ...deps, stdout: () => {} });
    expect(calls[0]!.url).toBe("http://127.0.0.1:4200/admin/clients/echo%20bot/diagnostics");
  });

  test("admin failures expose status and body without leaking the token or starting anything", async () => {
    const sandbox = tempDir("atom-gateway-admin-error-");
    publishRuntimeFile(sandbox, "gateway", {
      url: "http://127.0.0.1:4300",
      token: "admin-token",
      instanceId: "gateway-test",
    });

    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response("Forbidden: bad request", { status: 403 });
    }) as typeof fetch;
    const request = gatewayArgs(sandbox, "stop", "echo-bot");

    const error = await runGatewayCommand(request.command, request.args, { fetchImpl, stdout: () => {} })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("403");
    expect((error as Error).message).toContain("Forbidden: bad request");
    expect((error as Error).message).not.toContain("admin-token");
    expect(calls).toBe(1);
    expect(readRuntimeFile(sandbox, "gateway").instanceId).toBe("gateway-test");
    expect(existsSync(join(sandbox, ".atom", "gateway", "packages.json"))).toBe(false);
  });
});
