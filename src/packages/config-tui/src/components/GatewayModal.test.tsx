import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { act } from "react";
import { createRoot } from "@opentui/react";
import { createTestRenderer } from "@opentui/core/testing";
import { GatewayModal } from "./GatewayModal";
import type { GatewayInstanceActions, GatewayInstanceStatus } from "../gateway-status";

const cleanup: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()!();
});

function makeSandbox(): { dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "atom-gateway-modal-"));
  mkdirSync(join(dir, ".atom"), { recursive: true });
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return { dir };
}

function writeRuntime(dir: string, url: string): void {
  writeFileSync(
    join(dir, ".atom", "gateway-runtime.json"),
    JSON.stringify({ url, token: "admin-token", instanceId: "gateway-1" }),
  );
}

function status(overrides: Partial<GatewayInstanceStatus> = {}): GatewayInstanceStatus {
  return {
    id: "alpha",
    platform: "darwin-arm64",
    source: { type: "package", id: "echo-bot", version: "1.2.3" },
    running: true,
    desired: true,
    state: "running",
    port: 7001,
    diagnostics: [
      { at: "2026-11-15T00:00:00.000Z", stage: "process", level: "info", message: "started" },
      { at: "2026-11-15T00:00:01.000Z", stage: "platform", level: "error", message: "platform check failed" },
    ],
    config: {
      mode: { label: "Mode", type: "string", enum: ["longpoll", "webhook"], default: "longpoll" },
      "webhook-url": { label: "Webhook URL", type: "string" },
      "bot-token": { label: "Bot Token", type: "string", required: true, secret: true },
    },
    clientArgs: { mode: "longpoll", "webhook-url": "https://old.example/hook" },
    secretFields: ["bot-token"],
    stdio: "inherit",
    ...overrides,
  };
}

function startServer(handler: (request: Request) => Response | Promise<Response>) {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler });
  cleanup.push(() => new Promise<void>((resolve) => { server.stop(true); resolve(); }));
  return server;
}

async function mountModal(sandbox: string, gatewayActions?: GatewayInstanceActions) {
  const reactEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  const setup = await createTestRenderer({ width: 110, height: 40 });
  const root = createRoot(setup.renderer);
  const submitted: number[] = [];
  let backs = 0;

  await act(async () => root.render(
    <GatewayModal
      sandbox={sandbox}
      port={3100}
      gatewayActions={gatewayActions}
      onSubmit={(port) => submitted.push(port)}
      onBack={() => { backs += 1; }}
    />,
  ));
  await settle();

  async function settle() {
    for (let i = 0; i < 8; i += 1) {
      await act(async () => { await Bun.sleep(10); });
      await setup.renderOnce();
    }
  }

  const press = async (...keys: string[]) => {
    for (const key of keys) {
      await act(async () => setup.mockInput.pressKey(key));
      await setup.renderOnce();
    }
  };
  const type = async (value: string) => {
    await act(async () => setup.mockInput.pasteBracketedText(value));
    await setup.renderOnce();
  };

  cleanup.push(async () => {
    await act(async () => root.unmount());
    setup.renderer.destroy();
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  });

  return {
    press,
    type,
    settle,
    frame: setup.captureCharFrame,
    submitted,
    backs: () => backs,
  };
}

test("offline sandbox shows OFFLINE plus install/load/pack entry points", async () => {
  const { dir } = makeSandbox();
  const modal = await mountModal(dir);

  const frame = modal.frame();
  expect(frame).toContain("GATEWAY CLIENTS");
  expect(frame).toContain("OFFLINE — Gateway is not running for this sandbox");
  expect(frame).toContain("Install client package");
  expect(frame).toContain("Load client directory");
  expect(frame).toContain("Pack client directory (developer)");
});

test("lists supervisor source/state/platform and shows reload failures", async () => {
  const { dir } = makeSandbox();
  const requested: string[] = [];
  let reloadBody: unknown;
  const server = startServer(async (request) => {
    requested.push(new URL(request.url).pathname);
    if (request.method === "POST") {
      reloadBody = await request.json();
      return Response.json({
        results: [{ id: "alpha", ok: false, error: "reload failed: bad clientArgs" }],
      }, { status: 400 });
    }
    return Response.json({ clients: [status()] });
  });
  writeRuntime(dir, server.url.toString());

  const modal = await mountModal(dir);
  expect(modal.frame()).toContain("alpha");
  expect(modal.frame()).toContain("package echo-bot@1.2.3");
  expect(modal.frame()).toContain("running");
  expect(modal.frame()).toContain("darwin-arm64");
  expect(modal.frame()).toContain(":7001");
  expect(modal.frame()).toContain("check failed");
  expect(modal.frame()).not.toContain("bot-token");

  await modal.press("RETURN");
  expect(modal.frame()).toContain("INSTANCE · alpha");
  expect(modal.frame()).toContain("Reload");
  expect(modal.frame()).toContain("Check platform credentials");
  expect(modal.frame()).toContain("Edit configuration");
  expect(modal.frame()).not.toContain("Pack directory (developer)");

  await modal.press("ARROW_DOWN", "ARROW_DOWN", "RETURN");
  await modal.settle();
  expect(modal.frame()).toContain("reload failed: bad clientArgs");
  expect(reloadBody).toEqual({ action: "reload", clientId: "alpha" });
  expect(requested.filter(path => path === "/admin/clients")).toHaveLength(2);
});

