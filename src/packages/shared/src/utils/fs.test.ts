import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileAtomic } from "./fs";

const folders: string[] = [];
function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "atom-atomic-"));
  folders.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempFiles(dir: string): string[] {
  return readdirSync(dir).filter(name => name.includes(".tmp-"));
}

describe("writeFileAtomic", () => {
  test("writes and replaces file content", () => {
    const dir = makeDir();
    const path = join(dir, "file.txt");
    writeFileAtomic(path, "first");
    expect(readFileSync(path, "utf8")).toBe("first");
    writeFileAtomic(path, "second");
    expect(readFileSync(path, "utf8")).toBe("second");
    expect(tempFiles(dir)).toEqual([]);
  });

  test("preserves the destination mode when none is given", () => {
    const dir = makeDir();
    const path = join(dir, "secret.txt");
    writeFileSync(path, "old");
    chmodSync(path, 0o640);
    writeFileAtomic(path, "new");
    expect(statSync(path).mode & 0o777).toBe(0o640);
  });

  test("new files honour the process umask", () => {
    const dir = makeDir();
    const path = join(dir, "plain.txt");
    writeFileAtomic(path, "value");
    expect(statSync(path).mode & 0o777).toBe(0o666 & ~process.umask());
  });

  test("applies an explicit mode", () => {
    const dir = makeDir();
    const path = join(dir, "secret.txt");
    writeFileAtomic(path, "new", { mode: 0o600 });
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  test("creates parent directories", () => {
    const dir = makeDir();
    const path = join(dir, "deep", "nested", "file.txt");
    writeFileAtomic(path, "value");
    expect(readFileSync(path, "utf8")).toBe("value");
  });

  test("can refuse to create parent directories", () => {
    const dir = makeDir();
    const path = join(dir, "missing", "file.txt");
    expect(() => writeFileAtomic(path, "value", { createDirs: false })).toThrow();
    expect(existsSync(path)).toBe(false);
  });

  test("cleans up the temp file when rename fails", () => {
    const dir = makeDir();
    const path = join(dir, "target");
    mkdirSync(path);
    expect(() => writeFileAtomic(path, "value")).toThrow();
    expect(tempFiles(dir)).toEqual([]);
  });

  test("supports fsync without changing content", () => {
    const dir = makeDir();
    const path = join(dir, "durable.txt");
    writeFileAtomic(path, "durable", { fsync: true });
    expect(readFileSync(path, "utf8")).toBe("durable");
  });
});
