const SECRET_HEADER = "X-Gateway-Secret";
const TG_SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token";

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

  const webhookSecret = getArg("webhook-secret") ?? crypto.randomUUID();

  return {
    secret,
    port: parseInt(portStr),
    gatewayUrl: getArg("gateway-url") ?? "http://127.0.0.1:3000",
    botToken,
    mode,
    webhookUrl,
    webhookPort: parseInt(getArg("webhook-port") ?? "8443"),
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

/**
 * HTML 安全分片：优先在 </p>、</li>、</pre> 等块级结束标签后切分，
 * 避免在 <b>、<code> 等行内标签中间截断导致未闭合。
 */
function splitHtmlMessage(html: string, maxLen = 4096): string[] {
  if (html.length <= maxLen) return [html];
  const chunks: string[] = [];
  let remaining = html;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) { chunks.push(remaining); break; }

    // 在 maxLen 范围内找最后一个块级结束标签
    const window = remaining.slice(0, maxLen);
    const blockEnds = ["</p>", "</li>", "</pre>", "</blockquote>", "</h1>", "</h2>", "</h3>", "</h4>", "</h5>", "</h6>", "\n"];
    let cut = -1;
    for (const tag of blockEnds) {
      const idx = window.lastIndexOf(tag);
      if (idx > cut) cut = idx + tag.length;
    }

    // 找不到合适位置就硬切（风险自负）
    if (cut <= 0) cut = maxLen;

    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }
  return chunks;
}

// ── Telegram API ────────────────────────────────────────────────────────────

const args = parseArgs();
const TG = `https://api.telegram.org/bot${args.botToken}`;

let backoffMs = 0;

