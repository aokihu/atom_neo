import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  createSourceIndexEntry,
  findPackage,
  listPackages,
  packClient,
  sourceIndexDocument,
} from "@atom-neo/gateway";
import { listInstances, removeInstance, upsertInstance } from "@atom-neo/shared";
import { parseArguments } from "./cli";
import { runGatewayCommand } from "./gateway-command";
import { publishRuntimeFile } from "./runtime-file";

const target = `${process.platform}-${process.arch}`;
const tempDirs: string[] = [];
const servers: Array<ReturnType<typeof Bun.serve>> = [];

afterEach(() => {
  while (servers.length > 0) servers.pop()!.stop(true);
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeClient(root: string, version: string): void {
  mkdirSync(join(root, "bin"), { recursive: true });
  writeFileSync(join(root, "manifest.json"), JSON.stringify({
    manifest_version: 1,
    id: "echo-bot",
    name: "Echo Bot",
    version,
    platform: "test",
    entry: { production: ["bin/echo-bot"] },
  }));
  const bin = join(root, "bin", "echo-bot");
  writeFileSync(bin, "#!/bin/sh\nexit 0\n");
  chmodSync(bin, 0o755);
}

function runtime(sandbox: string, url: string): void {
  publishRuntimeFile(sandbox, "gateway", { url, token: "admin-token", instanceId: "gateway-test" });
}

describe("official source distribution", () => {
  test("downloads, installs, upgrades with rollback, and uninstalls with reference protection", async () => {
    const sandbox = tempDir("atom-gateway-source-");
    const archives = tempDir("atom-gateway-source-archives-");
    const sourceDirs = [join(tempDir("atom-gateway-source-v1-"), "client"), join(tempDir("atom-gateway-source-v2-"), "client")];
    writeClient(sourceDirs[0]!, "1.0.0");
    writeClient(sourceDirs[1]!, "2.0.0");
    const archiveV1 = join(archives, "echo-bot-1.0.0.tar.gz");
    const archiveV2 = join(archives, "echo-bot-2.0.0.tar.gz");
    await packClient(sourceDirs[0]!, { out: archiveV1, target });
    await packClient(sourceDirs[1]!, { out: archiveV2, target });

    let index: unknown;
    const registeredIds = new Set<string>();
    let failReload = false;
    const actions: string[] = [];
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/index.json") return Response.json(index);
      if (url.pathname === "/admin/clients") {
        if (request.method === "GET") {
          return Response.json({
            clients: [...registeredIds].map(id => ({ id, state: "running", running: true })),
          });
        }
        const body = await request.json() as { action?: string; clientId?: string };
        actions.push(body.action ?? "unknown");
        const id = body.clientId ?? "unknown";
        if (body.action === "reload" && failReload) {
          return Response.json({ results: [{ id, ok: false, error: "reload failed" }] }, { status: 400 });
        }
        if (body.action === "register" || body.action === "reload") registeredIds.add(id);
        return Response.json({ results: [{ id, ok: true }], clients: [] });
      }
      if (url.pathname.startsWith("/artifacts/")) {
        const file = join(archives, basename(url.pathname));
        return existsSync(file) ? new Response(Bun.file(file)) : new Response("missing", { status: 404 });
      }
      return new Response("not found", { status: 404 });
    } });
    servers.push(server);
    const baseUrl = server.url.toString().replace(/\/+$/, "");
    const entryV1 = await createSourceIndexEntry({
      archivePath: archiveV1, baseUrl: `${baseUrl}/artifacts`, id: "echo-bot", version: "1.0.0", target,
    });
    const entryV2 = await createSourceIndexEntry({
      archivePath: archiveV2, baseUrl: `${baseUrl}/artifacts`, id: "echo-bot", version: "2.0.0", target,
    });
    index = sourceIndexDocument([entryV1, entryV2]);
    const indexUrl = `${baseUrl}/index.json`;

    const run = async (action: string, commandTarget?: string, extra: string[] = []) => {
      const parsed = parseArguments([
        "gateway", action, ...(commandTarget === undefined ? [] : [commandTarget]),
        "--sandbox", sandbox, ...extra,
      ]);
      if (parsed === "help") throw new Error("Unexpected help");
      const lines: string[] = [];
      await runGatewayCommand(parsed.gatewayCommand!, parsed, {
        stdout: line => lines.push(line),
        fetchImpl: fetch,
      });
      return lines.join("\n");
    };

    const installedV1 = JSON.parse(await run("install", "echo-bot@1.0.0", ["--source", indexUrl, "--json"]));
    expect(installedV1).toMatchObject({ id: "echo-bot", version: "1.0.0", target, cached: false, url: entryV1.url });
    const installedV2 = JSON.parse(await run("install", "echo-bot@2.0.0", ["--source", indexUrl, "--json"]));
    expect(installedV2).toMatchObject({ version: "2.0.0", cached: false });
    expect(listPackages(sandbox).map(entry => entry.version)).toEqual(["1.0.0", "2.0.0"]);

    upsertInstance(sandbox, {
      id: "main",
      package: { id: "echo-bot", version: "1.0.0" },
      clientArgs: { mode: "longpoll" },
      stdio: "inherit",
    });
    const v1Dir = join(sandbox, findPackage(sandbox, "echo-bot", "1.0.0")!.path);
    const v2Dir = join(sandbox, findPackage(sandbox, "echo-bot", "2.0.0")!.path);
    await expect(run("uninstall", "echo-bot@1.0.0")).rejects.toThrow("referenced by client main");
    expect(existsSync(v1Dir)).toBe(true);

    upsertInstance(sandbox, {
      id: "offline",
      package: { id: "echo-bot", version: "1.0.0" },
      stdio: "ignore",
    });
    const offline = await run("upgrade", "offline", ["--version", "2.0.0", "--source", indexUrl]);
    expect(offline).toContain("saved, not applied (Gateway offline)");
    expect(listInstances(sandbox).find(instance => instance.id === "offline")?.package?.version).toBe("2.0.0");
    removeInstance(sandbox, "offline");

    upsertInstance(sandbox, {
      id: "config-only",
      package: { id: "echo-bot", version: "1.0.0" },
      stdio: "ignore",
    });
    runtime(sandbox, baseUrl);
    const registered = JSON.parse(await run("upgrade", "config-only", ["--version", "2.0.0", "--source", indexUrl, "--json"]));
    expect(registered).toMatchObject({ version: "2.0.0", applied: "registered", offline: false });
    removeInstance(sandbox, "config-only");

    registeredIds.add("main");
    failReload = true;
    await expect(run("upgrade", "main", ["--version", "2.0.0", "--source", indexUrl]))
      .rejects.toThrow("old version echo-bot@1.0.0 restored");
    expect(listInstances(sandbox)[0]?.package?.version).toBe("1.0.0");
    expect(existsSync(v2Dir)).toBe(true);

    failReload = false;
    const upgraded = JSON.parse(await run("upgrade", "main", ["--version", "2.0.0", "--source", indexUrl, "--json"]));
    expect(upgraded).toMatchObject({ version: "2.0.0", applied: "reloaded", offline: false, rolledBack: false });
    expect(listInstances(sandbox)[0]?.package?.version).toBe("2.0.0");
    expect(actions).toEqual(["register", "reload", "reload"]);

    expect(await run("uninstall", "echo-bot@1.0.0")).toContain("Uninstalled echo-bot@1.0.0");
    expect(existsSync(v1Dir)).toBe(false);
    expect(existsSync(v2Dir)).toBe(true);
    await expect(run("uninstall", "echo-bot@2.0.0")).rejects.toThrow("referenced by client main");

    removeInstance(sandbox, "main");
    expect(await run("uninstall", "echo-bot@2.0.0")).toContain("Uninstalled echo-bot@2.0.0");
    expect(existsSync(v2Dir)).toBe(false);
    expect(listPackages(sandbox)).toEqual([]);
  }, 30000);

  test("official errors are explicit and do not register packages", async () => {
    const sandbox = tempDir("atom-gateway-source-errors-");
    const archives = tempDir("atom-gateway-source-error-archives-");
    const sourceDir = join(tempDir("atom-gateway-source-error-v1-"), "client");
    writeClient(sourceDir, "1.0.0");
    const archive = join(archives, "echo-bot-1.0.0.tar.gz");
    await packClient(sourceDir, { out: archive, target });

    let index: unknown;
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/index.json") return Response.json(index);
      if (url.pathname.startsWith("/artifacts/")) {
        const file = join(archives, basename(url.pathname));
        return existsSync(file) ? new Response(Bun.file(file)) : new Response("missing", { status: 404 });
      }
      return new Response("not found", { status: 404 });
    } });
    servers.push(server);
    const baseUrl = server.url.toString().replace(/\/+$/, "");
    const good = await createSourceIndexEntry({
      archivePath: archive, baseUrl: `${baseUrl}/artifacts`, id: "echo-bot", version: "1.0.0", target,
    });
    index = sourceIndexDocument([good, {
      ...good,
      target: "not-this-host",
    }, {
      ...good,
      version: "1.1.0",
      sha256: "0".repeat(64),
    }, {
      ...good,
      version: "1.2.0",
      url: `${baseUrl}/artifacts/missing.tar.gz`,
    }]);

    const run = async (commandTarget: string) => {
      const parsed = parseArguments([
        "gateway", "install", commandTarget, "--source", `${baseUrl}/index.json`, "--sandbox", sandbox,
      ]);
      if (parsed === "help") throw new Error("Unexpected help");
      await runGatewayCommand(parsed.gatewayCommand!, parsed, { stdout: () => {}, fetchImpl: fetch });
    };

    await expect(run("missing-bot@1.0.0")).rejects.toThrow('Unknown source package "missing-bot"');
    await expect(run("echo-bot@9.9.9")).rejects.toThrow("not available for target");
    await expect(run("echo-bot@1.1.0")).rejects.toThrow("Checksum mismatch");
    await expect(run("echo-bot@1.2.0")).rejects.toThrow("HTTP 404");
    expect(listPackages(sandbox)).toEqual([]);

    index = sourceIndexDocument([{ ...good, target: "not-this-host" }]);
    await expect(run("echo-bot@1.0.0")).rejects.toThrow('Unsupported target');
    expect(listPackages(sandbox)).toEqual([]);
  }, 30000);
});
