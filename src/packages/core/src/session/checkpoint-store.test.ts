import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { CheckpointStore } from "./checkpoint-store";
import type { CheckpointFilename } from "./session-format";

const roots: string[] = [];

const createStore = () => {
  const root = mkdtempSync(resolve(tmpdir(), "atom-checkpoint-store-"));
  roots.push(root);
  const sessionsDir = resolve(root, ".atom", "sessions");
  return { root, sessionsDir, store: new CheckpointStore(sessionsDir) };
};

const files = (revision: number): Record<CheckpointFilename, string> => ({
  "session.json": JSON.stringify({ schemaVersion: 1, checkpointRevision: revision }),
  "context.json": "{}\n",
  "message-latest.jsonl": "{\"type\":\"manifest\"}\n",
  "tool-records.jsonl": "{\"type\":\"manifest\"}\n",
});

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("CheckpointStore", () => {
  test("creates the sessions root and safely named session directories", () => {
    const { sessionsDir, store } = createStore();
    expect(statSync(sessionsDir).mode & 0o777).toBe(0o700);
    const dir = store.getSessionDirectory("unsafe/id");
    expect(dir).toBe(resolve(sessionsDir, "861eb7cae014cbebdef66a8b6b47472b"));
    expect(existsSync(dir)).toBe(true);
    expect(existsSync(store.getSessionDirectory("missing", false))).toBe(false);
    expect(store.listSessionDirectories()).toEqual([dir]);
    expect(store.readSessionState(dir)).toBeNull();
  });

  test("commits generations, publishes current, and keeps the previous generation", () => {
    const { store } = createStore();
    const dir = store.getSessionDirectory("commit");
    const first = store.commit(dir, 1, files(1));
    const second = store.commit(dir, 2, files(2));
    expect(first).toMatch(/^g-000000000001-/);
    expect(second).toMatch(/^g-000000000002-/);
    expect(readlinkSync(resolve(dir, "current"))).toBe(`.checkpoints/${second}`);
    expect(store.resolveCurrentGeneration(dir)).toBe(resolve(dir, ".checkpoints", second));
    expect(store.resolveCheckpoint("commit")).toEqual({
      directory: resolve(dir, ".checkpoints", second),
      generation: resolve(dir, ".checkpoints", second),
    });
    expect(store.readSessionState(resolve(dir, ".checkpoints", second))).toEqual({
      schemaVersion: 1,
      checkpointRevision: 2,
    } as unknown as ReturnType<CheckpointStore["readSessionState"]>);
    expect(readdirSync(resolve(dir, ".checkpoints")).filter(name => name.startsWith("g-")).toSorted())
      .toEqual([first, second].toSorted());
    for (const filename of ["session.json", "context.json", "message-latest.jsonl", "tool-records.jsonl"]) {
      expect(lstatSync(resolve(dir, filename)).isSymbolicLink()).toBe(true);
      expect(readlinkSync(resolve(dir, filename))).toBe(`current/${filename}`);
    }
  });

  test("rejects invalid or missing checkpoint pointers", () => {
    const { store } = createStore();
    const dir = store.getSessionDirectory("pointer");
    writeFileSync(resolve(dir, "current"), "not-a-link");
    expect(() => store.resolveCurrentGeneration(dir)).toThrow("Invalid session checkpoint pointer");

    rmSync(resolve(dir, "current"));
    symlinkSync("../outside", resolve(dir, "current"), "dir");
    expect(() => store.resolveCurrentGeneration(dir)).toThrow("Invalid session checkpoint pointer");

    rmSync(resolve(dir, "current"));
    symlinkSync(".checkpoints/g-999999999999-00000000-0000-4000-8000-000000000000", resolve(dir, "current"), "dir");
    expect(() => store.resolveCurrentGeneration(dir)).toThrow("Session checkpoint generation is missing");
  });

  test("rejects unsupported schemas and cleans failed generation writes", () => {
    const { store } = createStore();
    const dir = store.getSessionDirectory("invalid");
    writeFileSync(resolve(dir, "session.json"), JSON.stringify({ schemaVersion: 2 }));
    expect(() => store.readSessionState(dir)).toThrow("Unsupported session schema: 2");

    expect(() => store.writeGeneration(dir, 1, {
      "session.json": "{}",
    } as unknown as Record<CheckpointFilename, string>)).toThrow();
    expect(readdirSync(resolve(dir, ".checkpoints"))).toEqual([]);
  });

  test("keeps the previous committed generation when a new commit fails", () => {
    const { store } = createStore();
    const dir = store.getSessionDirectory("rollback");
    const first = store.commit(dir, 1, files(1));
    expect(() => store.commit(dir, 2, {
      "session.json": "{}",
    } as unknown as Record<CheckpointFilename, string>)).toThrow();
    expect(store.resolveCurrentGeneration(dir)).toBe(resolve(dir, ".checkpoints", first));
    expect(store.readSessionState(resolve(dir, ".checkpoints", first))?.checkpointRevision).toBe(1);
    expect(readdirSync(resolve(dir, ".checkpoints")).filter(name => name.startsWith("g-"))).toEqual([first]);
  });

  test("removes session directories", () => {
    const { store } = createStore();
    const dir = store.getSessionDirectory("remove");
    store.commit(dir, 1, files(1));
    store.removeSession("remove");
    expect(existsSync(dir)).toBe(false);
  });

  test("reads the committed generation state through the compatibility link", () => {
    const { store } = createStore();
    const dir = store.getSessionDirectory("state");
    store.commit(dir, 1, files(1));
    expect(readFileSync(resolve(dir, "session.json"), "utf8")).toContain('"checkpointRevision":1');
  });
});
