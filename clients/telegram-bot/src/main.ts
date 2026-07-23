const SECRET_HEADER = "X-Gateway-Secret";
const TG_SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token";

import telegramify from "telegramify-markdown";

// ── Types ───────────────────────────────────────────────────────────────────

type TgUser = { id: number; first_name: string; username?: string; is_bot?: boolean };
type TgChat = { id: number; type: "private" | "group" | "supergroup" | "channel" };
type TgMessage = {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  date: number;
  text?: string;
};
type TgUpdate = { update_id: number; message?: TgMessage };
type TgResponse<T> =
  | { ok: true; result: T }
  | { ok: false; error_code: number; description: string; parameters?: { retry_after?: number; migrate_to_chat_id?: number } };

// ── Args ────────────────────────────────────────────────────────────────────

interface ClientArgs {
  secret: string;
  port: number;
  gatewayUrl: string;
  botToken: string;
  mode: "longpoll" | "webhook";
  webhookUrl?: string;
  webhookPort: number;
  webhookHost: string;
  webhookSecret: string;
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
  const port = parseInt(portStr);
  if (isNaN(port) || port < 1 || port > 65535) { console.error(`--port must be a valid port number (1-65535), got: ${portStr}`); process.exit(1); }

  const botToken = getArg("bot-token") ?? Bun.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) { console.error("--bot-token or TELEGRAM_BOT_TOKEN env is required"); process.exit(1); }

  const mode = (getArg("mode") ?? "longpoll") as "longpoll" | "webhook";
  if (mode !== "longpoll" && mode !== "webhook") {
    console.error("--mode must be longpoll or webhook"); process.exit(1);
  }

  const webhookUrl = getArg("webhook-url");
  if (mode === "webhook" && !webhookUrl) {
    console.error("--webhook-url is required when --mode=webhook"); process.exit(1);
  }

  const webhookPortStr = getArg("webhook-port") ?? "8443";
  const webhookPort = parseInt(webhookPortStr);
  if (isNaN(webhookPort) || webhookPort < 1 || webhookPort > 65535) { console.error(`--webhook-port must be a valid port number (1-65535), got: ${webhookPortStr}`); process.exit(1); }

  const webhookSecret = getArg("webhook-secret") ?? crypto.randomUUID();

  return {
    secret,
    port,
    gatewayUrl: getArg("gateway-url") ?? "http://127.0.0.1:3000",
    botToken,
    mode,
    webhookUrl,
    webhookPort,
    webhookHost: getArg("webhook-host") ?? "127.0.0.1",
    webhookSecret,
  };
}

// ── Utils ───────────────────────────────────────────────────────────────────

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function splitMessage(text: string, maxLen = 4096): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) { chunks.push(remaining); break; }
    let cut = remaining.lastIndexOf("\n", maxLen);
    if (cut <= 0) cut = maxLen;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\n+/, "");
  }
  return chunks;
}

// ── Telegram API ────────────────────────────────────────────────────────────

const args = parseArgs();
const TG = `https://api.telegram.org/bot${args.botToken}`;

