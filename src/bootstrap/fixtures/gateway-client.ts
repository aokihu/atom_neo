// Local-only process fixture. Never connects to external platforms.
import { parseArgs } from "node:util";
import { writeFileSync } from "node:fs";
const { values } = parseArgs({ args: Bun.argv.slice(2), strict: false, options: {
  port: { type: "string" }, secret: { type: "string" }, "gateway-url": { type: "string" },
  record: { type: "string" },
} });
const server = Bun.serve({
  hostname: "127.0.0.1", port: Number(values.port),
  fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/health") return Response.json({ ok: true, pid: process.pid });
    if (req.headers.get("X-Gateway-Secret") !== values.secret) return new Response("Forbidden", { status: 403 });
    return Response.json({ ok: true });
  },
});
if (values.record) writeFileSync(String(values.record), JSON.stringify({ pid: process.pid, port: server.port, secret: values.secret }));
process.on("SIGTERM", () => { server.stop(true); process.exit(0); });
