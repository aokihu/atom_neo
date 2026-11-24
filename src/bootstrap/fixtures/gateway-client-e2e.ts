// Local-only end-to-end client fixture: sends one inbound message and records the task result.
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  args: process.argv.slice(2),
  strict: false,
  options: {
    port: { type: "string" },
    secret: { type: "string" },
    "gateway-url": { type: "string" },
    "send-text": { type: "string" },
    "result-record": { type: "string" },
  },
});

const secret = String(values.secret ?? "");
const gatewayUrl = String(values["gateway-url"] ?? "");
const recordPath = values["result-record"] ? String(values["result-record"]) : undefined;

function record(payload: unknown): void {
  if (recordPath) writeFileSync(recordPath, JSON.stringify(payload));
}

const server = createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  if (path === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, pid: process.pid }));
    return;
  }
  if (req.headers["x-gateway-secret"] !== secret) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }
  if (path === "/task-result" && req.method === "POST") {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        record({ ok: true, payload: JSON.parse(body) });
      } catch (error) {
        record({ ok: false, error: String(error) });
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not Found");
});

server.listen(Number(values.port), "127.0.0.1", async () => {
  const text = String(values["send-text"] ?? "");
  try {
    // The parent may not have registered the secret at the instant the child starts.
    for (let attempt = 0; attempt < 50; attempt++) {
      const response = await fetch(`${gatewayUrl}/gateway/inbound`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Gateway-Secret": secret },
        body: JSON.stringify({
          type: "message",
          platform: "local",
          platformUserId: "e2e-user",
          data: { text },
        }),
      });
      if (response.ok) return;
      if (response.status !== 401) {
        record({ ok: false, status: response.status });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    record({ ok: false, error: "gateway did not accept the client secret" });
  } catch (error) {
    record({ ok: false, error: String(error) });
  }
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
  server.closeAllConnections?.();
});
