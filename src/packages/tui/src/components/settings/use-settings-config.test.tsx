import { afterEach, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "@opentui/react";
import { createTestRenderer } from "@opentui/core/testing";
import type { ServerInfo } from "../../types";
import { useSettingsConfig } from "./use-settings-config";

const serverInfo: ServerInfo = {
  port: 3100,
  host: "127.0.0.1",
  model: "deepseek-v4-flash",
  sandbox: "/tmp/sandbox",
  version: "1.14.0",
  tools: [],
  theme: "edex",
  thinking: "disabled",
};

const config = {
  providerProfiles: {
    advanced: "deepseek/deepseek-v4-pro",
    balanced: "deepseek/deepseek-v4-flash",
    basic: "deepseek/deepseek-v4-flash",
  },
  providers: { deepseek: { models: ["deepseek-v4-flash"], thinking: "disabled" } },
  tui: { theme: "edex" },
  transport: { maxOutputTokens: 4096 },
};

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

let latest!: ReturnType<typeof useSettingsConfig>;
let calls: Call[] = [];
let onSaved: ServerInfo[] = [];
let closed = 0;
const originalFetch = globalThis.fetch;

function Harness() {
  latest = useSettingsConfig({
    open: true,
    url: "http://127.0.0.1:3100",
    adminToken: "secret",
    serverInfo,
    onSaved: info => onSaved.push(info),
    onClose: () => { closed += 1; },
  });
  return <box><text>{latest.error ?? "ready"}</text></box>;
}

function request(url: string, init: RequestInit = {}) {
  calls.push({
    url,
    method: init.method ?? "GET",
    headers: (init.headers ?? {}) as Record<string, string>,
    body: init.body as string | undefined,
  });
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  calls = [];
  onSaved = [];
  closed = 0;
});
afterEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = false;
  globalThis.fetch = originalFetch;
});

async function mount(handler: (url: string, init: RequestInit) => Promise<Response>) {
  (globalThis as any).fetch = async (url: string, init: RequestInit = {}) => {
    request(url, init);
    return handler(url, init);
  };
  const setup = await createTestRenderer({ width: 20, height: 4 });
  const root = createRoot(setup.renderer);
  await act(async () => {
    root.render(<Harness />);
    await Promise.resolve();
  });
  await setup.renderOnce();
  return {
    setup,
    root,
    async flush() {
      await act(async () => { await Promise.resolve(); });
      await setup.renderOnce();
    },
    async destroy() {
      await act(async () => root.unmount());
      setup.renderer.destroy();
    },
  };
}

test("loads values, patches changed fields and resets through the hook", async () => {
  const ctx = await mount(async (url, init) => {
    if (init.method === "PATCH") return json({ ...config, tui: { theme: "dracula" } });
    if (init.method === "DELETE") return json(config);
    return json(config);
  });
  try {
    expect(calls[0].url).toBe("http://127.0.0.1:3100/api/config");
    expect(calls[0].headers).toEqual({ "x-atom-admin-token": "secret" });
    expect(latest.values).toEqual({
      advanced: "deepseek/deepseek-v4-pro",
      balanced: "deepseek/deepseek-v4-flash",
      basic: "deepseek/deepseek-v4-flash",
      fast: "deepseek/deepseek-v4-flash",
      theme: "edex",
      thinking: "disabled",
      maxTokens: "4096",
    });

    await act(async () => latest.setValues(prev => ({ ...prev, theme: "dracula" })));
    await act(async () => { await latest.patch(); });
    await ctx.flush();
    expect(calls[1].method).toBe("PATCH");
    expect(calls[1].headers).toEqual({ "content-type": "application/json", "x-atom-admin-token": "secret" });
    expect(JSON.parse(calls[1].body!)).toEqual({ tui: { theme: "dracula" } });
    expect(onSaved[0]?.theme).toBe("dracula");
    expect(closed).toBe(1);

    await act(async () => { await latest.reset(); });
    await ctx.flush();
    expect(calls[2].method).toBe("DELETE");
    expect(calls[2].headers).toEqual({ "x-atom-admin-token": "secret" });
    expect(closed).toBe(2);
  } finally {
    await ctx.destroy();
  }
});

test("surfaces GET, PATCH and DELETE failures", async () => {
  let phase: "get" | "patch" | "delete" = "get";
  const ctx = await mount(async (_url, init) => {
    if (phase === "get") return json({ error: "down" }, 500);
    if (phase === "patch") return init.method === "PATCH" ? json({ error: "bad patch" }, 400) : json(config);
    return json({ error: "bad reset" }, 409);
  });
  try {
    expect(latest.error).toBe("GET /api/config → 500");

    phase = "patch";
    await act(async () => { await latest.load(); });
    await ctx.flush();
    expect(latest.error).toBeNull();
    await act(async () => { await latest.patch(); });
    await ctx.flush();
    expect(latest.error).toBe("bad patch");

    phase = "delete";
    await act(async () => { await latest.reset(); });
    await ctx.flush();
    expect(latest.error).toBe("DELETE /api/config/runtime → 409");
  } finally {
    await ctx.destroy();
  }
});
