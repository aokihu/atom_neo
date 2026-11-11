/**
 * Atom Neo documentation server.
 *
 * Serves the Markdown tree under docs/ as HTML using only Node standard APIs
 * (node:http, node:fs, node:path, node:url) plus marked, marked-highlight and
 * highlight.js. Runs under both Bun and Node >= 26 (type stripping).
 *
 * Run:
 *   bun run docs/server.ts
 *   node docs/server.ts
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";
import { markedHighlight } from "marked-highlight";
import hljs from "highlight.js";

export type MarkdownOptions = {
  /** Docs-relative directory of the source file, e.g. "overview". */
  baseDir?: string;
  /** Current URL route, used to derive baseDir when it is not supplied. */
  urlPath?: string;
};

export type DocsServerOptions = {
  docsDir?: string;
  host?: string;
  port?: number;
};

export type DocsServer = {
  port: number;
  close(): Promise<void>;
};

const DEFAULT_DOCS_DIR = fileURLToPath(new URL(".", import.meta.url));
const DEFAULT_PORT = 3100;
const EXTERNAL_LINK = /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i;

const ASSET_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export function renderMarkdown(markdown: string, options: MarkdownOptions = {}): string {
  const baseDir = normalizeBaseDir(options.baseDir ?? baseDirFromUrlPath(options.urlPath));
  const headingCounts = new Map<string, number>();

  const instance = new Marked();
  instance.use(
    markedHighlight({
      langPrefix: "hljs language-",
      emptyLangClass: "hljs",
      highlight(code, language) {
        if (language.toLowerCase() === "mermaid") return code;
        if (language) {
          try {
            if (hljs.getLanguage(language)) {
              return hljs.highlight(code, { language }).value;
            }
          } catch {
            return escapeHtml(code);
          }
        }
        return hljs.highlightAuto(code).value;
      },
    }),
  );

  instance.use({
    walkTokens(token) {
      if (token.type === "link") {
        token.href = rewriteDocLink(token.href, baseDir);
      }
    },
    renderer: {
      code({ text, lang, escaped }) {
        const language = firstWord(lang).toLowerCase();
        if (language !== "mermaid") return false;
        return `<pre class="mermaid"><code>${escaped ? text : escapeHtml(text)}</code></pre>\n`;
      },
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        const id = uniqueHeadingId(plainText(inner), headingCounts);
        return `<h${depth} id="${escapeHtml(id)}">${inner}</h${depth}>\n`;
      },
    },
  });

  return instance.parse(markdown, { async: false, gfm: true });
}

/**
 * Map a docs URL route to a Markdown file inside docsDir.
 * Returns null for traversal attempts, non-Markdown paths and missing safety
 * conditions. Existence is checked by the HTTP handler.
 */
