import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localUrl, readRuntimeFile, runtimeFilePath } from "./runtime-file";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "atom-runtime-file-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("runtime file", () => {
  test("builds the sandbox path and reads a valid file", () => {
    const sandbox = tempDir();
    const path = runtimeFilePath(sandbox, "gateway");
    expect(path).toBe(join(sandbox, ".atom", "gateway-runtime.json"));
    mkdirSync(join(sandbox, ".atom"), { recursive: true });
    writeFileSync(path, JSON.stringify({ url: "http://127.0.0.1:3000", token: "t", instanceId: "i" }));

    expect(readRuntimeFile(sandbox, "gateway")).toEqual({
      url: "http://127.0.0.1:3000",
      token: "t",
      instanceId: "i",
    });
  });

  test("rejects malformed files and missing fields", () => {
    const sandbox = tempDir();
    mkdirSync(join(sandbox, ".atom"), { recursive: true });
    const path = runtimeFilePath(sandbox, "core");
    writeFileSync(path, "{broken");
    expect(() => readRuntimeFile(sandbox, "core")).toThrow();
    writeFileSync(path, JSON.stringify({ url: "http://x", token: "t" }));
    expect(() => readRuntimeFile(sandbox, "core")).toThrow("Invalid core runtime file");
    writeFileSync(path, JSON.stringify({ url: 1, token: "t", instanceId: "i" }));
    expect(() => readRuntimeFile(sandbox, "core")).toThrow("Invalid core runtime file");
  });

  test("normalizes wildcard hosts", () => {
    expect(localUrl("0.0.0.0", 3000)).toBe("http://127.0.0.1:3000");
    expect(localUrl("::", 3000)).toBe("http://[::1]:3000");
    expect(localUrl("localhost", 3000)).toBe("http://localhost:3000");
  });
});
