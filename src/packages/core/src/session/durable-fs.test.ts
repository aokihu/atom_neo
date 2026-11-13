import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fsyncDirectory, writeAtomic, writeDurable } from "./durable-fs";

const roots: string[] = [];

const sandbox = () => {
  const root = mkdtempSync(resolve(tmpdir(), "atom-durable-fs-"));
  roots.push(root);
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("durable fs", () => {
  test("writes files with owner-only permissions and fsyncs them", () => {
    const root = sandbox();
    const path = resolve(root, "session.json");
    writeDurable(path, "durable\n");
    expect(readFileSync(path, "utf8")).toBe("durable\n");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(() => fsyncDirectory(root)).not.toThrow();
  });

  test("atomically replaces files and removes temporary files", () => {
    const root = sandbox();
    const path = resolve(root, "archive.jsonl");
    writeFileSync(path, "old");
    writeAtomic(path, "new");
    expect(readFileSync(path, "utf8")).toBe("new");
    expect(readdirSync(root)).toEqual(["archive.jsonl"]);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  test("cleans temporary files when an atomic write fails", () => {
    const root = sandbox();
    const path = resolve(root, "archive.jsonl");
    writeFileSync(path, "old");
    expect(() => writeAtomic(path, undefined as unknown as string)).toThrow();
    expect(readFileSync(path, "utf8")).toBe("old");
    expect(readdirSync(root)).toEqual(["archive.jsonl"]);
    expect(existsSync(path)).toBe(true);
  });
});
