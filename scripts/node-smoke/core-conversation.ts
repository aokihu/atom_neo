/**
 * Real Node smoke for a full fake conversation on the Core runtime.
 *
 * A local OpenAI-compatible model server streams an assistant reply with the
 * `<<<COMPLETE>>>` marker; Core runs on the Node HTTP adapter and must finish
 * the submitted conversation task, persist the reply and exit cleanly.
 *
 * Run:
 *   mkdir -p /tmp/atom-node-conversation-smoke/node_modules
 *   ln -sfn "$PWD/src/packages/shared/node_modules/ws" /tmp/atom-node-conversation-smoke/node_modules/ws
 *   bun build scripts/node-smoke/core-conversation.ts --target node --external ws \
 *     --outfile /tmp/atom-node-conversation-smoke/core-conversation.mjs
 *   node /tmp/atom-node-conversation-smoke/core-conversation.mjs
 */
import { strict as assert } from "node:assert";
import { Buffer } from "node:buffer";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import type { RawData } from "ws";
import { startCore } from "../../src/packages/core/src/server";
import { Logger, WsMessages } from "../../src/packages/shared/src/index";
import { createNodeHttpServer } from "../../src/packages/shared/src/http/node-http-server";

const ADMIN_TOKEN = "node-conversation-smoke-admin";
const FAKE_REPLY = "FAKE-REPLY from the local model";
const COMPLETE_MARKER = "<<<COMPLETE>>>";
let passed = 0;

function pass(name: string): void {
  passed++;
  console.log(`PASS ${name}`);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString();
  return text ? JSON.parse(text) as Record<string, unknown> : {};
}

function sendJson(res: ServerResponse, body: unknown, status = 200): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
}

function startFakeModel(): Promise<{ port: number; streamRequests: number; close: () => Promise<void> }> {
  const state = { streamRequests: 0 };
  const server: Server = createServer(async (req, res) => {
    try {
      const body = await readJson(req);
      if (body.stream === true) {
        state.streamRequests++;
        const base = { id: "local-result", created: 1, model: "local" };
        const chunks = [
          {
            ...base,
            object: "chat.completion.chunk",
            choices: [{ index: 0, delta: { role: "assistant", content: `${FAKE_REPLY} ${COMPLETE_MARKER}` }, finish_reason: null }],
          },
          {
            ...base,
            object: "chat.completion.chunk",
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
          },
        ];
        const payload = chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          "content-length": Buffer.byteLength(payload),
        });
        res.end(payload);
        return;
      }
      sendJson(res, {
        id: "local-result",
        object: "chat.completion",
        created: 1,
        model: "local",
        choices: [{
          index: 0,
          message: { role: "assistant", content: '{"status":"satisfactory","reason":"fake smoke reply"}' },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 },
      });
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("fake model server did not bind a TCP port"));
        return;
      }
      resolve({
        port: address.port,
        get streamRequests() { return state.streamRequests; },
        close: () => new Promise<void>((done) => {
          server.close(() => done());
          server.closeAllConnections?.();
        }),
      });
    });
  });
}

type Frame = Record<string, unknown>;
type FramePredicate = (frame: Frame) => boolean;

function messageQueue(ws: WebSocket): (predicate: FramePredicate) => Promise<Frame> {
  const frames: Frame[] = [];
  let cursor = 0;
  const waiters: Array<{ predicate: FramePredicate; resolve: (frame: Frame) => void; timer: ReturnType<typeof setTimeout> }> = [];

  const dispatch = () => {
    while (waiters.length > 0) {
      const waiter = waiters[0]!;
      let found = -1;
      for (let index = cursor; index < frames.length; index++) {
        if (waiter.predicate(frames[index]!)) {
          found = index;
          break;
        }
      }
      if (found < 0) return;
      cursor = found + 1;
      clearTimeout(waiter.timer);
      waiters.shift();
      waiter.resolve(frames[found]!);
    }
  };

  ws.on("message", (raw: RawData, isBinary: boolean) => {
    if (isBinary) return;
    const text = Array.isArray(raw) ? Buffer.concat(raw).toString() : raw.toString();
    frames.push(JSON.parse(text) as Frame);
    dispatch();
  });

  return (predicate: FramePredicate) => new Promise<Frame>((resolve, reject) => {
    const waiter = {
      predicate,
      resolve,
      timer: setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        reject(new Error("websocket message timeout"));
      }, 10_000),
    };
    waiters.push(waiter);
    dispatch();
  });
}

