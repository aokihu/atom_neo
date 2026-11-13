// Local-only process fixture. Never connects to external platforms.
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
const { values } = parseArgs({ args: process.argv.slice(2), strict: false, options: {
  port: { type: "string" }, secret: { type: "string" }, "gateway-url": { type: "string" },
  record: { type: "string" },
} });
const server = createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  if (path === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, pid: process.pid }));
    return;
  }
  if (req.headers["x-gateway-secret"] !== values.secret) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
});
server.listen(Number(values.port), "127.0.0.1", () => {
  const address = server.address();
  const port = typeof address === "object" ? address?.port : undefined;
  if (values.record) writeFileSync(String(values.record), JSON.stringify({ pid: process.pid, port, secret: values.secret }));
});
process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
  server.closeAllConnections?.();
});
