import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { withFileLock } from "./file-lock";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "atom-file-lock-"));
  tempDirs.push(dir);
  return dir;
}

function lockPath(dir: string): string {
  return join(dir, "nested", "gateway", "test.lock");
}

function holdLock(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "999\n");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("withFileLock", () => {
  test("acquires the lock, runs the action, and releases the file", () => {
    const path = lockPath(tempDir());

    const result = withFileLock(path, () => {
      expect(existsSync(path)).toBe(true);
      expect(readFileSync(path, "utf8")).toBe(`${process.pid}\n`);
      return "done";
    });

    expect(result).toBe("done");
    expect(existsSync(path)).toBe(false);
  });

  test("fails immediately by default while another owner holds the lock", () => {
    const path = lockPath(tempDir());
    holdLock(path);

    expect(() => withFileLock(path, () => "never")).toThrow(`File lock is busy after 0ms: ${path}`);
    expect(existsSync(path)).toBe(true);

    rmSync(path, { force: true });
    expect(withFileLock(path, () => "next")).toBe("next");
    expect(existsSync(path)).toBe(false);
  });

  test("waits until the timeout and reports a clear custom message", () => {
    const path = lockPath(tempDir());
    holdLock(path);
    const started = Date.now();

    expect(() => withFileLock(path, () => "never", {
      timeoutMs: 50,
      retryMs: 10,
      lockedMessage: `Gateway is locked: ${path}`,
    })).toThrow(`Gateway is locked: ${path}`);

    expect(Date.now() - started).toBeGreaterThanOrEqual(30);
    expect(existsSync(path)).toBe(true);
  });

  test("releases the lock when the action throws", () => {
    const path = lockPath(tempDir());

    expect(() => withFileLock(path, () => {
      throw new Error("boom");
    })).toThrow("boom");

    expect(existsSync(path)).toBe(false);
    expect(withFileLock(path, () => "after")).toBe("after");
    expect(existsSync(path)).toBe(false);
  });

  test("a nested acquire times out, then the owner releases for the next caller", () => {
    const path = lockPath(tempDir());

    withFileLock(path, () => {
      expect(() => withFileLock(path, () => "nested", { timeoutMs: 40, retryMs: 10 }))
        .toThrow(`File lock is busy after 40ms: ${path}`);
      expect(existsSync(path)).toBe(true);
    });

    expect(existsSync(path)).toBe(false);
    expect(withFileLock(path, () => "next")).toBe("next");
    expect(existsSync(path)).toBe(false);
  });
});