function waitForOpen(ws: WebSocket): Promise<number> {
  return new Promise((resolve, reject) => {
    let status = 0;
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error("websocket open timeout"));
    }, 10_000);
    ws.once("upgrade", (response) => {
      status = response.statusCode ?? 0;
    });
    ws.once("open", () => {
      clearTimeout(timer);
      resolve(status);
    });
    ws.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function waitForTaskState(base: string, taskId: string): Promise<{ state: string; error?: string }> {
  let last = "waiting";
  for (let attempt = 0; attempt < 400; attempt++) {
    const response = await fetch(`${base}/api/tasks/${taskId}`);
    assert.equal(response.status, 200);
    const status = await response.json() as { state: string; error?: string };
    last = status.state;
    if (last === "completed" || last === "failed" || last === "cancelled") return status;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`task ${taskId} did not finish (last state: ${last})`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const sandbox = await mkdtemp(join(tmpdir(), "atom-node-conversation-smoke-"));
  let core: Awaited<ReturnType<typeof startCore>> | undefined;
  let model: Awaited<ReturnType<typeof startFakeModel>> | undefined;
  let ws: WebSocket | undefined;

  try {
    model = await startFakeModel();
    pass("fake-model-start");

    const runtime = {
      sandbox,
      maxTokens: 4096,
      appConfig: {
        providers: { local: { contextLimit: 200_000 } },
        conversation: { maxGlobalRounds: 4, maxLocalRounds: 2, maxSteps: 4 },
        decisionMode: { prediction: "legacy", postConversation: "legacy", continuation: "rules" },
      },
      getResolvedModel() {
        return {
          provider: "local",
          protocol: "deepseek",
          model: "local",
          type: "llm",
          apiKey: "local-test",
          baseUrl: `http://127.0.0.1:${model!.port}/v1`,
          thinking: "disabled",
        };
      },
    };
    const sm = { get: (name: string) => name === "network" ? {} as any : undefined };

    core = await startCore({
      port: 0,
      host: "127.0.0.1",
      sandbox,
      logger: new Logger("debug", () => {}),
      runtime,
      sm,
      adminToken: ADMIN_TOKEN,
      httpServer: createNodeHttpServer(),
    } as any);
    assert.ok(core.port > 0);
    pass("core-start");

    const base = `http://127.0.0.1:${core.port}`;
    const attach = await fetch(`${base}/api/tui/attach`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-atom-admin-token": ADMIN_TOKEN },
      body: "{}",
    });
    assert.equal(attach.status, 200);
    const attached = await attach.json() as { sessionId?: string };
    assert.ok(attached.sessionId);
    const sessionId = attached.sessionId;
    pass("attach");

    ws = new WebSocket(`ws://127.0.0.1:${core.port}/ws/${encodeURIComponent(sessionId)}`);
    const next = messageQueue(ws);
    assert.equal(await waitForOpen(ws), 101);
    const ready = await next(frame => frame.type === WsMessages.Server.SessionReady);
    assert.equal(ready.type, WsMessages.Server.SessionReady);
    assert.equal((ready.payload as { sessionId?: string }).sessionId, sessionId);
    pass("ws-session-ready");

    const submit = await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId,
        chatId: "node-conversation-smoke",
        pipeline: "conversation",
        data: { text: "Say hello from the fake Node conversation smoke." },
      }),
    });
    assert.equal(submit.status, 201);
    const submitted = await submit.json() as { taskId?: string };
    assert.ok(submitted.taskId);
    const taskId = submitted.taskId;
    pass("task-submit");

    const taskEvent = await next(frame => {
      const payload = frame.payload as { taskId?: string } | undefined;
      return payload?.taskId === taskId
        && (frame.type === WsMessages.Server.TaskCompleted || frame.type === WsMessages.Server.TaskFailed);
    });
    assert.ok(taskEvent, "expected a completed/failed event for the submitted task");
    pass("ws-task-event");

    const status = await waitForTaskState(base, taskId);
    assert.equal(status.state, "completed", `task failed: ${status.error ?? "unknown error"}`);
    pass("task-completed");

    const sessions = await fetch(`${base}/api/sessions/${encodeURIComponent(sessionId)}`);
    assert.equal(sessions.status, 200);
    const messages = await sessions.json() as Array<{ role?: string; content?: string; visible?: boolean }>;
    const assistant = messages
      .filter(message => message.role === "assistant" && message.visible !== false)
      .map(message => message.content ?? "");
    assert.ok(
      assistant.some(content => content.includes(FAKE_REPLY)),
      `assistant reply missing: ${JSON.stringify(assistant)}`,
    );
    pass("assistant-message");

    assert.ok(model.streamRequests > 0, "fake model never received a streaming request");
    pass("model-stream");

    await sleep(50);
  } finally {
    if (ws && ws.readyState !== WebSocket.CLOSED) {
      const closed = new Promise<void>(resolve => ws!.once("close", () => resolve()));
      ws.close(1000, "conversation-smoke-done");
      await Promise.race([closed, sleep(2_000)]);
    }
    try {
      if (core) {
        await core.stop();
        pass("core-stop");
      }
    } finally {
      try {
        if (model) await model.close();
      } finally {
        await rm(sandbox, { recursive: true, force: true });
        pass("cleanup");
      }
    }
  }
}

const watchdog = setTimeout(() => {
  console.error("FAIL process did not exit");
  process.exit(1);
}, 60_000);
watchdog.unref();

main().then(
  () => {
    console.log(`PASS all (${passed} checks)`);
    process.exit(0);
  },
  (error: unknown) => {
    console.error("FAIL", error);
    process.exit(1);
  },
);
