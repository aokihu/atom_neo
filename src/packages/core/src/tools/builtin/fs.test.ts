import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createReadTool, createWriteTool, createLsTool, createCpTool, createMvTool, createGrepTool, createTreeTool, createSandbox } from "./fs";
import type { ToolDefinition } from "@atom-neo/shared";
import { mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

let tmpDir: string;
let read: ToolDefinition, write: ToolDefinition, ls: ToolDefinition,
    cp: ToolDefinition, mv: ToolDefinition, grep: ToolDefinition, tree: ToolDefinition;

function before() {
  tmpDir = mkdtempSync(resolve(tmpdir(), "atom-test-"));
  const sb = createSandbox(tmpDir);
  read = createReadTool(sb); write = createWriteTool(sb); ls = createLsTool(sb);
  cp = createCpTool(sb); mv = createMvTool(sb); grep = createGrepTool(sb); tree = createTreeTool(sb);
}
function after() { if (tmpDir) rmSync(tmpDir, { recursive: true, force: true }); }

describe("read tool", () => {
  beforeEach(before); afterEach(after);
  test("reads file contents", async () => {
    Bun.write(resolve(tmpDir, "test.txt"), "hello\nworld");
    const result = await read.execute({ filepath: "test.txt" });
    expect(result.ok).toBe(true);
    expect(result.output).toBe("hello\nworld");
  });
  test("returns error for missing file", async () => {
    const result = await read.execute({ filepath: "nonexistent.txt" });
    expect(result.ok).toBe(false);
  });
});

describe("write tool", () => {
  beforeEach(before); afterEach(after);
  test("writes content to file", async () => {
    const result = await write.execute({ filepath: "out.txt", content: "test" });
    expect(result.ok).toBe(true);
    const r = await read.execute({ filepath: "out.txt" });
    expect(r.output).toBe("test");
  });
});

describe("ls tool", () => {
  beforeEach(before); afterEach(after);
  test("lists directory contents", async () => {
    Bun.write(resolve(tmpDir, "a.txt"), "a");
    const result = await ls.execute({ path: "." });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("a.txt");
  });
});

describe("cp tool", () => {
  beforeEach(before); afterEach(after);
  test("copies a file", async () => {
    Bun.write(resolve(tmpDir, "src.txt"), "content");
    const result = await cp.execute({ source: "src.txt", dest: "dst.txt" });
    expect(result.ok).toBe(true);
    const r = await read.execute({ filepath: "dst.txt" });
    expect(r.output).toBe("content");
  });
});

describe("mv tool", () => {
  beforeEach(before); afterEach(after);
  test("moves a file", async () => {
    Bun.write(resolve(tmpDir, "orig.txt"), "test");
    const result = await mv.execute({ source: "orig.txt", dest: "ren.txt" });
    expect(result.ok).toBe(true);
    const r = await read.execute({ filepath: "ren.txt" });
    expect(r.output).toBe("test");
  });
});

describe("grep tool", () => {
  beforeEach(before); afterEach(after);
  test("finds matching lines", async () => {
    Bun.write(resolve(tmpDir, "code.ts"), "const x = 1;\nfunction foo() {}");
    const result = await grep.execute({ pattern: "const", path: "code.ts" });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("const x");
  });
});

describe("tree tool", () => {
  beforeEach(before); afterEach(after);
  test("generates directory tree", async () => {
    Bun.write(resolve(tmpDir, "root.txt"), "");
    Bun.write(resolve(tmpDir, "sub/nested.txt"), "");
    const result = await tree.execute({ path: ".", maxDepth: 3 });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("root.txt");
  });
});
