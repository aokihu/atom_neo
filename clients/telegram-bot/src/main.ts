const SECRET_HEADER = "X-Gateway-Secret";

interface ClientArgs {
  secret: string;
  port: number;
  gatewayUrl: string;
  botToken: string;
}

function parseArgs(): ClientArgs {
  const argv = Bun.argv.slice(2);
  const getArg = (name: string): string | undefined => {
    const idx = argv.indexOf(`--${name}`);
    return idx >= 0 ? argv[idx + 1] : undefined;
  };

  const secret = getArg("secret");
  if (!secret) { console.error("--secret is required"); process.exit(1); }

  const portStr = getArg("port");
  if (!portStr) { console.error("--port is required"); process.exit(1); }

  const botToken = Bun.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) { console.error("TELEGRAM_BOT_TOKEN env is required"); process.exit(1); }

  return {
    secret,
    port: parseInt(portStr),
    gatewayUrl: getArg("gateway-url") ?? "http://127.0.0.1:3000",
    botToken,
  };
}

const args = parseArgs();
const TG = `https://api.telegram.org/bot${args.botToken}`;

let updateOffset = 0;

async function pollTelegram(): Promise<void> {
  try {
    const res = await fetch(`${TG}/getUpdates?offset=${updateOffset}&timeout=30`);
    const data = await res.json() as { ok: boolean; result: Array<{ update_id: number; message?: { chat: { id: number }; text?: string } }> };
    if (!data.ok || !data.result) return;

    for (const update of data.result) {
      updateOffset = update.update_id + 1;
      if (!update.message?.text) continue;

      const chatId = update.message.chat.id;
      const text = update.message.text;

      console.log(`[tg] message from ${chatId}: ${text.slice(0, 50)}`);

      await fetch(`${args.gatewayUrl}/gateway/inbound`, {
        method: "POST",
        headers: { "Content-Type": "application/json", [SECRET_HEADER]: args.secret },
        body: JSON.stringify({
          type: "message",
          platform: "telegram",
          platformUserId: String(chatId),
          data: { text },
        }),
      });
    }
  } catch (err) {
    // Ignore network errors, retry
  }
}

async function startPollLoop(): Promise<void> {
  while (true) {
    await pollTelegram();
    await sleep(500);
  }
}

const server = Bun.serve({
  port: args.port,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true });
    }

    if (url.pathname === "/task-result" && req.method === "POST") {
      const secret = req.headers.get(SECRET_HEADER);
      if (secret !== args.secret) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      }

      const body = await req.json() as { platformUserId: string; result: { output?: string; responseText?: string } };
      const chatId = parseInt(body.platformUserId);
      const text = body.result?.responseText || body.result?.output || "";

      if (text) {
        await fetch(`${TG}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text }),
        });
        console.log(`[tg] sent to ${chatId}: ${text.slice(0, 50)}`);
      }
      return Response.json({ ok: true });
    }

    if (url.pathname === "/command" && req.method === "POST") {
      const secret = req.headers.get(SECRET_HEADER);
      if (secret !== args.secret) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      }
      const cmd = await req.json() as { action: string };
      if (cmd.action === "stop") {
        console.log("[bot] stopping");
        server.stop();
        process.exit(0);
      }
      if (cmd.action === "ping") {
        return Response.json({ ok: true, pong: true });
      }
      return Response.json({ ok: true });
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`[bot] server ready on port ${args.port}, gateway: ${args.gatewayUrl}`);

startPollLoop().catch(console.error);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