test("check and logs keep local events, client checks, and delivery stages distinct", async () => {
  const { dir } = makeSandbox();
  let diagnosticsReads = 0;
  const server = startServer((request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith("/diagnostics")) {
      diagnosticsReads += 1;
      return Response.json({
        id: "alpha",
        state: "running",
        events: [
          { at: "2026-11-15T00:00:00.000Z", stage: "process", level: "info", message: "started" },
          { at: "2026-11-15T00:00:01.000Z", stage: "delivery", level: "warn", message: "retrying delivery" },
        ],
        client: {
          status: "ok",
          checks: [{ name: "telegram-api", ok: true, detail: "reachable" }],
        },
      });
    }
    return Response.json({ clients: [status({ source: { type: "directory", directory: "/clients/alpha" } })] });
  });
  writeRuntime(dir, server.url.toString());

  const modal = await mountModal(dir);
  await modal.press("RETURN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "RETURN");
  await modal.settle();

  expect(modal.frame()).toContain("CLIENT CHECK · alpha");
  expect(modal.frame()).toContain("Client check: ok");
  expect(modal.frame()).toContain("telegram-api");
  expect(modal.frame()).toContain("process");
  expect(modal.frame()).toContain("delivery: retrying delivery");
  expect(modal.frame()).toContain("2 local event(s)");

  await modal.press("ESCAPE");
  await modal.settle();
  await modal.press("ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "RETURN");
  await modal.settle();

  expect(modal.frame()).toContain("DIAGNOSTICS · alpha");
  expect(modal.frame()).toContain("delivery: retrying delivery");
  expect(diagnosticsReads).toBe(2);
});

test("install, load with an optional id, and pack hand off to the CLI actions", async () => {
  const { dir } = makeSandbox();
  const installed: string[] = [];
  const loaded: Array<{ directory: string; id?: string }> = [];
  const packed: string[] = [];
  const server = startServer(() => Response.json({ clients: [] }));
  writeRuntime(dir, server.url.toString());

  const modal = await mountModal(dir, {
    install: async (archive) => { installed.push(archive); return `installed ${archive}`; },
    load: async (directory, id) => { loaded.push({ directory, id }); return `loaded ${directory}`; },
    pack: async (directory) => { packed.push(directory); return `packed ${directory}`; },
  });

  await modal.press("ARROW_DOWN", "RETURN");
  expect(modal.frame()).toContain("INSTALL CLIENT PACKAGE");
  await modal.type("dist/bot.atompkg");
  await modal.press("RETURN");
  await modal.settle();
  expect(installed).toEqual(["dist/bot.atompkg"]);
  expect(modal.frame()).toContain("installed dist/bot.atompkg");

  await modal.press("ARROW_DOWN", "ARROW_DOWN", "RETURN");
  expect(modal.frame()).toContain("LOAD CLIENT DIRECTORY");
  await modal.type("/clients/bot");
  await modal.press("RETURN");
  await modal.settle();
  expect(modal.frame()).toContain("Instance ID (optional)");
  await modal.press("RETURN");
  await modal.settle();
  expect(loaded).toEqual([{ directory: "/clients/bot", id: undefined }]);

  await modal.press("ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "RETURN");
  expect(modal.frame()).toContain("PACK CLIENT");
  await modal.type("clients/bot");
  await modal.press("RETURN");
  await modal.settle();
  expect(packed).toEqual(["clients/bot"]);
});

test("edit mode masks configured secrets, saves args, and keeps credential refs", async () => {
  const { dir } = makeSandbox();
  writeFileSync(join(dir, "config.json"), `${JSON.stringify({
    gateway: {
      clients: [{
        id: "alpha",
        directory: "/clients/alpha",
        clientArgs: { mode: "longpoll", "webhook-url": "https://old.example/hook" },
        credentials: { "bot-token": "ATOM_CLIENT_ALPHA_BOT_TOKEN" },
        stdio: "inherit",
      }],
    },
  }, null, 2)}\n`);
  writeFileSync(join(dir, ".env"), "ATOM_CLIENT_ALPHA_BOT_TOKEN=stored-secret\n");

  const server = startServer(() => Response.json({
    clients: [status({ source: { type: "directory", directory: "/clients/alpha" } })],
  }));
  writeRuntime(dir, server.url.toString());

  const modal = await mountModal(dir);
  await modal.press(
    "RETURN",
    "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN",
    "RETURN",
  );

  expect(modal.frame()).toContain("INSTANCE CONFIG · alpha");
  expect(modal.frame()).toContain("•••••• (configured)");
  expect(modal.frame()).not.toContain("stored-secret");

  // Mode field -> enum -> webhook, then save from the action bar.
  await modal.press("RETURN");
  await modal.settle();
  expect(modal.frame()).toContain("Mode");
  await modal.press("ARROW_DOWN", "RETURN");
  await modal.settle();
  expect(modal.frame()).toContain("webhook");
  await modal.press("TAB", "RETURN");
  await modal.settle();

  expect(modal.frame()).toContain("Saved alpha; restart/reload to apply");
  const config = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
  expect(config.gateway.clients[0].clientArgs).toEqual({
    mode: "webhook",
    "webhook-url": "https://old.example/hook",
  });
  expect(config.gateway.clients[0].credentials).toEqual({ "bot-token": "ATOM_CLIENT_ALPHA_BOT_TOKEN" });
  expect(readFileSync(join(dir, ".env"), "utf8")).toContain("ATOM_CLIENT_ALPHA_BOT_TOKEN=stored-secret");
  expect(readFileSync(join(dir, "config.json"), "utf8")).not.toContain("stored-secret");
});
