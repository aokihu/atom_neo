import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  renderMarkdown,
  resolveDocPath,
  startDocsServer,
  type DocsServer,
} from "./server";

describe("renderMarkdown", () => {
  test("renders headings, tables and highlighted fenced code", () => {
    const markdown = [
      "# Hello World",
      "",
      "| A | B |",
      "|---|---|",
      "| 1 | 2 |",
      "",
      "```ts",
      "const answer: number = 42;",
      "```",
    ].join("\n");

    const html = renderMarkdown(markdown);

    expect(html).toContain('<h1 id="hello-world">Hello World</h1>');
    expect(html).toContain("<table>");
    expect(html).toContain("hljs language-ts");
    expect(html).toContain("hljs-keyword");
  });

  test("rewrites relative Markdown links to docs routes", () => {
    const root = renderMarkdown("[same](./foo.md)");
    expect(root).toContain('href="/foo"');

    const nested = renderMarkdown("[same](./foo.md) [up](../bar.md#x)", { baseDir: "overview" });
    expect(nested).toContain('href="/overview/foo"');
    expect(nested).toContain('href="/bar#x"');
  });

  test("preserves external, anchor and non-Markdown links", () => {
    const html = renderMarkdown(
      "[ext](https://example.com/a.md) [mail](mailto:a@example.com) [anchor](#top) [file](./foo.txt)",
    );

    expect(html).toContain('href="https://example.com/a.md"');
    expect(html).toContain('href="mailto:a@example.com"');
    expect(html).toContain('href="#top"');
    expect(html).toContain('href="./foo.txt"');
  });

  test("renders Mermaid as a readable pre block", () => {
    const html = renderMarkdown("```mermaid\ngraph TD\nA-->B\n```");
    expect(html).toContain('<pre class="mermaid"><code>');
    expect(html).toContain("graph TD");
    expect(html).toContain("A--&gt;B");
  });
});

describe("resolveDocPath", () => {
  const root = "/tmp/atom-docs-test";

  test("maps routes to Markdown files", () => {
    expect(resolveDocPath(root, "/")).toBe(join(root, "index.md"));
    expect(resolveDocPath(root, "/index")).toBe(join(root, "index.md"));
    expect(resolveDocPath(root, "/foo")).toBe(join(root, "foo.md"));
    expect(resolveDocPath(root, "/foo.md")).toBe(join(root, "foo.md"));
    expect(resolveDocPath(root, "/nested/bar")).toBe(join(root, "nested/bar.md"));
  });

  test("rejects traversal, absolute input and non-Markdown paths", () => {
    expect(resolveDocPath(root, "/../secret.md")).toBeNull();
    expect(resolveDocPath(root, "/%2e%2e/secret.md")).toBeNull();
    expect(resolveDocPath(root, "/foo/../../secret.md")).toBeNull();
    expect(resolveDocPath(root, "//etc/passwd.md")).toBeNull();
    expect(resolveDocPath(root, "/C:/secret.md")).toBeNull();
    expect(resolveDocPath(root, "relative/path.md")).toBeNull();
    expect(resolveDocPath(root, "/notes.txt")).toBeNull();
    expect(resolveDocPath(root, "/foo\0.md")).toBeNull();
    expect(resolveDocPath(root, "/foo%00.md")).toBeNull();
    expect(resolveDocPath(root, "/assets/docs.css")).toBeNull();
  });
});

describe("startDocsServer", () => {
  let docsDir = "";
  let server: DocsServer;

  beforeAll(async () => {
    docsDir = mkdtempSync(join(tmpdir(), "atom-docs-"));
    mkdirSync(join(docsDir, "nested"), { recursive: true });
    mkdirSync(join(docsDir, "assets"), { recursive: true });
    writeFileSync(join(docsDir, "index.md"), "# Index\n\n[Guide](./nested/guide.md)\n");
    writeFileSync(join(docsDir, "nested", "guide.md"), "# Guide\n\nNested body.\n");
    writeFileSync(join(docsDir, "assets", "docs.css"), "body { color: red; }\n");
    server = await startDocsServer({ docsDir, host: "127.0.0.1", port: 0 });
  });

  afterAll(async () => {
    if (server) await server.close();
    if (docsDir) rmSync(docsDir, { recursive: true, force: true });
  });

  function url(path: string): string {
    return `http://127.0.0.1:${server.port}${path}`;
  }

  test("serves the index and rewrites its links", async () => {
    const response = await fetch(url("/"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toBe("no-store");

    const html = await response.text();
    expect(html).toContain("Atom Neo Docs");
    expect(html).toContain('href="/nested/guide"');
    expect(html).toContain('<link rel="stylesheet" href="/assets/docs.css">');
  });

  test("serves a nested Markdown doc", async () => {
    const response = await fetch(url("/nested/guide"));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Nested body.");
  });

  test("serves health as JSON", async () => {
    const response = await fetch(url("/health"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ status: "ok", docs: 2 });
  });

  test("serves assets/docs.css", async () => {
    const response = await fetch(url("/assets/docs.css"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/css");
    expect(await response.text()).toContain("body { color: red; }");
  });

  test("returns a 404 page with a link home", async () => {
    const response = await fetch(url("/missing"));
    expect(response.status).toBe(404);
    const html = await response.text();
    expect(html).toContain("Document not found");
    expect(html).toContain('href="/"');
  });

  test("does not serve non-doc files", async () => {
    const response = await fetch(url("/notes.txt"));
    expect(response.status).toBe(404);
  });
});
