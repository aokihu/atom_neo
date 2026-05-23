/**
 * Atom Neo — Documentation Server (JSX + SSR)
 *
 * Run: bun run --watch docs/server.tsx
 * Open: http://localhost:3100
 *
 * Each .md file can have a corresponding ./pages/[slug].tsx page component.
 * Falls back to ./pages/default.tsx if no custom page exists.
 */

import { readFile, readdir, watch } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { renderToString } from "react-dom/server";
import React from "react";

import { Layout } from "./components/Layout";
import { IndexPage } from "./components/IndexPage";
import {
  type DocEntry,
  CATEGORIES,
  categorize,
  extractTitle,
  extractDesc,
  priority,
} from "./shared";

// Static page imports (custom per-document pages)
import ArchitecturePage from "./pages/architecture";
import BootstrapPage from "./pages/bootstrap";
import CodingConventionsPage from "./pages/coding-conventions";
import ConfigurationPage from "./pages/configuration";
import DependencyInjectionPage from "./pages/dependency-injection";
import DevelopmentPlanPage from "./pages/development-plan";
import ElementDesignPage from "./pages/element-design";
import EnvironmentSetupPage from "./pages/environment-setup";
import ErrorHandlingPage from "./pages/error-handling";
import EventBusPage from "./pages/event-bus";
import MemoryServicePage from "./pages/memory-service";
import MessageOrganizationPage from "./pages/message-organization";
import NamingConventionsPage from "./pages/naming-conventions";
import PipelineBuilderPage from "./pages/pipeline-builder";
import ProjectStructurePage from "./pages/project-structure";
import ProtocolPage from "./pages/protocol";
import SandboxPage from "./pages/sandbox";
import SessionContextPage from "./pages/session-context";
import TestingPage from "./pages/testing";
import ToolPluginPage from "./pages/tool-plugin";
import TypeSystemPage from "./pages/type-system";
import DefaultDocPage from "./pages/default";

type PageComponent = React.ComponentType<{
  content: string;
  title: string;
  description: string;
  category: string;
  slug: string;
}>;

const PAGE_REGISTRY: Record<string, PageComponent> = {
  architecture: ArchitecturePage,
  bootstrap: BootstrapPage,
  "coding-conventions": CodingConventionsPage,
  configuration: ConfigurationPage,
  "dependency-injection": DependencyInjectionPage,
  "development-plan": DevelopmentPlanPage,
  "element-design": ElementDesignPage,
  "environment-setup": EnvironmentSetupPage,
  "error-handling": ErrorHandlingPage,
  "event-bus": EventBusPage,
  "memory-service": MemoryServicePage,
  "message-organization": MessageOrganizationPage,
  "naming-conventions": NamingConventionsPage,
  "pipeline-builder": PipelineBuilderPage,
  "project-structure": ProjectStructurePage,
  protocol: ProtocolPage,
  sandbox: SandboxPage,
  "session-context": SessionContextPage,
  testing: TestingPage,
  "tool-plugin": ToolPluginPage,
  "type-system": TypeSystemPage,
};

function getPageComponent(slug: string): PageComponent {
  return PAGE_REGISTRY[slug] || DefaultDocPage;
}

const DOCS_DIR = import.meta.dir;
const PORT = 3100;
const HOST = "0.0.0.0";

// ── Doc Discovery ─────────────────────────────────────────

let docCache: DocEntry[] = [];

async function loadDocs(): Promise<DocEntry[]> {
  const files = await readdir(DOCS_DIR);
  const entries: DocEntry[] = [];

  for (const file of files) {
    if (!file.endsWith(".md") || file === "index.md") continue;
    const slug = file.replace(/\.md$/, "");
    const path = join(DOCS_DIR, file);
    const md = await readFile(path, "utf-8");
    entries.push({
      slug,
      title: extractTitle(md) || slug,
      description: extractDesc(md),
      category: categorize(slug),
      priority: priority(slug),
      path,
    });
  }

  entries.sort((a, b) => a.priority - b.priority);
  docCache = entries;
  return entries;
}

