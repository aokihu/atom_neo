import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fetchGatewayDiagnostics,
  fetchGatewayStatus,
  gatewayAction,
  saveGatewayInstance,
} from "./gateway-status";
import type { GatewayDiagnostics, GatewayInstanceStatus } from "./gateway-status";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function sandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), "atom-gateway-status-"));
  tempDirs.push(dir);
  mkdirSync(join(dir, ".atom"), { recursive: true });
  return dir;
}

function publishRuntime(dir: string, url: string, token = "admin-token"): void {
  writeFileSync(
    join(dir, ".atom", "gateway-runtime.json"),
    JSON.stringify({ url, token, instanceId: "gateway-1" }),
  );
}

function writeClientConfig(dir: string): void {
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
  writeFileSync(join(dir, ".env"), "ATOM_CLIENT_ALPHA_BOT_TOKEN=old-secret\n");
}

const STATUS: GatewayInstanceStatus = {
  id: "alpha",
  platform: "darwin-arm64",
  source: { type: "directory", directory: "/clients/alpha" },
  running: true,
  desired: true,
  state: "running",
  port: 7001,
  diagnostics: [{ at: "2026-11-15T00:00:00.000Z", stage: "process", level: "info", message: "started" }],
  config: {
    mode: { label: "Mode", type: "string", enum: ["longpoll", "webhook"], default: "longpoll" },
    "webhook-url": { label: "Webhook URL", type: "string" },
    "bot-token": { label: "Bot Token", type: "string", required: true, secret: true },
  },
  clientArgs: { mode: "longpoll", "webhook-url": "https://old.example/hook" },
  secretFields: ["bot-token"],
  stdio: "inherit",
};

function fakeFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): { fetchImpl: typeof fetch; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return handler(String(input), init);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe("gateway status transport", () => {
  test("missing runtime file means offline", async () => {
    const dir = sandbox();
    const { fetchImpl } = fakeFetch(() => Response.json({ clients: [] }));
    expect(await fetchGatewayStatus(dir, fetchImpl)).toBeNull();
  });

  test("reads clients with the admin token and normalizes the base URL", async () => {
    const dir = sandbox();
    publishRuntime(dir, "http://127.0.0.1:3100///");
    const { fetchImpl, calls } = fakeFetch(() => Response.json({ clients: [STATUS] }));

    expect(await fetchGatewayStatus(dir, fetchImpl)).toEqual([STATUS]);
    expect(calls[0]!.url).toBe("http://127.0.0.1:3100/admin/clients");
    expect(new Headers(calls[0]!.init?.headers).get("x-atom-admin-token")).toBe("admin-token");
  });

  test("surfaces admin failures and malformed responses", async () => {
    const dir = sandbox();
    publishRuntime(dir, "http://127.0.0.1:3100");

    const failed = fakeFetch(() => Response.json({ error: "nope" }, { status: 500 }));
    await expect(fetchGatewayStatus(dir, failed.fetchImpl)).rejects.toThrow("Gateway status failed (500)");

    const malformed = fakeFetch(() => Response.json({ clients: "nope" }));
    await expect(fetchGatewayStatus(dir, malformed.fetchImpl)).rejects.toThrow("Invalid Gateway status response");
  });

  test("encodes the instance id for diagnostics reads", async () => {
    const dir = sandbox();
    publishRuntime(dir, "http://127.0.0.1:3100");
    const body: GatewayDiagnostics = {
      id: "alpha/beta",
      state: "running",
      events: [{ at: "2026-11-15T00:00:00.000Z", stage: "delivery", level: "warn", message: "retry" }],
      client: { status: "unsupported" },
    };
    const { fetchImpl, calls } = fakeFetch(() => Response.json(body));

    expect(await fetchGatewayDiagnostics(dir, "alpha/beta", fetchImpl)).toEqual(body);
    expect(calls[0]!.url).toBe("http://127.0.0.1:3100/admin/clients/alpha%2Fbeta/diagnostics");
  });

  test("admin requests time out with a clear error", async () => {
    const dir = sandbox();
    publishRuntime(dir, "http://127.0.0.1:3100");
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) {
        reject(new Error("missing abort signal"));
        return;
      }
      signal.addEventListener("abort", () => reject(signal.reason));
    })) as typeof fetch;

    await expect(fetchGatewayStatus(dir, fetchImpl, 10))
      .rejects.toThrow("Gateway admin request timed out after 10ms");
    await expect(fetchGatewayDiagnostics(dir, "alpha", fetchImpl, 10))
      .rejects.toThrow("Gateway admin request timed out after 10ms");
    await expect(gatewayAction(dir, "reload", "alpha", fetchImpl, 10))
      .rejects.toThrow("Gateway admin request timed out after 10ms");
  });

  test("reload failures carry the server detail instead of a bare 400", async () => {
    const dir = sandbox();
    publishRuntime(dir, "http://127.0.0.1:3100");
    const { fetchImpl } = fakeFetch(() => Response.json({
      results: [{ id: "alpha", ok: false, error: "Client alpha argument --mode must be one of: longpoll, webhook" }],
    }, { status: 400 }));

    await expect(gatewayAction(dir, "reload", "alpha", fetchImpl)).rejects.toThrow(
      "Client alpha argument --mode must be one of: longpoll, webhook",
    );
  });
});

describe("gateway instance persistence", () => {
  test("keeps the source and credential refs, drops blank args and writes new secrets to .env", () => {
    const dir = sandbox();
    writeClientConfig(dir);

    const result = saveGatewayInstance(dir, STATUS, {
      mode: "webhook",
      "webhook-url": "",
      "bot-token": "new-secret",
    }, { "bot-token": "new-secret" });

    expect(result.saved).toBe(true);
    const config = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
    expect(config.gateway.clients).toEqual([{
      id: "alpha",
      directory: "/clients/alpha",
      clientArgs: { mode: "webhook" },
      credentials: { "bot-token": "ATOM_CLIENT_ALPHA_BOT_TOKEN" },
      stdio: "inherit",
    }]);
    expect(config.gateway.clients[0].credentials["bot-token"]).not.toContain("new-secret");
    expect(readFileSync(join(dir, ".env"), "utf8")).toContain("ATOM_CLIENT_ALPHA_BOT_TOKEN=new-secret");
  });

  test("blank configured secrets stay unchanged", () => {
    const dir = sandbox();
    writeClientConfig(dir);

    saveGatewayInstance(dir, STATUS, { mode: "longpoll", "webhook-url": "", "bot-token": "" });

    const config = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
    expect(config.gateway.clients[0].credentials).toEqual({ "bot-token": "ATOM_CLIENT_ALPHA_BOT_TOKEN" });
    expect(readFileSync(join(dir, ".env"), "utf8")).toContain("ATOM_CLIENT_ALPHA_BOT_TOKEN=old-secret");
  });

  test("refuses to edit an instance that is not configured", () => {
    const dir = sandbox();
    writeClientConfig(dir);
    expect(() => saveGatewayInstance(dir, { ...STATUS, id: "ghost" }, {})).toThrow("Unknown client instance: ghost");
  });
});
