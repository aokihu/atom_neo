import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { readTool, writeTool, lsTool, cpTool, mvTool, grepTool, treeTool, setSandbox } from "./fs";
import { mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

let tmpDir: string;

function before() {
  tmpDir = mkdtempSync(resolve(tmpdir(), "atom-test-"));
  setSandbox(tmpDir);
}
function after() {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
}

describe("read tool", () => {
  beforeEach(before);
  afterEach(after);

  test("reads file contents", async () => {
    Bun.write(resolve(tmpDir, "test.txt"), "hello\nworld");
    const result = await readTool.execute({ filepath: "test.txt" });
    expect(result.ok).toBe(true);
    expect(result.output).toBe("hello\nworld");
  });

  test("returns error for missing file", async () => {
    const result = await readTool.execute({ filepath: "nonexistent.txt" });
    expect(result.ok).toBe(false);
  });
});

describe("write tool", () => {
  beforeEach(before);
  afterEach(after);

  test("writes content to file", async () => {
    const result = await writeTool.execute({ filepath: "out.txt", content: "test content" });
    expect(result.ok).toBe(true);
    const content = await readTool.execute({ filepath: "out.txt" });
    expect(content.output).toBe("test content");
  });
});

describe("ls tool", () => {
  beforeEach(before);
  afterEach(after);

  test("lists directory contents", async () => {
    Bun.write(resolve(tmpDir, "a.txt"), "a");
    Bun.write(resolve(tmpDir, "b.txt"), "b");
    const result = await lsTool.execute({ path: "." });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("a.txt");
  });
});

describe("cp tool", () => {
  beforeEach(before);
  afterEach(after);

  test("copies a file", async () => {
    Bun.write(resolve(tmpDir, "src.txt"), "copy me");
    const result = await cpTool.execute({ source: "src.txt", dest: "dst.txt" });
    expect(result.ok).toBe(true);
    const content = await readTool.execute({ filepath: "dst.txt" });
    expect(content.output).toBe("copy me");
  });
});

describe("mv tool", () => {
  beforeEach(before);
  afterEach(after);

  test("moves a file", async () => {
    Bun.write(resolve(tmpDir, "original.txt"), "move me");
    const result = await mvTool.execute({ source: "original.txt", dest: "renamed.txt" });
    expect(result.ok).toBe(true);
    const content = await readTool.execute({ filepath: "renamed.txt" });
    expect(content.output).toBe("move me");
  });
});

describe("grep tool", () => {
  beforeEach(before);
  afterEach(after);

  test("finds matching lines in file", async () => {
    Bun.write(resolve(tmpDir, "code.ts"), "const x = 1;\nfunction foo() {}\nconst y = 2;");
    const result = await grepTool.execute({ pattern: "const", path: "code.ts" });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("const x");
  });
});

describe("tree tool", () => {
  beforeEach(before);
  afterEach(after);

  test("generates directory tree", async () => {
    Bun.write(resolve(tmpDir, "root.txt"), "");
    Bun.write(resolve(tmpDir, "sub/nested.txt"), "");
    const result = await treeTool.execute({ path: ".", maxDepth: 3 });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("root.txt");
  });
});