async function tgCall<T>(method: string, body: Record<string, unknown>, retries = 3): Promise<TgResponse<T>> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(`${TG}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json() as TgResponse<T>;

      if (data.ok) { backoffMs = 0; return data; }

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
        backoffMs = Math.min(backoffMs * 2 || 1000, 30_000);
        await sleep(backoffMs);
      }
    }
  }
  return { ok: false, error_code: -1, description: "max retries exceeded" };
}

async function sendReply(chatId: string, replyToId: number, text: string): Promise<void> {
  // 优先尝试 Markdown → HTML 渲染
  const html = markdownToTelegramHtml(text);
  const useHtml = html !== null;

  // HTML 模式下用安全分片，避免截断标签
  const chunks = useHtml ? splitHtmlMessage(sanitizeTelegramHtml(html)) : splitMessage(text);

  for (let i = 0; i < chunks.length; i++) {
    const body: Record<string, unknown> = { chat_id: chatId, text: chunks[i] };
    if (useHtml) body.parse_mode = "HTML";
    if (i === 0) body.reply_parameters = { message_id: replyToId };
    await tgCall("sendMessage", body);
  }
}

// ── Markdown → HTML ─────────────────────────────────────────────────────────

/**
 * 修复 LLM 输出中常见的"粘连"问题：
 * 块级 Markdown 语法（标题/列表/代码块/引用）前面缺少换行时自动补齐。
 * 代码块内部不处理。
 *
 * 注意：Markdown 规范要求标题标记 # 后面必须有空格（### text），
 * 无空格的 ###text 不是合法 Markdown，不会被任何解析器识别为标题。
 * 因此我们只处理"前面缺换行"的情况，不处理"# 后缺空格"的情况。
 */
function fixMarkdownLineBreaks(md: string): string {
  // 只按 fenced code blocks (```...```) 分段，保护内部内容
  // inline code (`...`) 不分段，让 heading 正则自然匹配
  const segments = md.split(/(```[\s\S]*?```)/g);

  const result = segments.map((seg, i) => {
    // 奇数段是 fenced code blocks，原样保留
    if (i % 2 === 1) return seg;

    return seg
      // 无序列表标记
      .replace(/([^\n])(\s*)([-*+])([ \t])/g, "$1\n$2$3$4")
      // 有序列表
      .replace(/([^\n\s.])(\s*)(\d+\.)([ \t])/g, "$1\n$2$3$4")
      // 引用块
      .replace(/([^\n])(\s*)(>[ \t])/g, "$1\n$2$3");
  }).join("");

  // 标题正则：在 joined 结果上运行，捕获跨 segment 边界的标题
  // lookbehind 确保不拆分 ### 也不匹配行首的标题
  return result
    .replace(/(?<=[^\n#\\])(#{1,6}(?!#)[ \t]*\S[^\n]*)$/gm,
      (m: string) => {
        const fixed = /#{1,6}[ \t]/.test(m) ? m : m.replace(/^(#{1,6})/, "$1 ");
        return "\n\n" + fixed;
      })
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "");
}

/**
 * 将 Markdown 渲染为 Telegram HTML 模式支持的子集。
 * 失败时返回 null，调用方应降级为纯文本。
 */
function markdownToTelegramHtml(md: string): string | null {
  try {
    const fixed = fixMarkdownLineBreaks(md);
    const html = Bun.markdown.html(fixed, {
      // Telegram HTML 模式支持的标签子集：<b> <i> <u> <s> <code> <pre> <a> <blockquote> <tg-spoiler>
      tables: true,
      strikethrough: true,
      tasklists: true,
      autolinks: true,
      // LLM 输出常缺 # 后空格，如 ###标题（非标准但可容错渲染）
      permissiveAtxHeaders: true,
    });
    return html;
  } catch (err) {
    console.error(`[tg] markdown render failed: ${err}`);
    return null;
  }
}

/**
 * Telegram HTML 模式不支持的标签转换为支持的标签：
 * - <h1>..<h6> → <b> + 换行
 * - <ul>/<ol>/<li> → 换行 + • 前缀
 * - <table> 系列 → 移除（Telegram 不支持）
 * - <hr> → 分隔线文本
 * - <input type=checkbox> → 移除
 * - <em> → <i>，<strong> → <b>，<del> → <s>
 */
function sanitizeTelegramHtml(html: string): string {
  return html
    // 标题 → 加粗 + 换行
    .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/g, "<b>$1</b>\n")
    // 列表
    .replace(/<ul[^>]*>/g, "")
    .replace(/<\/ul>/g, "")
    .replace(/<ol[^>]*>/g, "")
    .replace(/<\/ol>/g, "")
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/g, "• $1\n")
    // 表格 → 降级为文本
    .replace(/<table[^>]*>([\s\S]*?)<\/table>/g, (_m, inner: string) => {
      return inner
        .replace(/<thead[^>]*>([\s\S]*?)<\/thead>/g, (_t, thead: string) =>
          thead.replace(/<th[^>]*>([\s\S]*?)<\/th>/g, "$1 | ")
        )
        .replace(/<tbody[^>]*>([\s\S]*?)<\/tbody>/g, (_b, tbody: string) =>
          tbody.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/g, (_r, row: string) =>
            row.replace(/<td[^>]*>([\s\S]*?)<\/td>/g, "$1 | ").trimEnd() + "\n"
          )
        );
    })
    // 任务列表 checkbox → 文本标记
    .replace(/<input[^>]*type="checkbox"[^>]*checked[^>]*>/g, "☑ ")
    .replace(/<input[^>]*type="checkbox"[^>]*>/g, "☐ ")
    // hr → 分隔线
    .replace(/<hr[^>]*>/g, "───\n")
    // em/strong/del → Telegram 等价标签
    .replace(/<em>([\s\S]*?)<\/em>/g, "<i>$1</i>")
    .replace(/<strong>([\s\S]*?)<\/strong>/g, "<b>$1</b>")
    .replace(/<del>([\s\S]*?)<\/del>/g, "<s>$1</s>")
    // <p> → 换行
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/g, "$1\n")
    // 换行标签 → \n
    .replace(/<br[^>]*>/g, "\n")
    // 去除首尾多余换行
    .replace(/^\n+|\n+$/g, "")
    .replace(/\n{3,}/g, "\n\n");
}

// ── Update Handling ─────────────────────────────────────────────────────────

let updateOffset = 0;

async function handleUpdate(update: TgUpdate): Promise<void> {
  const msg = update.message;
  if (!msg) return;

  if (msg.chat.type !== "private") {
    await sendReply(String(msg.chat.id), msg.message_id, "请私聊使用。");
    return;
  }

  if (!msg.text) {
    await sendReply(String(msg.chat.id), msg.message_id, "目前仅支持文本消息。");
    return;
  }

  if (msg.from?.is_bot) return;

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
    updateOffset = update.update_id + 1;
    await handleUpdate(update);
  }
}

async function startLongPolling(): Promise<void> {
  await tgCall("deleteWebhook", {});
  console.log("[tg] long polling started");
  while (true) {
    await pollOnce();
    if (backoffMs > 0) await sleep(backoffMs);
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

  console.log(`[tg] webhook registered: ${webhookUrl}`);
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
        await sendReply(body.platformUserId, 0, text);
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
