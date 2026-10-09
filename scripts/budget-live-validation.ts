/** Isolated, serial live acceptance. Never modifies the user's sandbox. */
import { mkdtempSync, mkdirSync, readFileSync, copyFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { startCore } from "../src/packages/core/src/server";
import { Logger } from "@atom-neo/shared";
import { loadEnv } from "../src/bootstrap/env";
import { loadConfig } from "../src/bootstrap/config";
import { RuntimeService } from "../src/services/runtime-service";
import { MemoryService } from "../src/services/memory-service";
import { NetworkService } from "../src/services/network/network-service";

const source = join(process.cwd(), "sandbox");
const dir = mkdtempSync(join(tmpdir(), "atom-budget-live-"));
const sandbox = join(dir, "sandbox");
const sid = `budget-${Date.now()}`;
const questions = ["还记得CODE是多少", "杭州今天天气怎么样", "一口气输出输出世界文明发展的历史，不少于10段，每段不少于800字，用表格优化输出内容"];
const configHash = createHash("sha256").update(readFileSync(join(source, "config.json"))).digest("hex");
mkdirSync(join(sandbox, ".atom/memory"), { recursive: true });
copyFileSync(join(source, ".env"), join(sandbox, ".env"));
copyFileSync(join(source, "AGENTS.md"), join(sandbox, "AGENTS.md"));
// sqlite backup honors an active WAL while leaving the source read-only.
const backup = Bun.spawn(["python3", "-c", "import sqlite3,sys; s=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()",
  join(source, ".atom/memory/memory.db"), join(sandbox, ".atom/memory/memory.db")], { stdout: "ignore", stderr: "pipe" });
if (await backup.exited !== 0) throw new Error("Memory backup failed");
loadEnv(sandbox);
const config = JSON.parse(readFileSync(join(source, "config.json"), "utf8"));
config.conversation = { ...config.conversation, maxGlobalRounds: 100, maxLocalRounds: 5 };
const routes = new Map<string, { endpoint: string; native: boolean }>();
let busy: Promise<void> = Promise.resolve();
let lastStart = 0;
const calls: any[] = [];
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const waitReady = async (signal?: AbortSignal) => {
  await busy;
  signal?.throwIfAborted();
  await sleep(Math.max(0, lastStart + 5000 - Date.now()));
  signal?.throwIfAborted();
};
const proxy = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 255, async fetch(request) {
  const url = new URL(request.url);
  const route = [...routes.entries()].find(([prefix]) => url.pathname.startsWith(prefix));
  if (!route) return new Response("Unknown model route", { status: 404 });
  const previous = busy;
  let unlock: () => void = () => {};
  busy = new Promise<void>(resolve => { unlock = resolve; });
  const queuedAt = Date.now();
  await previous;
  await sleep(Math.max(0, lastStart + 5000 - Date.now()));
  const startedAt = lastStart = Date.now();
  const [prefix, target] = route;
  const endpoint = target.native ? target.endpoint : target.endpoint.replace(/\/$/, "") + url.pathname.slice(prefix.length);
  const record: any = { queuedAt, startedAt, waitMs: startedAt - queuedAt, native: target.native, route: prefix };
  calls.push(record);
  try {
    const response = await fetch(endpoint, { method: request.method,
      headers: { Authorization: request.headers.get("Authorization") ?? "", "Content-Type": "application/json" },
      body: await request.text(), signal: request.signal });
    const body = await response.arrayBuffer(); // hold the slot through the complete upstream response
    Object.assign(record, { status: response.status, finishedAt: Date.now() });
    writeFileSync(join(dir, "model-timeline.json"), JSON.stringify(calls, null, 2));
    return new Response(body, { status: response.status, headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/json" } });
  } catch (error) {
    Object.assign(record, { error: String(error), finishedAt: Date.now() });
    return new Response("Upstream model call failed", { status: 502 });
  } finally { unlock(); }
} });
for (const [name, definition] of Object.entries(config.providers ?? {}) as Array<[string, any]>) {
  const native = definition.type === "jev";
  const prefix = `/${native ? "jev" : "llm"}/${encodeURIComponent(name)}`;
  routes.set(prefix, { endpoint: definition.baseUrl ?? "https://api.deepseek.com/v1", native });
  definition.baseUrl = `${proxy.url.toString().replace(/\/$/, "")}${prefix}`;
}
writeFileSync(join(sandbox, "config.json"), JSON.stringify(config));
const runtime = new RuntimeService({ mode: "core", port: 0, host: "127.0.0.1", sandbox,
  apiKey: process.env.DEEPSEEK_API_KEY ?? "", config: loadConfig(sandbox) });
const runtimeAdapter: any = { sandbox, maxTokens: runtime.maxTokens, appConfig: runtime.appConfig,
  getResolvedModel: (profile: any) => ({ ...runtime.getResolvedModel(profile), beforeCall: waitReady }) };
const memory = new MemoryService({ dbPath: join(sandbox, ".atom/memory/memory.db") });
const network = new NetworkService();
await network.start();
const entries: any[] = [];
const compiled = readFileSync(join(source, "AGENTS.md"), "utf8");
let core: Awaited<ReturnType<typeof startCore>> | undefined;
const results: any[] = [];
console.log(JSON.stringify({ dir, sid }));
try {
  core = await startCore({ port: 0, host: "127.0.0.1", runtime: runtimeAdapter,
    logger: new Logger("debug", entry => {
      entries.push(entry);
      appendFileSync(join(dir, "runtime.log"), JSON.stringify(entry) + "\n");
    }), sm: { get: (name: string) => ({ memory, network, "agents-compiler": { getCompiledPrompt: () => compiled } } as any)[name] } });
  const base = `http://127.0.0.1:${core.port}`;
  for (let i = 0; i < questions.length; i++) {
    if (i) await sleep(10000);
    const before = entries.length;
    const submitted = await (await fetch(`${base}/api/tasks`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sid, data: { text: questions[i] } }) })).json();
    const deadline = Date.now() + 20 * 60_000;
    let idle = false;
    while (Date.now() < deadline) {
      const health: any = await (await fetch(`${base}/api/health`)).json();
      if (entries.slice(before).some(entry => entry.message === "task pipeline completed") && health.queue.waiting === 0 && health.queue.active === 0 && health.queue.processing === 0) { idle = true; break; }
      await sleep(1000);
    }
    if (!idle) throw new Error(`Question ${i + 1} exceeded acceptance deadline`);
    const messages: any[] = await (await fetch(`${base}/api/sessions/${sid}`)).json();
    const from = messages.findLastIndex(message => message.role === "user");
    const output = messages.slice(from + 1).filter(message => message.role === "assistant" && message.visible !== false).map(message => message.content).join("\n\n");
    writeFileSync(join(dir, `question-${i + 1}-output.md`), output);
    writeFileSync(join(dir, `question-${i + 1}-messages.json`), JSON.stringify(messages, null, 2));
    results.push({ question: questions[i], submitted, outputChars: output.length, endedAt: Date.now() });
    console.log(JSON.stringify({ question: i + 1, outputChars: output.length, modelCalls: calls.length }));
  }
  const sessionDir = join(sandbox, ".atom/sessions", createHash("sha256").update(sid).digest("hex").slice(0, 32));
  for (const name of ["session.json", "tool-records.jsonl"]) copyFileSync(join(sessionDir, name), join(dir, name));
  writeFileSync(join(dir, "budget-timeline.json"), JSON.stringify(entries.filter(entry => entry.message.startsWith("execution budget:") || entry.message.includes("window-result")), null, 2));
  writeFileSync(join(dir, "results.json"), JSON.stringify(results, null, 2));
} finally {
  await core?.stop();
  await network.stop(); await memory.stop(); proxy.stop(true);
  writeFileSync(join(dir, "model-timeline.json"), JSON.stringify(calls, null, 2));
  writeFileSync(join(dir, "metadata.json"), JSON.stringify({ sid, questions, configHash,
    sourceUnchanged: configHash === createHash("sha256").update(readFileSync(join(source, "config.json"))).digest("hex"),
    maxOutputTokens: runtime.maxTokens, maxGlobalRounds: 100, maxLocalRounds: 5, coreStopped: true,
    credentialsRemoved: true, modelConcurrency: 1, minModelStartGapMs: 5000, betweenQuestionsMs: 10000 }, null, 2));
  rmSync(sandbox, { recursive: true, force: true });
}