export function resolveDocPath(docsDir: string, urlPath: string): string | null {
  if (!urlPath) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split(/[?#]/, 1)[0]);
  } catch {
    return null;
  }

  if (!decoded.startsWith("/") || decoded.startsWith("//") || decoded.includes("\0") || decoded.includes("\\")) {
    return null;
  }

  let route = decoded.replace(/^\/+/, "");
  if (!route) route = "index";
  if (route.endsWith("/")) route += "index";

  const segments = route.split("/");
  if (segments.some(segment => segment === "" || segment === "." || segment === ".." || segment.includes(":"))) {
    return null;
  }
  if (segments[0] === "assets") return null;

  const routeBaseName = route.slice(route.lastIndexOf("/") + 1);
  if (routeBaseName.includes(".") && !routeBaseName.toLowerCase().endsWith(".md")) {
    return null;
  }
  const fileName = route.toLowerCase().endsWith(".md") ? route.slice(0, -3) : route;

  const root = resolve(docsDir);
  const target = resolve(root, `${fileName}.md`);
  if (target !== root && !target.startsWith(root + sep)) return null;
  return target;
}

export function rewriteDocLink(href: string, baseDir = ""): string {
  const match = /^([^?#]*)(\?[^#]*)?(#[\s\S]*)?$/.exec(href);
  if (!match) return href;

  const [, pathPart, query = "", hash = ""] = match;
  if (!pathPart || EXTERNAL_LINK.test(pathPart) || !/\.md$/i.test(pathPart)) {
    return href;
  }

  const joined = posix.normalize(posix.join("/", normalizeBaseDir(baseDir), pathPart));
  const route = joined.replace(/\.md$/i, "");
  return `${route === "/index" ? "/" : route}${query}${hash}`;
}

export async function startDocsServer(options: DocsServerOptions = {}): Promise<DocsServer> {
  const docsDir = resolve(options.docsDir ?? DEFAULT_DOCS_DIR);
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? DEFAULT_PORT;

  const server = createServer((request, response) => {
    try {
      handleRequest(request, response, docsDir);
    } catch (error) {
      console.error("[docs] request failed", error);
      if (!response.headersSent) {
        send(response, 500, pageHtml("500", "<h1>Internal Server Error</h1>"), "text/html; charset=utf-8", "no-store", request.method === "HEAD");
      } else {
        response.end();
      }
    }
  });

  await new Promise<void>((resolvePromise, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolvePromise();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  let closed = false;

  return {
    port: actualPort,
    close() {
      if (closed) return Promise.resolve();
      closed = true;
      return new Promise<void>((resolvePromise, reject) => {
        server.close(error => (error ? reject(error) : resolvePromise()));
        server.closeAllConnections?.();
      });
    },
  };
}

function handleRequest(request: IncomingMessage, response: ServerResponse, docsDir: string): void {
  const headOnly = request.method === "HEAD";
  if (request.method !== "GET" && !headOnly) {
    send(response, 405, "Method Not Allowed", "text/plain; charset=utf-8", "no-store", false, { Allow: "GET, HEAD" });
    return;
  }

  let url: URL;
  try {
    url = new URL(request.url ?? "/", "http://localhost");
  } catch {
    send(response, 400, "Bad Request", "text/plain; charset=utf-8", "no-store", headOnly);
    return;
  }

  if (url.pathname === "/health") {
    send(
      response,
      200,
      JSON.stringify({ status: "ok", docs: countDocs(docsDir) }),
      "application/json; charset=utf-8",
      "no-store",
      headOnly,
    );
    return;
  }

  if (url.pathname === "/favicon.ico") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (url.pathname === "/assets" || url.pathname.startsWith("/assets/")) {
    serveAsset(url.pathname, docsDir, response, headOnly);
    return;
  }

  const docPath = resolveDocPath(docsDir, url.pathname);
  if (!docPath || !isFile(docPath)) {
    sendNotFound(response, headOnly);
    return;
  }

  let markdown: string;
  try {
    markdown = readFileSync(docPath, "utf8");
  } catch {
    sendNotFound(response, headOnly);
    return;
  }

  const baseDir = normalizeBaseDir(relative(docsDir, dirname(docPath)).split(sep).join("/"));
  const body = renderMarkdown(markdown, { baseDir, urlPath: url.pathname });
  const title = extractTitle(markdown) || "Document";
  send(response, 200, pageHtml(title, body), "text/html; charset=utf-8", "no-store", headOnly);
}

function serveAsset(pathname: string, docsDir: string, response: ServerResponse, headOnly: boolean): void {
  let relativePath: string;
  try {
    relativePath = decodeURIComponent(pathname.slice("/assets/".length));
  } catch {
    sendNotFound(response, headOnly);
    return;
  }

  if (!relativePath || relativePath.includes("\0") || relativePath.includes("\\")) {
    sendNotFound(response, headOnly);
    return;
  }

  const segments = relativePath.split("/");
  if (segments.some(segment => segment === "" || segment === "." || segment === "..")) {
    sendNotFound(response, headOnly);
    return;
  }

  const assetsRoot = resolve(docsDir, "assets");
  const file = resolve(assetsRoot, relativePath);
  if (file !== assetsRoot && !file.startsWith(assetsRoot + sep)) {
    sendNotFound(response, headOnly);
    return;
  }

  let stats;
  try {
    stats = statSync(file);
  } catch {
    sendNotFound(response, headOnly);
    return;
  }
  if (!stats.isFile()) {
    sendNotFound(response, headOnly);
    return;
  }

  const type = ASSET_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
  send(response, 200, readFileSync(file), type, "no-cache", headOnly);
}

function sendNotFound(response: ServerResponse, headOnly: boolean): void {
  const body = pageHtml(
    "404",
    '<div class="not-found"><h1>Document not found</h1><p>The requested Markdown document does not exist.</p><p><a href="/">← Back to index</a></p></div>',
  );
  send(response, 404, body, "text/html; charset=utf-8", "no-store", headOnly);
}

function send(
  response: ServerResponse,
  status: number,
  body: string | Uint8Array,
  contentType: string,
  cacheControl: string,
  headOnly: boolean,
  extraHeaders: Record<string, string> = {},
): void {
  response.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": cacheControl,
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  response.end(headOnly ? undefined : body);
}

function pageHtml(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} — Atom Neo Docs</title>
  <link rel="stylesheet" href="/assets/docs.css">
</head>
<body>
  <header class="site-header">
    <a class="site-brand" href="/">Atom Neo Docs</a>
    <nav class="site-nav"><a href="/">Index</a></nav>
  </header>
  <main class="content">
${body}
  </main>
  <footer class="site-footer">Rendered from Markdown by <code>docs/server.ts</code></footer>
</body>
</html>`;
}

function extractTitle(markdown: string): string {
  const match = /^#\s+(.+)$/m.exec(markdown);
  return match ? match[1].replace(/[*_`]/g, "").trim() : "";
}

function countDocs(dir: string): number {
  let count = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) count += countDocs(full);
    else if (entry.isFile() && entry.name.endsWith(".md")) count += 1;
  }
  return count;
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function normalizeBaseDir(value: string): string {
  const clean = value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!clean || clean === ".") return "";
  return clean.replace(/^\.\//, "");
}

function baseDirFromUrlPath(urlPath?: string): string {
  if (!urlPath) return "";
  const clean = urlPath.split(/[?#]/, 1)[0].replace(/^\/+/, "");
  if (!clean || !clean.includes("/")) return "";
  return normalizeBaseDir(clean.slice(0, clean.lastIndexOf("/")));
}

function firstWord(value: string | undefined): string {
  return (value ?? "").trim().split(/\s+/)[0] ?? "";
}

function uniqueHeadingId(text: string, counts: Map<string, number>): string {
  const base = slugify(text);
  const count = counts.get(base) ?? 0;
  counts.set(base, count + 1);
  return count === 0 ? base : `${base}-${count}`;
}

function slugify(value: string): string {
  const slug = value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]+/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
}

function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const port = Number(value);
  return Number.isInteger(port) && port >= 0 && port <= 65535 ? port : fallback;
}

if ((import.meta as ImportMeta & { main?: boolean }).main) {
  const host = process.env.DOCS_HOST ?? "127.0.0.1";
  const port = parsePort(process.env.DOCS_PORT, DEFAULT_PORT);
  const server = await startDocsServer({ host, port });
  console.log("\n  Atom Neo Docs — Markdown → HTML\n");
  console.log(`  → http://${host}:${server.port}/           (index)`);
  console.log(`  → http://${host}:${server.port}/health     (health)`);
  console.log(`  → http://${host}:${server.port}/assets/docs.css (styles)`);
  console.log("\n  Press Ctrl+C to stop.\n");
}
