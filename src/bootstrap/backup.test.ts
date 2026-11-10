/**
 * export / import command tests: file handling, merge semantics and backups.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyImport, exportBackup, planImport, runBackupCommand } from "./backup";
import { parseArguments } from "./cli";
import { decodeBackup, encodeBackup } from "./backup-format";

const folders: string[] = [];
const validConfig = `${JSON.stringify({ version: 2, providers: { deepseek: { apiKeyEnv: "DEEPSEEK_API_KEY", models: ["deepseek-v4"] } } }, null, 2)}\n`;

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "atom-backup-"));
  folders.push(dir);
  return dir;
}

function makeSandbox(files: { config?: string; env?: string } = {}): string {
  const dir = makeDir();
  writeFileSync(join(dir, "config.json"), files.config ?? validConfig);
  if (files.env !== undefined) writeFileSync(join(dir, ".env"), files.env);
  return dir;
}

function writeArchive(bundle: Record<string, string>, password?: string): string {
  const path = join(makeDir(), "backup.atombak");
  writeFileSync(path, encodeBackup(bundle, { appVersion: "test", password }));
  return path;
}

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe("exportBackup", () => {
  test("writes config and env with mode 0600", () => {
    const sandbox = makeSandbox({ env: "DEEPSEEK_API_KEY=sk-test\n" });
    const output = join(makeDir(), "backup.atombak");
    const result = exportBackup({ sandbox, output });
    expect(result.encrypted).toBe(false);
    expect(result.files.map(file => file.name)).toEqual(["config.json", ".env"]);
    expect(statSync(output).mode & 0o777).toBe(0o600);
    expect(decodeBackup(readFileSync(output, "utf8")).bundle).toEqual({
      "config.json": validConfig,
      ".env": "DEEPSEEK_API_KEY=sk-test\n",
    });
  });

  test("encrypts the archive when a password is given", () => {
    const sandbox = makeSandbox({ env: "KEY=value\n" });
    const output = join(makeDir(), "backup.atombak");
    const result = exportBackup({ sandbox, output, password: "correct-horse" });
    expect(result.encrypted).toBe(true);
    expect(decodeBackup(readFileSync(output, "utf8"), "correct-horse").bundle["config.json"]).toBe(validConfig);
    expect(() => decodeBackup(readFileSync(output, "utf8"), "wrong-password")).toThrow("wrong password");
  });

  test("skips a missing .env and rejects a missing config", () => {
    const sandbox = makeSandbox();
    const output = join(makeDir(), "backup.atombak");
    const bundle = decodeBackup(readFileSync(exportBackup({ sandbox, output }).path, "utf8")).bundle;
    expect(bundle[".env"]).toBeUndefined();

    const empty = makeDir();
    expect(() => exportBackup({ sandbox: empty, output: join(makeDir(), "other.atombak") })).toThrow("config.json not found");
  });

  test("protects existing output unless --force is used", () => {
    const sandbox = makeSandbox();
    const output = join(makeDir(), "backup.atombak");
    writeFileSync(output, "old");
    expect(() => exportBackup({ sandbox, output })).toThrow("already exists");
    expect(exportBackup({ sandbox, output, force: true }).path).toBe(output);
  });

  test("appends the default name when output is a directory", () => {
    const sandbox = makeSandbox();
    const directory = makeDir();
    const result = exportBackup({ sandbox, output: directory });
    expect(result.path.startsWith(join(directory, "atom-backup-"))).toBe(true);
    expect(existsSync(result.path)).toBe(true);
  });
});

describe("planImport and applyImport", () => {
  test("merges .env keys and creates timestamped backups", () => {
    const sandbox = makeSandbox({ env: "LOCAL=keep\nDEEPSEEK_API_KEY=old\n# comment\n" });
    const archive = writeArchive({
      "config.json": validConfig,
      ".env": "DEEPSEEK_API_KEY=new\nOPENAI_API_KEY=sk-new\n",
    });
    const plan = planImport({ archive, sandbox, envMode: "merge" });
    expect(plan.envAction).toBe("merged");
    expect(plan.envKeys).toEqual(["DEEPSEEK_API_KEY", "OPENAI_API_KEY"]);
    const result = applyImport(plan);
    expect(result.configBackup).toBeDefined();
    expect(result.envBackup).toBeDefined();
    expect(readFileSync(join(sandbox, ".env"), "utf8")).toBe("LOCAL=keep\nDEEPSEEK_API_KEY=new\n# comment\nOPENAI_API_KEY=sk-new\n");
    expect(statSync(join(sandbox, ".env")).mode & 0o777).toBe(0o600);
    expect(readdirSync(sandbox).filter(name => name.includes(".bak.")).length).toBe(2);
  });

  test("replaces .env exactly in replace mode", () => {
    const sandbox = makeSandbox({ env: "LOCAL=keep\n" });
    const archive = writeArchive({ "config.json": validConfig, ".env": "OPENAI_API_KEY=sk-new\n" });
    const plan = planImport({ archive, sandbox, envMode: "replace" });
    expect(plan.envAction).toBe("replaced");
    applyImport(plan);
    expect(readFileSync(join(sandbox, ".env"), "utf8")).toBe("OPENAI_API_KEY=sk-new\n");
  });

  test("leaves .env untouched when the archive has none", () => {
    const sandbox = makeSandbox({ env: "LOCAL=keep\n" });
    const archive = writeArchive({ "config.json": validConfig });
    const plan = planImport({ archive, sandbox, envMode: "merge" });
    expect(plan.envAction).toBe("unchanged");
    expect(plan.envContent).toBeUndefined();
    applyImport(plan);
    expect(readFileSync(join(sandbox, ".env"), "utf8")).toBe("LOCAL=keep\n");
  });

  test("requires the password for encrypted archives", () => {
    const sandbox = makeSandbox();
    const archive = writeArchive({ "config.json": validConfig }, "correct-horse");
    expect(() => planImport({ archive, sandbox, envMode: "merge" })).toThrow("password is required");
    expect(planImport({ archive, sandbox, envMode: "merge", password: "correct-horse" }).summary.encrypted).toBe(true);
  });

  test("rejects invalid config before writing anything", () => {
    const sandbox = makeSandbox({ env: "LOCAL=keep\n" });
    const archive = writeArchive({ "config.json": "{bad json", ".env": "NEW=value\n" });
    expect(() => planImport({ archive, sandbox, envMode: "replace" })).toThrow("Invalid config.json");
    expect(readFileSync(join(sandbox, "config.json"), "utf8")).toBe(validConfig);
    expect(readFileSync(join(sandbox, ".env"), "utf8")).toBe("LOCAL=keep\n");
  });

  test("rejects unreadable archives", () => {
    const sandbox = makeSandbox();
    const archive = join(makeDir(), "broken.atombak");
    writeFileSync(archive, "not json");
    expect(() => planImport({ archive, sandbox, envMode: "merge" })).toThrow("not valid JSON");
  });

  test("creates a new sandbox directory on import", () => {
    const archive = writeArchive({ "config.json": validConfig, ".env": "KEY=value\n" });
    const sandbox = join(makeDir(), "fresh");
    const result = applyImport(planImport({ archive, sandbox, envMode: "merge" }));
    expect(result.envAction).toBe("merged");
    expect(readFileSync(join(sandbox, "config.json"), "utf8")).toBe(validConfig);
    expect(readFileSync(join(sandbox, ".env"), "utf8")).toBe("KEY=value\n");
  });
});

async function withoutTTY(run: () => Promise<void>): Promise<void> {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  const password = process.env.ATOM_BACKUP_PASSWORD;
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: false });
  delete process.env.ATOM_BACKUP_PASSWORD;
  try {
    await run();
  } finally {
    if (descriptor) Object.defineProperty(process.stdin, "isTTY", descriptor);
    else Reflect.deleteProperty(process.stdin, "isTTY");
    if (password !== undefined) process.env.ATOM_BACKUP_PASSWORD = password;
  }
}

function importArguments(archive: string, sandbox: string) {
  const args = parseArguments(["import", archive, "--sandbox", sandbox, "--force"]);
  if (args === "help") throw new Error("Unexpected help");
  return args;
}

describe("runBackupCommand password detection", () => {
  test("imports an unencrypted archive without asking for a password", async () => {
    await withoutTTY(async () => {
      const sandbox = makeSandbox();
      const archive = writeArchive({ "config.json": validConfig, ".env": "KEY=value\n" });
      await runBackupCommand(importArguments(archive, sandbox));
      expect(readFileSync(join(sandbox, ".env"), "utf8")).toBe("KEY=value\n");
    });
  });

  test("requires a password for an encrypted archive", async () => {
    await withoutTTY(async () => {
      const sandbox = makeSandbox();
      const archive = writeArchive({ "config.json": validConfig }, "correct-horse");
      await expect(runBackupCommand(importArguments(archive, sandbox))).rejects.toThrow("Password required");
    });
  });
});
