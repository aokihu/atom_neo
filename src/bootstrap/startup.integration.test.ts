import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { TuiClient } from "../packages/tui/src/client/ws-client";

// Explicit opt-in: compiles binaries and starts isolated local processes.
const integration = test.skipIf(process.env.ATOM_RUN_STARTUP_VALIDATION !== "1");
const root = resolve(import.meta.dir, "../..");
let temp: string;
let binary: string;
let clientBinary: string;
let model: ReturnType<typeof Bun.serve>;
let modelCalls = 0;
let delayNextModel = false;
let releaseModel: (() => void) | undefined;
const processes: Bun.Subprocess[] = [];
const clients = new Set<number>();
const env = { PATH: process.env.PATH!, HOME: process.env.HOME!, TERM: "xterm-256color", ATOM_TEST_KEY: "local-test-only" };

async function waitFor(check: () => boolean | Promise<boolean>, label: string, timeout = 8000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (await check()) return; await Bun.sleep(30); }
  throw new Error(`Timed out: ${label}`);
}
async function finish(proc: Bun.Subprocess, signal: "SIGTERM" | "SIGINT" = "SIGTERM") {
  if (proc.exitCode === null) proc.kill(signal);
  await waitFor(() => proc.exitCode !== null, "process exit");
  expect(await proc.exited).toBe(0);
}
async function run(command: string[], cwd = temp) {
  const proc = Bun.spawn(command, { cwd, env, stdout: "pipe", stderr: "pipe" });
  processes.push(proc);
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { stdout, stderr, code };
}
function sandbox(name: string, gatewayClients: unknown[] = []) {
  const path = join(temp, name);
  mkdirSync(join(path, ".atom"), { recursive: true });
  writeFileSync(join(path, "AGENTS.md"), "");
  writeFileSync(join(path, ".atom/installed"), "");
  writeFileSync(join(path, "config.json"), JSON.stringify({ version: 2,
    providerProfiles: { advanced: "deepseek/local", balanced: "deepseek/local", basic: "deepseek/local" },
    providers: { deepseek: { apiKeyEnv: "ATOM_TEST_KEY", models: ["local"], baseUrl: `http://127.0.0.1:${model.port}/v1` } },
    conversation: { maxSteps: 1, maxChainDepth: 1 }, gateway: { port: 0, clients: gatewayClients },
  }));
  return path;
}
type Instance = { url: string; token: string; instanceId: string };
function instance(path: string, kind = "core"): Instance {
  return JSON.parse(readFileSync(join(path, `.atom/${kind}-runtime.json`), "utf8"));
}
async function start(path: string, mode = "core", source = false, port = "0") {
  const command = source ? [process.execPath, "run", join(root, "src/main.ts")] : [binary];
  const proc = Bun.spawn([...command, "--mode", mode, "--sandbox", path, "--port", port], { cwd: temp, env, stdout: "ignore", stderr: "pipe" });
  processes.push(proc);
  await waitFor(() => {
    if (proc.exitCode !== null) throw new Error(`Core exited: ${proc.exitCode}`);
    return existsSync(join(path, ".atom/core-runtime.json"));
  }, "Core ready");
  if (mode === "core-gateway") await waitFor(() => existsSync(join(path, ".atom/gateway-runtime.json")), "Gateway ready");
  return { proc, ...instance(path) };
}
async function attach(core: Instance, continueSession = false) {
  const response = await fetch(`${core.url}/api/tui/attach`, { method: "POST", headers: { "x-atom-admin-token": core.token, "Content-Type": "application/json" }, body: JSON.stringify({ continue: continueSession }) });
  expect(response.status).toBe(200);
  return await response.json() as { sessionId: string; serverInfo: { sandbox: string } };
}
async function submit(core: Instance, body: unknown) {
  return fetch(`${core.url}/api/tasks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
function alive(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }

beforeAll(async () => {
  if (process.env.ATOM_RUN_STARTUP_VALIDATION !== "1") return;
  temp = mkdtempSync(join(tmpdir(), "atom-startup-validation-"));
  binary = join(temp, "atom"); clientBinary = join(temp, "client");
  model = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    modelCalls++;
    const body = await req.json() as { stream?: boolean };
    if (delayNextModel) {
      delayNextModel = false;
      await new Promise<void>(resolve => { releaseModel = resolve; });
    }
    const base = { id: "local-result", created: 1, model: "local" };
    if (!body.stream) return Response.json({ ...base, object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: "{}" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
    const chunks = [
      { ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: "LOCAL_VERIFIED" }, finish_reason: null }] },
      { ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ];
    return new Response(chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
  } });
  for (const [input, output] of [[join(root, "src/main.ts"), binary], [join(import.meta.dir, "fixtures/gateway-client.ts"), clientBinary]]) {
    const result = await run([process.execPath, "build", input, "--compile", `--target=bun-${process.platform}-${process.arch}`, `--outfile=${output}`], root);
    expect(result.code, result.stderr).toBe(0);
  }
}, 30000);

afterAll(async () => {
  for (const proc of processes) if (proc.exitCode === null) proc.kill("SIGKILL");
  for (const pid of clients) if (alive(pid)) process.kill(pid, "SIGKILL");
  await Promise.all(processes.map(p => p.exited));
  model?.stop(true);
  if (temp) rmSync(temp, { recursive: true, force: true });
});

integration("CLI errors cause no sandbox initialization", async () => {
  for (const args of [["--mode", "tui"], ["--mode", "gateway"], ["--port", "65536"], ["--mode", "invalid"], ["--sandbox="], ["--clients", "bot"], ["run"]]) {
    const result = await run([binary, ...args]);
    expect(result.code).not.toBe(0);
    expect(existsSync(join(temp, ".atom"))).toBe(false);
  }
});

integration("source and binary Core create new sessions by default and explicitly continue across restart", async () => {
  for (const source of [true, false]) {
    const path = sandbox(source ? "source" : "binary");
    let core = await start(path, "core", source);
    expect(statSync(join(path, ".atom/core-runtime.json")).mode & 0o777).toBe(0o600);
    const forbidden = await fetch(`${core.url}/api/tui/attach`, { method: "POST" });
    expect(forbidden.status).toBe(403);
    for (const body of ['{"continue":"true"}', '{', 'null']) {
      const invalid = await fetch(`${core.url}/api/tui/attach`, { method: "POST",
        headers: { "x-atom-admin-token": core.token }, body });
      expect(invalid.status).toBe(400);
    }
    const empty = await fetch(`${core.url}/api/tui/attach`, { method: "POST",
      headers: { "x-atom-admin-token": core.token } });
    expect(empty.status).toBe(200);
    const emptySession = await empty.json() as { sessionId: string };
    const fresh = await Promise.all([attach(core), attach(core)]);
    expect(fresh[0].sessionId).not.toBe(emptySession.sessionId);
    expect(fresh[0].sessionId).not.toBe(fresh[1].sessionId);
    const selections = await Promise.all([attach(core, true), attach(core, true)]);
    expect(selections[0].sessionId).toBe(selections[1].sessionId);
    expect(selections[0].serverInfo.sandbox).toBe(path);
    const sessionId = selections[0].sessionId;
    const response = await submit(core, { sessionId, platform: "tui", initiator: { type: "tui" }, pipeline: "conversation", data: { text: "test-message" } });
    expect(response.status).toBe(201);
    const { taskId } = await response.json() as { taskId: string };
    await waitFor(async () => (await (await fetch(`${core.url}/api/tasks/${taskId}`)).json() as { state: string }).state === "completed", "local model task completion");
    const client = new TuiClient({ url: core.url, sessionId });
    let messages: { content: string }[] = [];
    client.onSnapshot(value => { messages = value; });
    await client.connect(); client.close();
    expect(messages.some(m => m.content === "test-message")).toBe(true);
    expect((await fetch(`${core.url}/api/health`)).status).toBe(200);
    await finish(core.proc);
    expect(existsSync(join(path, ".atom/core-runtime.json"))).toBe(false);
    core = await start(path, "core", source);
    expect((await attach(core, true)).sessionId).toBe(sessionId);
    expect((await attach(core)).sessionId).not.toBe(sessionId);
    await finish(core.proc, "SIGINT");
  }
}, 30000);

integration("Gateway controls individual/all Clients and cancels crash restart", async () => {
  const recordA = join(temp, "client-a.json"), recordB = join(temp, "client-b.json");
  const path = sandbox("gateway", [
    { id: "a", platform: "local", binary: clientBinary, clientArgs: { record: recordA }, stdio: "ignore" },
    { id: "b", platform: "local", binary: clientBinary, clientArgs: { record: recordB }, stdio: "ignore" },
  ]);
  const core = await start(path, "core-gateway");
  const gateway = instance(path, "gateway");
  const record = (file: string) => { const data = JSON.parse(readFileSync(file, "utf8")); clients.add(data.pid); return data; };
  const a = record(recordA), b = record(recordB);
  expect(alive(a.pid) && alive(b.pid)).toBe(true);
  const denied = await fetch(`${gateway.url}/admin/clients`, { method: "POST", headers: { "x-atom-admin-token": a.secret }, body: JSON.stringify({ action: "stop" }) });
  expect(denied.status).toBe(403);
  const control = (action: string, id?: string) => run([binary, "--mode", "gateway", "--sandbox", path, "--action", action, ...(id === undefined ? [] : ["--clients", id])]);
  expect((await control("stop", "a")).code).toBe(0);
  expect(alive(a.pid)).toBe(false); expect(alive(b.pid)).toBe(true);
  expect((await control("stop", "a")).code).toBe(0);
  expect((await control("start", "a")).code).toBe(0);
  const restarted = record(recordA);
  expect(restarted.pid).not.toBe(a.pid);
  process.kill(restarted.pid, "SIGKILL");
  await waitFor(() => !alive(restarted.pid), "crashed client exit");
  expect((await control("stop", "a")).code).toBe(0);
  await Bun.sleep(1500);
  expect(record(recordA).pid).toBe(restarted.pid);
  const stale = await fetch(`${gateway.url}/gateway/event`, { method: "POST", headers: { "X-Gateway-Secret": restarted.secret }, body: "{}" });
  expect(stale.status).toBe(401);
  expect((await control("start", "absent")).code).not.toBe(0);
  expect((await control("start")).code).toBe(0);
  const finalA = record(recordA), finalB = record(recordB);
  expect((await control("stop")).code).toBe(0);
  expect(alive(finalA.pid) || alive(finalB.pid)).toBe(false);
  expect((await fetch(`${core.url}/api/health`)).status).toBe(200);
  await finish(core.proc);
  expect(existsSync(join(path, ".atom/gateway-runtime.json"))).toBe(false);
}, 30000);

integration("restored global timer executes without TUI or incoming messages", async () => {
  const path = sandbox("headless-timer");
  writeFileSync(join(path, "hooks.json"), JSON.stringify([{ id: "scheduled", name: "offline timer", scope: "global", sessionId: "saved-session", trigger: { type: "time:interval", intervalMs: 100 }, prompt: "scheduled-work", enabled: true, createdAt: 1, updatedAt: 1 }]));
  const before = modelCalls;
  const core = await start(path);
  try { await waitFor(() => modelCalls > before, "headless timer reaches local model", 2000); }
  finally { await finish(core.proc); }
});

integration("TUI terminal quits cleanly in default and attached modes", async () => {
  const runner = join(import.meta.dir, "fixtures/terminal-runner.py");
  const local = sandbox("default-terminal");
  const first = await run(["python3", runner, "quit", binary, "--sandbox", local, "--port", "0"]);
  expect(first.code, first.stderr).toBe(0);
  const firstResult = JSON.parse(first.stdout);
  expect(firstResult.timedOut, firstResult.tail).toBe(false);
  expect(firstResult.code, firstResult.tail).toBe(0);
  expect(firstResult.outputBytes).toBeGreaterThan(100);
  expect(firstResult.scheduleBarVisible).toBe(true);
  expect(existsSync(join(local, ".atom/core-runtime.json"))).toBe(false);
  const path = sandbox("attached-terminal");
  writeFileSync(join(path, "hooks.json"), JSON.stringify([{ id: "expired-ui", name: "Expired reminder", scope: "global", trigger: { type: "time:delay", delayMs: 1 }, prompt: "never execute", enabled: true, createdAt: 1, updatedAt: 1 }]));
  const core = await start(path);
  try {
    for (const mode of ["quit", "quit-compact"]) {
      const result = await run(["python3", runner, mode, binary, "--mode", "tui", "--core-server", "127.0.0.1", "--core-port", new URL(core.url).port, "--sandbox", path]);
      const terminal = JSON.parse(result.stdout);
      expect(terminal.timedOut, terminal.tail).toBe(false);
      expect(terminal.code, terminal.tail).toBe(0);
      expect(terminal.scheduleBarVisible).toBe(mode !== "quit-compact");
      expect(terminal.expiredVisible).toBe(mode !== "quit-compact");
    }
    expect((await fetch(`${core.url}/api/health`)).status).toBe(200);
  } finally { await finish(core.proc); }
}, 30000);

integration("expired schedules are not replayed and schedule summaries require admin credentials", async () => {
  const path = sandbox("expired-timer");
  writeFileSync(join(path, "hooks.json"), JSON.stringify([{ id: "expired", name: "expired", scope: "global", sessionId: "saved", trigger: { type: "time:delay", delayMs: 1 }, prompt: "private prompt", enabled: true, createdAt: 1, updatedAt: 1 }]));
  const before = modelCalls;
  for (let i = 0; i < 2; i++) {
    const core = await start(path);
    try {
      expect((await fetch(`${core.url}/api/schedules`)).status).toBe(403);
      const response = await fetch(`${core.url}/api/schedules`, { headers: { "x-atom-admin-token": core.token } });
      const tasks = await response.json() as any[];
      expect(tasks).toHaveLength(1);
      expect(tasks[0].enabled).toBe(false);
      expect(tasks[0].expiredAt).toBeDefined();
      expect(tasks[0].prompt).toBeUndefined();
      await Bun.sleep(100);
      expect(modelCalls).toBe(before);
    } finally { await finish(core.proc); }
  }
});

integration("Core shutdown cancels a running global timer and leaves no later executions", async () => {
  const path = sandbox("timer-shutdown");
  writeFileSync(join(path, "hooks.json"), JSON.stringify([{ id: "repeat", name: "repeat", scope: "global", sessionId: "saved", trigger: { type: "time:interval", intervalMs: 100 }, prompt: "work", enabled: true, createdAt: 1, updatedAt: 1 }]));
  releaseModel = undefined;
  delayNextModel = true;
  const core = await start(path);
  try {
    await waitFor(() => !!releaseModel, "scheduled model starts");
    await Bun.sleep(220);
    await finish(core.proc);
    const afterStop = modelCalls;
    releaseModel?.();
    await Bun.sleep(250);
    expect(modelCalls).toBe(afterStop);
    expect(existsSync(join(path, ".atom/core-runtime.json"))).toBe(false);
  } finally {
    releaseModel?.();
    delayNextModel = false;
    await finish(core.proc);
  }
}, 15000);

integration("aborting first-run wizard must not install or start Core", async () => {
  for (const key of ["abort", "abort-c"]) {
    const path = sandbox(`wizard-${key}`);
    rmSync(join(path, ".atom/installed"));
    const result = await run(["python3", join(import.meta.dir, "fixtures/terminal-runner.py"), key, binary, "--sandbox", path, "--port", "0"]);
    const terminal = JSON.parse(result.stdout);
    expect(terminal.timedOut, terminal.tail).toBe(false);
    expect(terminal.code).not.toBe(0);
    expect(existsSync(join(path, ".atom/installed"))).toBe(false);
    expect(existsSync(join(path, ".atom/core-runtime.json"))).toBe(false);
  }
}, 15000);

integration("cancelling config editor must not start Core", async () => {
  const path = sandbox("config-abort");
  const configPath = join(path, "config.json");
  const before = await Bun.file(configPath).text();
  const result = await run(["python3", join(import.meta.dir, "fixtures/terminal-runner.py"), "abort", binary, "--config", "--sandbox", path]);
  const terminal = JSON.parse(result.stdout);
  expect(terminal.timedOut, terminal.tail).toBe(false);
  expect(terminal.code).toBe(0);
  expect(await Bun.file(configPath).text()).toBe(before);
  expect(existsSync(join(path, ".atom/core-runtime.json"))).toBe(false);
}, 15000);

integration("Gateway origin conflicts cannot replace session metadata or default TUI selection", async () => {
  const path = sandbox("origin-conflict");
  const core = await start(path);
  try {
    const tui = await attach(core);
    const task = { sessionId: "local:user", platform: "local", pipeline: "conversation", data: { text: "gateway-message" }, initiator: { type: "gateway", clientId: "a", platform: "local" } };
    expect((await submit(core, task)).status).toBe(201);
    expect((await submit(core, { ...task, initiator: { ...task.initiator, clientId: "b" } })).status).toBe(409);
    expect((await attach(core, true)).sessionId).toBe(tui.sessionId);
  } finally { await finish(core.proc); }
});

integration("disconnect during a running task preserves execution and reports active snapshot", async () => {
  const path = sandbox("active-detach");
  const core = await start(path);
  const { sessionId } = await attach(core);
  const client = new TuiClient({ url: core.url, sessionId });
  let busy = false;
  client.onBusyChange(value => { busy = value; });
  releaseModel = undefined;
  delayNextModel = true;
  try {
    const response = await submit(core, { sessionId, platform: "tui", pipeline: "conversation", data: { text: "slow-task" } });
    const { taskId } = await response.json() as { taskId: string };
    await waitFor(() => Boolean(releaseModel), "model request held");
    await client.connect();
    expect(busy).toBe(true);
    client.close();
    expect((await fetch(`${core.url}/api/health`)).status).toBe(200);
    releaseModel!();
    await waitFor(async () => (await (await fetch(`${core.url}/api/tasks/${taskId}`)).json() as { state: string }).state === "completed", "detached task completion");
  } finally {
    delayNextModel = false;
    releaseModel?.();
    client.close();
    await finish(core.proc);
  }
});

integration("package build:bin generates valid version source", async () => {
  const path = join(temp, "build-script");
  mkdirSync(join(path, "src"), { recursive: true });
  const project = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  writeFileSync(join(path, "package.json"), JSON.stringify({ version: project.version, scripts: { "build:bin": project.scripts["build:bin"] } }));
  writeFileSync(join(path, "src/main.ts"), 'import { VERSION } from "./version"; console.log(VERSION);\n');
  const result = await run([process.execPath, "run", "build:bin"], path);
  expect(result.code, result.stderr).toBe(0);
  expect(existsSync(join(path, "dist/atom"))).toBe(true);
  const executed = await run([join(path, "dist/atom")], path);
  expect(executed.code, executed.stderr).toBe(0);
  expect(executed.stdout.trim()).toBe(project.version);
}, 15000);

integration("occupied port and failed Client startup leave no Core resources", async () => {
  const blocker = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("occupied") });
  const occupied = sandbox("occupied");
  try {
    const result = await run([binary, "--mode", "core", "--sandbox", occupied, "--port", String(blocker.port)]);
    expect(result.code).not.toBe(0);
    expect(existsSync(join(occupied, ".atom/core-runtime.json"))).toBe(false);
  } finally { blocker.stop(true); }
  const broken = sandbox("broken-client", [{ id: "broken", platform: "local", binary: join(temp, "missing-binary") }]);
  const result = await run([binary, "--mode", "core-gateway", "--sandbox", broken, "--port", "0"]);
  expect(result.code).not.toBe(0);
  expect(existsSync(join(broken, ".atom/core-runtime.json"))).toBe(false);
  expect(existsSync(join(broken, ".atom/gateway-runtime.json"))).toBe(false);
}, 15000);