async function tgCall<T>(method: string, body: Record<string, unknown>, retries = 3): Promise<TgResponse<T>> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(`${TG}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json() as TgResponse<T>;

      if (data.ok) { return data; }

      if (data.error_code === 401 || data.error_code === 409) {
        console.error(`[tg] fatal error ${data.error_code}: ${data.description}`);
        process.exit(1);
      }

      if (data.error_code === 429) {
        const wait = (data.parameters?.retry_after ?? Math.min(2 ** attempt, 30)) * 1000;
        console.warn(`[tg] rate limited, retry after ${wait}ms`);
        await sleep(wait);
        continue;
      }

      console.error(`[tg] error ${data.error_code}: ${data.description}`);
      return data;
    } catch (err) {
      console.error(`[tg] network error (attempt ${attempt + 1}): ${err}`);
      if (attempt < retries - 1) {
        const backoff = Math.min(1000 * Math.pow(2, attempt), 30_000);
        await sleep(backoff);
      }
    }
  }
  return { ok: false, error_code: -1, description: "max retries exceeded" };
}

// ── Send Reply ──────────────────────────────────────────────────────────

async function sendReply(chatId: string, text: string): Promise<void> {
  const fixed = fixMarkdownLineBreaks(text);
  const chunks = splitMessage(fixed);
  const replyToId = lastMessageIds.get(chatId) ?? 0;

  for (let i = 0; i < chunks.length; i++) {
    const formatted = telegramify(chunks[i], "keep");
    const body: Record<string, unknown> = {
      chat_id: chatId, text: formatted, parse_mode: "MarkdownV2",
    };
    if (i === 0 && replyToId > 0) body.reply_parameters = { message_id: replyToId };
    const res = await tgCall("sendMessage", body);
    if (!res.ok) {
      console.error(`[tg] sendMessage failed (${res.error_code}): ${res.description}`);
      console.error(`[tg] failed text preview: ${formatted.slice(0, 200)}`);
      // MarkdownV2 解析失败时，降级为原始纯文本（不经 fixMarkdownLineBreaks 和 telegramify）
      if (res.error_code === 400) {
        const rawChunks = splitMessage(text);
        const rawText = rawChunks[i] ?? text;
        const fallback: Record<string, unknown> = { chat_id: chatId, text: rawText };
        if (i === 0 && replyToId > 0) fallback.reply_parameters = { message_id: replyToId };
        await tgCall("sendMessage", fallback);
      }
    }
  }
}

// ── Markdown Break Fix ──────────────────────────────────────────────────────

/**
 * 修复 LLM 输出中常见的"粘连"问题：
 * 块级 Markdown 语法（标题/列表/引用）前面缺少换行时自动补齐。
 * 代码块内部不处理。
 */
function fixMarkdownLineBreaks(md: string): string {
  // 只按 fenced code blocks (```...```) 分段，保护内部内容
  const segments = md.split(/(```[\s\S]*?```)/g);

  const headingRe = /(?<=[^\n#\\])(#{1,6}(?!#)[ \t]*\S[^\n]*)$/gm;

  const result = segments.map((seg, i) => {
    // 奇数段是 fenced code blocks，原样保留
    if (i % 2 === 1) return seg;

    return seg
      // 标题粘连修复（segment 内处理，不破坏代码块）
      .replace(headingRe, (m: string) => {
        const fixed = /#{1,6}[ \t]/.test(m) ? m : m.replace(/^(#{1,6})/, "$1 ");
        return "\n\n" + fixed;
      })
      // 无序列表标记（非行首，前置字符不是 * _ 避免拆分 **bold**）
      .replace(/([^\n*_])(\s*)([-*+])([ \t])/g, "$1\n$2$3$4")
      // 有序列表
      .replace(/([^\n\s.])(\s*)(\d+\.)([ \t])/g, "$1\n$2$3$4")
      // 引用块
      .replace(/([^\n])(\s*)(>[ \t])/g, "$1\n$2$3");
  }).join("");

  return result
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "");
}

// ── Update Handling ─────────────────────────────────────────────────────────

let updateOffset = 0;
// 单条 update 的重试计数，避免某条消息永久卡住轮询
const updateRetries = new Map<string, number>();
// 记录每个 chat 的最后一条消息 ID，用于回复时建立引用
// 上限 1000 条，超出时删除最早条目
const lastMessageIds = new Map<string, number>();
const MAX_MESSAGE_IDS = 1000;

async function handleUpdate(update: TgUpdate): Promise<void> {
  const msg = update.message;
  if (!msg) return;

  // 记录消息 ID 供 reply 使用
  lastMessageIds.set(String(msg.chat.id), msg.message_id);
  if (lastMessageIds.size > MAX_MESSAGE_IDS) {
    const first = lastMessageIds.keys().next().value;
    if (first !== undefined) lastMessageIds.delete(first);
  }

  // 忽略 bot 自己的消息，避免 bot-to-bot 循环
  if (msg.from?.is_bot) return;

  if (msg.chat.type !== "private") {
    await sendReply(String(msg.chat.id), "请私聊使用。");
    return;
  }

  if (!msg.text) {
    await sendReply(String(msg.chat.id), "目前仅支持文本消息。");
    return;
  }

  console.log(`[tg] message from ${msg.chat.id}: ${msg.text.slice(0, 50)}`);

  await fetch(`${args.gatewayUrl}/gateway/inbound`, {
    method: "POST",
    headers: { "Content-Type": "application/json", [SECRET_HEADER]: args.secret },
    body: JSON.stringify({
      type: "message",
      platform: "telegram",
      platformUserId: String(msg.chat.id),
      data: { text: msg.text },
    }),
  });
}

// ── Long Polling ────────────────────────────────────────────────────────────

async function pollOnce(): Promise<void> {
  const res = await tgCall<TgUpdate[]>("getUpdates", {
    offset: updateOffset,
    timeout: 30,
    allowed_updates: ["message"],
  });

  if (!res.ok || !res.result) return;

  for (const update of res.result) {
    // 单条 update 最多重试 3 次，之后跳过避免永久卡住
    const retryKey = `u${update.update_id}`;
    const attempts = (updateRetries.get(retryKey) ?? 0) + 1;

    try {
      await handleUpdate(update);
      updateOffset = update.update_id + 1;
      updateRetries.delete(retryKey);
    } catch (err) {
      if (attempts >= 3) {
        console.error(`[tg] update ${update.update_id} failed ${attempts} times, skipping:`, err);
        updateOffset = update.update_id + 1;
        updateRetries.delete(retryKey);
      } else {
        console.error(`[tg] handle update ${update.update_id} failed (attempt ${attempts}), will retry:`, err);
        updateRetries.set(retryKey, attempts);
        break; // 停止处理后续 update，下次轮询重试
      }
    }
  }
}

async function startLongPolling(): Promise<void> {
  await tgCall("deleteWebhook", { drop_pending_updates: true });
  console.log("[tg] long polling started");

  let consecutiveErrors = 0;
  let lastHeartbeatTime = Date.now();

  while (true) {
    // 每小时输出一次心跳日志，证明 bot 仍在运行
    if (Date.now() - lastHeartbeatTime > 3_600_000) {
      console.log(`[tg] heartbeat: alive, processed up to offset ${updateOffset}`);
      lastHeartbeatTime = Date.now();
    }

    try {
      await pollOnce();
      consecutiveErrors = 0;
    } catch (err) {
      consecutiveErrors++;
      const backoff = Math.min(1000 * Math.pow(2, consecutiveErrors), 30_000);
      console.error(`[tg] poll error (${consecutiveErrors}), retrying in ${backoff}ms:`, err);
      await sleep(backoff);
    }
  }
}

// ── Webhook ─────────────────────────────────────────────────────────────────

async function startWebhook(): Promise<void> {
  const webhookUrl = `${args.webhookUrl}/${args.webhookSecret}`;
  const res = await tgCall("setWebhook", {
    url: webhookUrl,
    secret_token: args.webhookSecret,
    allowed_updates: ["message"],
  });

  if (!res.ok) {
    console.error(`[tg] failed to set webhook: ${res.description}`);
    process.exit(1);
  }

  console.log(`[tg] webhook registered (url: ${args.webhookUrl})`);
  console.log(`[tg] ensure cloudflared routes ${args.webhookUrl} → http://${args.webhookHost}:${args.webhookPort}`);
}

