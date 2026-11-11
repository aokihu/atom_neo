import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  isAdminRequest, configGetHandler, configPatchHandler, configResetHandler,
} from "./config";

const TOKEN = "secret-token";

function fakeCtx(ip: string) {
  return { ip };
}

function req(headers: Record<string, string>, body?: string): Request {
  return new Request("http://127.0.0.1:3100/api/config", {
    method: body === undefined ? "GET" : "PATCH",
    headers,
    ...(body === undefined ? {} : { body }),
  });
}

function makeRuntime() {
  const schema = z.object({
    tui: z.object({ theme: z.enum(["edex", "dracula"]) }).optional(),
  }).strict();
  return {
    appConfig: { tui: { theme: "edex" } },
    updateRuntimeConfig: (patch: unknown) => {
      const parsed = schema.parse(patch);
      return { tui: { theme: parsed.tui?.theme ?? "edex" } };
    },
    resetRuntimeConfig: () => ({ tui: { theme: "edex" } }),
  };
}

describe("isAdminRequest", () => {
  test("only accepts remote management when explicitly enabled and correctly authenticated", () => {
    expect(isAdminRequest(req({ "x-atom-admin-token": TOKEN }), fakeCtx("192.168.1.10"), TOKEN, true)).toBe(true);
    expect(isAdminRequest(req({}), fakeCtx("192.168.1.10"), TOKEN, true)).toBe(false);
    expect(isAdminRequest(req({ "x-atom-admin-token": "wrong" }), fakeCtx("192.168.1.10"), TOKEN, true)).toBe(false);
    expect(isAdminRequest(req({ "x-atom-admin-token": TOKEN }), fakeCtx(""), TOKEN, true)).toBe(false);
  });
  test("rejects requests without a token", () => {
    expect(isAdminRequest(req({}), fakeCtx("127.0.0.1"), TOKEN)).toBe(false);
  });

  test("rejects requests with a wrong token", () => {
    expect(isAdminRequest(req({ "x-atom-admin-token": "nope" }), fakeCtx("127.0.0.1"), TOKEN)).toBe(false);
  });

  test("rejects non-loopback sources even with the token", () => {
    expect(isAdminRequest(req({ "x-atom-admin-token": TOKEN }), fakeCtx("192.168.1.10"), TOKEN)).toBe(false);
  });

  test("rejects when no admin token is configured on the server", () => {
    expect(isAdminRequest(req({ "x-atom-admin-token": TOKEN }), fakeCtx("127.0.0.1"), undefined)).toBe(false);
  });

  test("accepts every loopback form with the correct token", () => {
    for (const ip of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      expect(isAdminRequest(req({ "x-atom-admin-token": TOKEN }), fakeCtx(ip), TOKEN)).toBe(true);
    }
  });
});

describe("config handlers", () => {
  test("GET returns the effective config", async () => {
    const res = configGetHandler(makeRuntime());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tui: { theme: "edex" } });
  });

  test("PATCH applies a valid patch", async () => {
    const runtime = makeRuntime();
    const res = await configPatchHandler(runtime, req({ "content-type": "application/json" }, JSON.stringify({ tui: { theme: "dracula" } })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tui: { theme: "dracula" } });
  });

  test("PATCH rejects a non-object body", async () => {
    const res = await configPatchHandler(makeRuntime(), req({ "content-type": "application/json" }, '"text"'));
    expect(res.status).toBe(400);
  });

  test("PATCH rejects invalid values with issue details", async () => {
    const runtime = makeRuntime();
    const res = await configPatchHandler(runtime, req({ "content-type": "application/json" }, JSON.stringify({ tui: { theme: "neon" } })));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Invalid config patch");
    expect(Array.isArray(data.issues)).toBe(true);
    expect(data.issues[0].path).toBe("tui.theme");
  });

  test("PATCH rejects forbidden subtrees (gateway)", async () => {
    const runtime = makeRuntime();
    const res = await configPatchHandler(runtime, req({ "content-type": "application/json" }, JSON.stringify({ gateway: { port: 4000 } })));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid config patch");
  });

  test("DELETE resets to the user config", async () => {
    const res = configResetHandler(makeRuntime());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tui: { theme: "edex" } });
  });
});