function getSidebarData() {
  const cats: { label: string; docs: DocEntry[] }[] = [];
  for (const [key, { label }] of Object.entries(CATEGORIES)) {
    const docs = docCache.filter(d => d.category === key);
    if (docs.length) cats.push({ label, docs });
  }
  return cats;
}

function getDocListData() {
  return docCache.map(d => ({
    slug: d.slug,
    title: d.title,
    description: d.description,
    category: d.category,
  }));
}

// ── Route Handler ─────────────────────────────────────────

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  if (path === "/favicon.ico") return new Response(null, { status: 204 });
  if (path === "/health") {
    return Response.json({ status: "ok", docs: docCache.length });
  }

  // Serve static .html files
  if (path.endsWith(".html")) {
    const filePath = join(DOCS_DIR, path.replace(/^\//, ""));
    if (existsSync(filePath)) {
      return new Response(Bun.file(filePath), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
  }

  // Serve HeroUI styles
  if (path === "/_styles/heroui.css") {
    const cssPath = join(DOCS_DIR, "..", "node_modules", "@heroui", "styles", "dist", "heroui.min.css");
    if (existsSync(cssPath)) {
      return new Response(Bun.file(cssPath), {
        headers: { "Content-Type": "text/css; charset=utf-8" },
      });
    }
  }

  // Raw MD access
  if (path.endsWith(".md")) {
    const filePath = join(DOCS_DIR, path.replace(/^\//, ""));
    if (existsSync(filePath)) {
      return new Response(Bun.file(filePath), {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  }

  // Determine slug
  let slug = "";
  if (path === "/" || path === "/index") {
    slug = "index";
  } else {
    slug = path.replace(/^\//, "").replace(/\.md$/, "");
  }

  const categories = getSidebarData();
  const allDocs = getDocListData();

  // Index page
  if (slug === "index") {
    const html = renderToString(
      <Layout title="Atom Neo Docs" activeSlug="index" categories={categories} allDocs={allDocs}>
        <IndexPage docs={docCache} />
      </Layout>,
    );
    return new Response("<!DOCTYPE html>\n" + html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // Doc page — use custom page component if available, else default
  const entry = docCache.find(d => d.slug === slug);
  if (!entry) {
    const html = renderToString(
      <Layout title="404" activeSlug={slug} categories={categories} allDocs={allDocs}>
        <div className="page-header">
          <h1>Document Not Found</h1>
        </div>
      </Layout>,
    );
    return new Response("<!DOCTYPE html>\n" + html, {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const md = await readFile(entry.path, "utf-8");
  const catLabel = CATEGORIES[entry.category]?.label || "";
  const PageComp = getPageComponent(slug);

  const html = renderToString(
    <Layout title={entry.title} activeSlug={slug} categories={categories} allDocs={allDocs}>
      <PageComp
        content={md}
        title={entry.title}
        description={entry.description}
        category={catLabel}
        slug={slug}
      />
    </Layout>,
  );
  return new Response("<!DOCTYPE html>\n" + html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

// ── Hot Reload ────────────────────────────────────────────

async function watchDocs() {
  try {
    const watcher = watch(DOCS_DIR, { recursive: false });
    for await (const event of watcher) {
      if (event.filename?.endsWith(".md")) {
        console.log("  [watch] reloading docs...");
        await loadDocs();
      }
    }
  } catch {
    /* watch not available in all environments */
  }
}

// ── Start ─────────────────────────────────────────────────

await loadDocs();
watchDocs();

Bun.serve({
  port: PORT,
  hostname: HOST,
  fetch: handleRequest,
});

console.log("\n  Atom Neo — Documentation Server (JSX + SSR)\n");
console.log("  → http://localhost:" + PORT + "          (index)");
console.log("  → http://localhost:" + PORT + "/architecture  (custom page)");
console.log("\n  Pages: ./docs/pages/[slug].tsx  ←  per-markdown page components");
console.log("  Hot reload active. MD changes auto-refresh.\n  Press Ctrl+C to stop.\n");