// ── HTTP Server ─────────────────────────────────────────────────────────────

const server = Bun.serve({
  port: args.port,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, mode: args.mode });
    }

    if (url.pathname === "/task-result" && req.method === "POST") {
      const secret = req.headers.get(SECRET_HEADER);
      if (!secret || !timingSafeEqual(secret, args.secret)) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      }

      const body = await req.json() as { platformUserId: string; result: { output?: string; responseText?: string } };
      const text = body.result?.responseText || body.result?.output || "";

      if (text) {
        await sendReply(body.platformUserId, text);
        console.log(`[tg] sent to ${body.platformUserId}: ${text.slice(0, 50)}`);
      }
      return Response.json({ ok: true });
    }

    if (url.pathname === "/command" && req.method === "POST") {
      const secret = req.headers.get(SECRET_HEADER);
      if (!secret || !timingSafeEqual(secret, args.secret)) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      }
      const cmd = await req.json() as { action: string };
      if (cmd.action === "stop") {
        console.log("[bot] stopping");
        const response = Response.json({ ok: true });
        server.stop();
        // 延迟退出确保 HTTP 响应已发送
        setTimeout(() => process.exit(0), 100);
        return response;
      }
      if (cmd.action === "ping") {
        return Response.json({ ok: true, pong: true });
      }
      return Response.json({ ok: true });
    }

    return new Response("Not Found", { status: 404 });
  },
});

// ── Webhook Server (separate port for Telegram callbacks) ───────────────────

if (args.mode === "webhook") {
  Bun.serve({
    port: args.webhookPort,
    hostname: args.webhookHost,
    async fetch(req) {
      const url = new URL(req.url);
      const pathSecret = url.pathname.split("/").pop();

      if (url.pathname.startsWith("/tg/") && pathSecret && timingSafeEqual(pathSecret, args.webhookSecret)) {
        const headerSecret = req.headers.get(TG_SECRET_HEADER);
        if (!headerSecret || !timingSafeEqual(headerSecret, args.webhookSecret)) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
        }

        const update = await req.json() as TgUpdate;
        await handleUpdate(update);
        return Response.json({ ok: true });
      }

      return new Response("Not Found", { status: 404 });
    },
  });
  console.log(`[tg] webhook server ready on ${args.webhookHost}:${args.webhookPort}`);
}

// ── Main ────────────────────────────────────────────────────────────────────

console.log(`[bot] server ready on port ${args.port}, gateway: ${args.gatewayUrl}, mode: ${args.mode}`);

if (args.mode === "longpoll") {
  startLongPolling().catch(console.error);
} else {
  startWebhook().catch(console.error);
}

process.on("SIGINT", () => { server.stop(); process.exit(0); });
process.on("SIGTERM", () => { server.stop(); process.exit(0); });

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
