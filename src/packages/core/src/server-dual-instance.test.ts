/**
 * S11 exit gate: two complete Core instances in one process.
 * Each Core owns its element registry, prompt resolver, pipeline store,
 * session store and timers; stopping one must not affect the other.
 */
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Logger } from "@atom-neo/shared";
import { startCore } from "./server";
import type { CoreServices } from "./core-services";
import type { RuntimeLike } from "./pipeline-factory";

type CoreHandle = Awaited<ReturnType<typeof startCore>>;

function makeServices(tag: string): CoreServices {
  return {
    memory: {
      search: async () => [],
      getById: () => null,
      save: () => `${tag}-memory`,
      traverse: () => [],
      link: () => false,
      forget: () => false,
      retain: () => {},
    },
    network: {
      webFetch: async () => ({ ok: true, code: "success", content: tag }),
    },
  };
}

function makeRuntime(sandbox: string, tag: string): RuntimeLike {
  return {
    sandbox,
    appConfig: {
      tui: { theme: tag === "a" ? "edex" : "dracula" },
      providers: {},
    },
    maxTokens: 128,
    getResolvedModel: () => ({ provider: "local", model: `local-${tag}`, apiKey: "test" }),
    updateRuntimeConfig: () => ({}),
    resetRuntimeConfig: () => ({}),
  };
}

const ADMIN_A = "dual-instance-admin-a";
const ADMIN_B = "dual-instance-admin-b";

async function jsonRequest(url: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const response = await fetch(url, init);
  return { status: response.status, body: await response.json() };
}

async function isHealthy(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1_000) });
    return response.status === 200;
  } catch {
    return false;
  }
}

test("two startCore instances stay isolated across health, attach and stop", async () => {
  const sandboxA = mkdtempSync(join(tmpdir(), "atom-dual-a-"));
  const sandboxB = mkdtempSync(join(tmpdir(), "atom-dual-b-"));
  const logsA: any[] = [];
  const logsB: any[] = [];
  let coreA: CoreHandle | undefined;
  let coreB: CoreHandle | undefined;

  try {
    coreA = await startCore({
      port: 0,
      host: "127.0.0.1",
      logger: new Logger("debug", entry => logsA.push(entry)),
      services: makeServices("a"),
      runtime: makeRuntime(sandboxA, "a"),
      version: "dual-a",
      adminToken: ADMIN_A,
    });
    coreB = await startCore({
      port: 0,
      host: "127.0.0.1",
      logger: new Logger("debug", entry => logsB.push(entry)),
      services: makeServices("b"),
      runtime: makeRuntime(sandboxB, "b"),
      version: "dual-b",
      adminToken: ADMIN_B,
    });

    expect(coreA.port).toBeGreaterThan(0);
    expect(coreB.port).toBeGreaterThan(0);
    expect(coreA.port).not.toBe(coreB.port);

    const urlA = `http://127.0.0.1:${coreA.port}`;
    const urlB = `http://127.0.0.1:${coreB.port}`;

    const healthA = await jsonRequest(`${urlA}/api/health`);
    const healthB = await jsonRequest(`${urlB}/api/health`);
    expect(healthA.status).toBe(200);
    expect(healthB.status).toBe(200);
    expect(healthA.body).toMatchObject({ status: "ok", queue: { waiting: 0, active: 0, processing: 0 } });
    expect(healthB.body).toMatchObject({ status: "ok", queue: { waiting: 0, active: 0, processing: 0 } });

    // Both instances registered the same pipeline elements during startup.
    // A shared module-level registry would have thrown `already registered`.
    expect(coreA.tools.length).toBeGreaterThan(0);
    expect(coreA.tools).toEqual(coreB.tools);

    const attachA = await jsonRequest(`${urlA}/api/tui/attach`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-atom-admin-token": ADMIN_A },
      body: "{}",
    });
    const attachB = await jsonRequest(`${urlB}/api/tui/attach`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-atom-admin-token": ADMIN_B },
      body: "{}",
    });
    expect(attachA.status).toBe(200);
    expect(attachB.status).toBe(200);
    expect(attachA.body.sessionId).not.toBe(attachB.body.sessionId);
    expect(attachA.body.serverInfo).toMatchObject({
      port: coreA.port,
      sandbox: sandboxA,
      version: "dual-a",
      theme: "edex",
      model: "local-a",
    });
    expect(attachB.body.serverInfo).toMatchObject({
      port: coreB.port,
      sandbox: sandboxB,
      version: "dual-b",
      theme: "dracula",
      model: "local-b",
    });

    // Admin credentials are per instance as well.
    const crossAttach = await jsonRequest(`${urlB}/api/tui/attach`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-atom-admin-token": ADMIN_A },
      body: "{}",
    });
    expect(crossAttach.status).toBe(403);

    // Session stores are per Core: A's session is unknown to B.
    const sessionOnA = await fetch(`${urlA}/api/sessions/${encodeURIComponent(attachA.body.sessionId)}`);
    expect(sessionOnA.status).toBe(200);
    const sessionOnB = await fetch(`${urlB}/api/sessions/${encodeURIComponent(attachA.body.sessionId)}`);
    expect(sessionOnB.status).toBe(404);
    expect(await sessionOnB.json()).toEqual({ error: "Session not found" });

    // Each Core ready log belongs only to its own port.
    expect(logsA.some(entry => entry.message === "core ready" && entry.context?.port === coreA!.port)).toBe(true);
    expect(logsB.some(entry => entry.message === "core ready" && entry.context?.port === coreB!.port)).toBe(true);

    // Stopping A leaves B fully usable.
    await coreA.stop();
    expect(await isHealthy(urlA)).toBe(false);
    expect(await isHealthy(urlB)).toBe(true);

    const attachAfterStop = await jsonRequest(`${urlB}/api/tui/attach`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-atom-admin-token": ADMIN_B },
      body: JSON.stringify({ continue: false }),
    });
    expect(attachAfterStop.status).toBe(200);
    expect(attachAfterStop.body.serverInfo.sandbox).toBe(sandboxB);

    await coreB.stop();
    expect(await isHealthy(urlB)).toBe(false);
  } finally {
    await coreA?.stop().catch(() => {});
    await coreB?.stop().catch(() => {});
    rmSync(sandboxA, { recursive: true, force: true });
    rmSync(sandboxB, { recursive: true, force: true });
  }
});
