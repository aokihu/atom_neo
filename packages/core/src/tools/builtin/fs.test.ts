import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { readTool, writeTool, lsTool, cpTool, mvTool, grepTool, treeTool } from "./fs";
import { mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

let tmpDir: string;

function before() {
  tmpDir = mkdtempSync(resolve(tmpdir(), "atom-test-"));
}
function after() {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
}

describe("read tool", () => {
  beforeEach(before);
  afterEach(after);

  test("reads file contents", async () => {
    const filepath = resolve(tmpDir, "test.txt");
    Bun.write(filepath, "hello\nworld");
    const result = await readTool.execute({ filepath });
    expect(result.ok).toBe(true);
    expect(result.output).toBe("hello\nworld");
  });

  test("reads with offset and limit", async () => {
    const filepath = resolve(tmpDir, "test.txt");
    Bun.write(filepath, "line1\nline2\nline3\nline4");
    const result = await readTool.execute({ filepath, offset: 2, limit: 2 });
    expect(result.ok).toBe(true);
    expect(result.output).toBe("line2\nline3");
  });

  test("returns error for missing file", async () => {
    const result = await readTool.execute({ filepath: "/nonexistent" });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe("write tool", () => {
  beforeEach(before);
  afterEach(after);

  test("writes content to file", async () => {
    const filepath = resolve(tmpDir, "out.txt");
    const result = await writeTool.execute({ filepath, content: "test content" });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("Wrote");
  });

  test("creates parent directories", async () => {
    const filepath = resolve(tmpDir, "sub/deep/file.txt");
    const result = await writeTool.execute({ filepath, content: "deep" });
    expect(result.ok).toBe(true);
    const content = await readTool.execute({ filepath });
    expect(content.output).toBe("deep");
  });
});

describe("ls tool", () => {
  beforeEach(before);
  afterEach(after);

  test("lists directory contents", async () => {
    Bun.write(resolve(tmpDir, "a.txt"), "a");
    Bun.write(resolve(tmpDir, "b.txt"), "b");
    const result = await lsTool.execute({ path: tmpDir });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("a.txt");
    expect(result.output).toContain("b.txt");
  });

  test("defaults to current directory", async () => {
    const result = await lsTool.execute({});
    expect(result.ok).toBe(true);
  });
});

describe("cp tool", () => {
  beforeEach(before);
  afterEach(after);

  test("copies a file", async () => {
    const src = resolve(tmpDir, "src.txt");
    const dst = resolve(tmpDir, "dst.txt");
    Bun.write(src, "copy me");
    const result = await cpTool.execute({ source: src, dest: dst });
    expect(result.ok).toBe(true);
    const content = await readTool.execute({ filepath: dst });
    expect(content.output).toBe("copy me");
  });
});

describe("mv tool", () => {
  beforeEach(before);
  afterEach(after);

  test("moves a file", async () => {
    const src = resolve(tmpDir, "original.txt");
    const dst = resolve(tmpDir, "renamed.txt");
    Bun.write(src, "move me");
    const result = await mvTool.execute({ source: src, dest: dst });
    expect(result.ok).toBe(true);
    const content = await readTool.execute({ filepath: dst });
    expect(content.output).toBe("move me");
  });
});

describe("grep tool", () => {
  beforeEach(before);
  afterEach(after);

  test("finds matching lines in file", async () => {
    const filepath = resolve(tmpDir, "code.ts");
    Bun.write(filepath, "const x = 1;\nfunction foo() {}\nconst y = 2;");
    const result = await grepTool.execute({ pattern: "const", path: filepath });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("const x");
    expect(result.output).toContain("const y");
  });
});

describe("tree tool", () => {
  beforeEach(before);
  afterEach(after);

  test("generates directory tree", async () => {
    Bun.write(resolve(tmpDir, "root.txt"), "");
    Bun.write(resolve(tmpDir, "sub/nested.txt"), "");
    const result = await treeTool.execute({ path: tmpDir, maxDepth: 3 });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("root.txt");
    expect(result.output).toContain("nested.txt");
  });
});
