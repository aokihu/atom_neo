import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnv } from "./env";

const folders: string[] = [];
const touched = new Set<string>();

function makeSandbox(env: string): string {
  const dir = mkdtempSync(join(tmpdir(), "atom-env-"));
  folders.push(dir);
  writeFileSync(join(dir, ".env"), env);
  return dir;
}

function setEnv(key: string, value: string | undefined): void {
  touched.add(key);
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(() => {
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true });
  for (const key of touched) delete process.env[key];
  touched.clear();
});

describe("loadEnv", () => {
  test("loads keys without overwriting existing process.env values", () => {
    setEnv("ATOM_ENV_TEST_EXISTING", "keep");
    setEnv("ATOM_ENV_TEST_NEW", undefined);
    const sandbox = makeSandbox("ATOM_ENV_TEST_EXISTING=file\nexport ATOM_ENV_TEST_NEW=loaded\n");

    loadEnv(sandbox);

    expect(process.env.ATOM_ENV_TEST_EXISTING).toBe("keep");
    expect(process.env.ATOM_ENV_TEST_NEW).toBe("loaded");
  });

  test("unquotes values and tolerates a missing file", () => {
    setEnv("ATOM_ENV_TEST_QUOTED", undefined);
    loadEnv(makeSandbox('ATOM_ENV_TEST_QUOTED="hello world"\n'));
    expect(process.env.ATOM_ENV_TEST_QUOTED).toBe("hello world");

    expect(() => loadEnv(join(tmpdir(), "atom-env-missing-file"))).not.toThrow();
  });
});
