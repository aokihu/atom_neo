/** M2 end-to-end: build → pack → install → configure → start → fake platform round-trip. */
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  packClient,
  installClient,
  configureInstance,
  resolveClients,
  sandboxPackageRoot,
  startGateway,
} from "@atom-neo/gateway";
import { Logger } from "@atom-neo/shared";
import { loadConfig } from "./config";
import { readSandboxEnv } from "./env";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "atom-gateway-package-e2e-"));
  tempDirs.push(dir);
  return dir;
}

async function waitForFile(path: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${path}`);
    await Bun.sleep(50);
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("builds, packs, installs, configures and completes a fake platform round-trip", async () => {
  const root = tempDir();
  const sandbox = join(root, "sandbox");
  const clientRoot = join(root, "e2e-client");
  const binPath = join(clientRoot, "bin", "e2e-client");
  const recordPath = join(root, "result.json");
  mkdirSync(join(clientRoot, "bin"), { recursive: true });
  mkdirSync(sandbox, { recursive: true });

  const fixture = join(import.meta.dir, "fixtures/gateway-client-e2e.ts");
  const build = Bun.spawn([
    process.execPath, "build", fixture, "--compile",
    `--target=bun-${process.platform}-${process.arch}`, `--outfile=${binPath}`,
  ], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [stderr, code] = await Promise.all([new Response(build.stderr).text(), build.exited]);
  expect(code, stderr).toBe(0);

  writeFileSync(join(clientRoot, "manifest.json"), JSON.stringify({
    manifest_version: 1,
    id: "e2e-client",
    name: "E2E Client",
    version: "0.1.0",
    platform: "local",
    entry: { production: ["./bin/e2e-client"] },
    config: {
      "bot-token": { label: "Token", type: "string", required: true, secret: true, env: "E2E_TOKEN" },
      "send-text": { label: "Send text", type: "string" },
      "result-record": { label: "Result record", type: "string" },
    },
  }));

  const archive = await packClient(clientRoot, { out: join(root, "e2e-client.tar.gz") });
  const installed = await installClient(sandbox, archive);
  expect(installed.target).toBe(`${process.platform}-${process.arch}`);

  const configured = configureInstance({
    sandbox,
    id: "e2e",
    source: { type: "package", id: "e2e-client", version: "0.1.0" },
    values: {
      "bot-token": "local-e2e-token",
      "send-text": "hello-e2e",
      "result-record": recordPath,
    },
    stdio: "ignore",
  });
  expect(configured.saved).toBe(true);
  expect(configured.applied).toBe(false);

  const loaded = loadConfig(sandbox);
  const clientEnv = readSandboxEnv(sandbox);
  const resolved = resolveClients(loaded.effective.gateway.clients, {
    packageRoot: sandboxPackageRoot(sandbox),
    baseDir: sandbox,
    readEnv: (key) => clientEnv[key] ?? process.env[key],
  });

  const core = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/api/tasks" && request.method === "POST") return Response.json({ taskId: "e2e-task" });
      if (path === "/api/tasks/e2e-task") return Response.json({ state: "completed", result: "ROUNDTRIP_OK" });
      return new Response("Not Found", { status: 404 });
    },
  });

  const portProbe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") });
  const gatewayPort = portProbe.port;
  portProbe.stop(true);

  let gateway: Awaited<ReturnType<typeof startGateway>> | undefined;
  try {
    gateway = await startGateway({
      port: gatewayPort,
      clientPortRangeStart: 4_600,
      coreUrl: core.url.origin,
      clients: loaded.effective.gateway.clients,
      resolvedClients: resolved,
      logger: new Logger("error", () => {}),
    });

    await waitForFile(recordPath);
    const record = JSON.parse(readFileSync(recordPath, "utf8")) as {
      ok: boolean;
      payload?: { taskId: string; platformUserId: string; result: string };
    };
    expect(record.ok).toBe(true);
    expect(record.payload?.taskId).toBe("e2e-task");
    expect(record.payload?.platformUserId).toBe("e2e-user");
    expect(record.payload?.result).toBe("ROUNDTRIP_OK");
  } finally {
    if (gateway) await gateway.stop();
    core.stop(true);
  }
}, 30_000);
