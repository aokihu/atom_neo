/**
 * Spike: node:http + `ws` under Bun.
 *
 * Temporary validation script (S9-A). Not production code and not imported by
 * any package. `ws` is deliberately not a repository dependency; install it in
 * a temp directory and either copy this file there or point NODE_PATH at it:
 *
 *   SPIKE_DIR=$(mktemp -d) && cd "$SPIKE_DIR"
 *   npm init -y && npm install ws@8.22.2
 *   NODE_PATH="$SPIKE_DIR/node_modules" bun /path/to/repo/scripts/spike/ws-on-bun.ts
 *
 * Checks: 101 upgrade, text roundtrip, binary flag, close code/reason,
 * remoteAddress availability, repeated connect/disconnect, clean exit.
 */
import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

const CLOSE_CODE = 1000;
const CLOSE_REASON = "spike-done";
const CONNECTIONS = 50;

const http = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ noServer: true });
const remoteAddresses = new Set<string>();
let upgradeStatus = 0;

http.on("upgrade", (req, socket, head) => {
  if (!req.url?.startsWith("/ws/")) {
    socket.destroy();
    return;
  }
  remoteAddresses.add(req.socket.remoteAddress ?? "");
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.send(JSON.stringify({ type: "session.ready", payload: { sessionId: "spike" } }));
    ws.on("message", (raw, isBinary) => {
      ws.send(JSON.stringify({ type: "echo", payload: { text: raw.toString(), isBinary } }));
    });
  });
});

http.listen(0, "127.0.0.1", async () => {
  const address = http.address();
  if (!address || typeof address === "string") throw new Error("missing listen address");
  const port = address.port;
  console.log(`[spike] listening on 127.0.0.1:${port}`);

  const health = await fetch(`http://127.0.0.1:${port}/health`);
  console.log(`[spike] health ${health.status} ${await health.text()}`);

  let completed = 0;
  for (let i = 0; i < CONNECTIONS; i++) {
    if (!await runClient(port, i === 0)) break;
    completed++;
  }

  console.log(`[spike] connections completed ${completed}/${CONNECTIONS}`);
  console.log(`[spike] upgrade status ${upgradeStatus}`);
  console.log(`[spike] remoteAddress ${[...remoteAddresses].join(",") || "<none>"}`);

  await new Promise<void>((resolve, reject) => {
    wss.close(() => http.close((error) => (error ? reject(error) : resolve())));
  });
  console.log("[spike] closed cleanly");
  process.exit(completed === CONNECTIONS && upgradeStatus === 101 && remoteAddresses.size > 0 ? 0 : 1);
});

function runClient(port: number, verbose: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/spike`);
    const seen: string[] = [];
    let textEcho = false;
    let binaryEcho = false;
    let settled = false;
    const timer = setTimeout(() => finish(false, "timeout"), 4000);

    const finish = (ok: boolean, note: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (note) {
        console.log(`[spike] client ${note}`);
        ws.terminate();
      }
      resolve(ok);
    };

    ws.on("upgrade", (res) => {
      upgradeStatus = res.statusCode;
      if (verbose) console.log(`[spike] upgrade ${res.statusCode}`);
    });

    ws.on("message", (raw, isBinary) => {
      if (isBinary) return;
      const frame = JSON.parse(raw.toString()) as { type: string; payload?: { text?: string; isBinary?: boolean } };
      seen.push(frame.type);
      if (frame.type === "session.ready") {
        ws.send("hello");
        ws.send(new Uint8Array([0x68, 0x69]));
        return;
      }
      if (frame.type !== "echo") return;
      if (frame.payload?.isBinary === false && frame.payload.text === "hello") textEcho = true;
      if (frame.payload?.isBinary === true && frame.payload.text === "hi") binaryEcho = true;
      if (textEcho && binaryEcho) ws.close(CLOSE_CODE, CLOSE_REASON);
    });

    ws.on("close", (code, reason) => {
      const ok = code === CLOSE_CODE && reason.toString() === CLOSE_REASON
        && seen.includes("session.ready") && textEcho && binaryEcho;
      if (verbose) {
        console.log(`[spike] close code=${code} reason=${reason.toString()} text=${textEcho} binary=${binaryEcho}`);
      }
      finish(ok, ok ? "" : "close check failed");
    });

    ws.on("error", (error) => finish(false, `error ${String(error)}`));
  });
}
