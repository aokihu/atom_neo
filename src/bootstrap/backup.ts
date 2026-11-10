/**
 * export / import subcommands: pack sandbox config.json + .env into a .atombak archive.
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import type { BackupEnvMode, BootArguments } from "./cli";
import { ConfigSchema, mergeEnv, parseEnvKeys, writeFileAtomic } from "@atom-neo/shared";
import {
  BACKUP_EXTENSION,
  MAX_ARCHIVE_BYTES,
  decodeBackup,
  encodeBackup,
  inspectBackup,
  type BackupBundle,
  type BackupFileEntry,
  type BackupSummary,
} from "./backup-format";
import { VERSION } from "../version";

export type ExportRequest = { sandbox: string; output?: string; password?: string; force?: boolean };
export type ExportResult = { path: string; files: BackupFileEntry[]; encrypted: boolean; bytes: number };
export type ImportRequest = { archive: string; sandbox: string; password?: string; envMode: BackupEnvMode };
export type ImportPlan = {
  archive: string;
  summary: BackupSummary;
  sandbox: string;
  configPath: string;
  configContent: string;
  configExists: boolean;
  envPath: string;
  envContent?: string;
  envExists: boolean;
  envAction: "merged" | "replaced" | "unchanged";
  envKeys: string[];
};
export type ImportResult = {
  configPath: string;
  configBackup?: string;
  envPath?: string;
  envBackup?: string;
  envAction: ImportPlan["envAction"];
};

function timestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function assertDirectory(path: string): void {
  if (!existsSync(path)) throw new Error(`Sandbox directory not found: ${path}`);
  if (!statSync(path).isDirectory()) throw new Error(`Sandbox path is not a directory: ${path}`);
}

function readText(path: string): string {
  const content = readFileSync(path, "utf8");
  if (content.includes("\0")) throw new Error(`${path} contains NUL bytes`);
  return content;
}

function readArchive(path: string): string {
  if (!existsSync(path)) throw new Error(`Archive not found: ${path}`);
  const stats = statSync(path);
  if (!stats.isFile()) throw new Error(`Archive is not a file: ${path}`);
  if (stats.size > MAX_ARCHIVE_BYTES) throw new Error(`Archive is too large: ${path}`);
  return readText(path);
}

function backupFile(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const stamp = timestamp();
  let candidate = `${path}.bak.${stamp}`;
  for (let suffix = 2; existsSync(candidate); suffix++) candidate = `${path}.bak.${stamp}.${suffix}`;
  copyFileSync(path, candidate);
  chmodSync(candidate, statSync(path).mode & 0o777);
  return candidate;
}

function validateConfig(content: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`Invalid config.json: ${error instanceof Error ? error.message : String(error)}`);
  }
  const result = ConfigSchema.safeParse(parsed);
  if (result.success) return;
  const issues = result.error.issues.map(issue => `  ${issue.path.length ? issue.path.join(".") : "(root)"}: ${issue.message}`).join("\n");
  throw new Error(`Invalid config.json:\n${issues}`);
}

function resolveOutput(output?: string): string {
  const name = `atom-backup-${timestamp()}${BACKUP_EXTENSION}`;
  if (!output) return resolve(name);
  const target = resolve(output);
  return existsSync(target) && statSync(target).isDirectory() ? join(target, name) : target;
}

export function exportBackup(request: ExportRequest): ExportResult {
  assertDirectory(request.sandbox);
  const configPath = join(request.sandbox, "config.json");
  const envPath = join(request.sandbox, ".env");
  if (!existsSync(configPath)) throw new Error(`config.json not found in sandbox: ${request.sandbox}`);
  const bundle: BackupBundle = { "config.json": readText(configPath) };
  if (existsSync(envPath)) bundle[".env"] = readText(envPath);
  const text = encodeBackup(bundle, { password: request.password, appVersion: VERSION });
  const output = resolveOutput(request.output);
  if (existsSync(output) && !request.force) throw new Error(`Output already exists: ${output} (use --force to overwrite)`);
  writeFileAtomic(output, text, { mode: 0o600 });
  const summary = inspectBackup(text);
  return { path: output, files: summary.files, encrypted: summary.encrypted, bytes: Buffer.byteLength(text, "utf8") };
}

export function planImport(request: ImportRequest): ImportPlan {
  if (existsSync(request.sandbox) && !statSync(request.sandbox).isDirectory()) throw new Error(`Sandbox path is not a directory: ${request.sandbox}`);
  const text = readArchive(request.archive);
  const summary = inspectBackup(text);
  if (summary.encrypted && !request.password) throw new Error("Backup is encrypted; password is required");
  const decoded = decodeBackup(text, request.password);
  const configContent = decoded.bundle["config.json"]!;
  if (configContent.includes("\0")) throw new Error("Invalid backup: config.json contains NUL bytes");
  validateConfig(configContent);
  const archivedEnv = decoded.bundle[".env"];
  if (archivedEnv?.includes("\0")) throw new Error("Invalid backup: .env contains NUL bytes");
  const configPath = join(request.sandbox, "config.json");
  const envPath = join(request.sandbox, ".env");
  const envExists = existsSync(envPath);
  const envAction: ImportPlan["envAction"] = archivedEnv === undefined ? "unchanged" : request.envMode === "replace" ? "replaced" : "merged";
  const envContent = archivedEnv === undefined
    ? undefined
    : request.envMode === "replace"
      ? archivedEnv
      : mergeEnv(envExists ? readText(envPath) : "", archivedEnv);
  return {
    archive: request.archive,
    summary,
    sandbox: request.sandbox,
    configPath,
    configContent,
    configExists: existsSync(configPath),
    envPath,
    envContent,
    envExists,
    envAction,
    envKeys: archivedEnv === undefined ? [] : parseEnvKeys(archivedEnv),
  };
}

export function applyImport(plan: ImportPlan): ImportResult {
  mkdirSync(plan.sandbox, { recursive: true });
  const configMode = plan.configExists ? statSync(plan.configPath).mode & 0o777 : 0o644;
  const configBackup = backupFile(plan.configPath);
  const envBackup = plan.envContent === undefined ? undefined : backupFile(plan.envPath);
  writeFileAtomic(plan.configPath, plan.configContent, { mode: configMode });
  if (plan.envContent !== undefined) writeFileAtomic(plan.envPath, plan.envContent, { mode: 0o600 });
  return {
    configPath: plan.configPath,
    configBackup,
    envPath: plan.envContent === undefined ? undefined : plan.envPath,
    envBackup,
    envAction: plan.envAction,
  };
}

function printImportPlan(plan: ImportPlan): void {
  console.log(`Archive: ${plan.archive}`);
  console.log(`  Created: ${plan.summary.createdAt}`);
  console.log(`  App version: ${plan.summary.appVersion}`);
  console.log(`  Encrypted: ${plan.summary.encrypted ? "yes" : "no"}`);
  console.log(`  Files: ${plan.summary.files.map(file => `${file.name} (${formatBytes(file.size)})`).join(", ")}`);
  console.log(`Target sandbox: ${plan.sandbox}`);
  console.log(`  config.json: ${plan.configExists ? "replace (backup will be created)" : "create"}`);
  const envSummary = plan.envAction === "unchanged"
    ? "unchanged (not in archive)"
    : plan.envAction === "replaced"
      ? "replace"
      : `merge (${plan.envKeys.length} key${plan.envKeys.length === 1 ? "" : "s"})`;
  console.log(`  .env: ${envSummary}${plan.envExists && plan.envAction !== "unchanged" ? " (backup will be created)" : ""}`);
}

async function promptPassword(label: string): Promise<string> {
  if (!process.stdin.isTTY) throw new Error("Cannot prompt for password: stdin is not a TTY");
  process.stderr.write(label);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  try {
    return await new Promise<string>((resolvePromise, reject) => {
      let value = "";
      const finish = (result: string | Error) => {
        process.stdin.off("data", onData);
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stderr.write("\n");
        if (result instanceof Error) reject(result);
        else resolvePromise(result);
      };
      const onData = (chunk: string) => {
        for (const char of chunk) {
          if (char === "\r" || char === "\n") return finish(value);
          if (char === "\u0003" || char === "\u0004") return finish(new Error("Cancelled"));
          if (char === "\u007f" || char === "\b") {
            value = value.slice(0, -1);
            continue;
          }
          if (char === "\u001b") continue;
          value += char;
        }
      };
      process.stdin.on("data", onData);
    });
  } finally {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  }
}

async function resolvePassword(confirm: boolean, requireStrong: boolean): Promise<string> {
  const fromEnv = process.env.ATOM_BACKUP_PASSWORD;
  if (fromEnv !== undefined) {
    if (!fromEnv) throw new Error("ATOM_BACKUP_PASSWORD is empty");
    if (requireStrong && fromEnv.length < 8) throw new Error("Password must be at least 8 characters");
    return fromEnv;
  }
  if (!process.stdin.isTTY) throw new Error("Password required: set ATOM_BACKUP_PASSWORD or run in a TTY");
  const password = await promptPassword("Password: ");
  if (!password) throw new Error("Password cannot be empty");
  if (requireStrong && password.length < 8) throw new Error("Password must be at least 8 characters");
  if (confirm) {
    const repeated = await promptPassword("Confirm password: ");
    if (repeated !== password) throw new Error("Passwords do not match");
  }
  return password;
}

async function confirmImport(): Promise<boolean> {
  if (!process.stdin.isTTY) throw new Error("Import requires --force in non-interactive mode");
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question("Import will replace config.json and may modify .env. Continue? [y/N] ");
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

export async function runBackupCommand(args: BootArguments): Promise<void> {
  if (args.command === "export") {
    const password = args.password ? await resolvePassword(true, true) : undefined;
    const result = exportBackup({ sandbox: args.sandbox, output: args.output, password, force: args.force });
    console.log(`Exported ${result.files.length} file(s) to ${result.path} (${formatBytes(result.bytes)})`);
    for (const file of result.files) console.log(`  ${file.name.padEnd(12)} ${formatBytes(file.size)}`);
    if (result.encrypted) console.log("Encrypted with AES-256-GCM. Keep the password safe — it cannot be recovered.");
    else console.warn("Warning: archive contains plaintext API keys. Store it securely (mode 0600).");
    return;
  }

  if (!args.archive) throw new Error("Import requires an archive path");
  const summary = inspectBackup(readArchive(args.archive));
  if (!summary.encrypted && args.password) console.warn("Archive is not encrypted; --password ignored.");
  const password = summary.encrypted ? await resolvePassword(false, false) : undefined;
  const plan = planImport({ archive: args.archive, sandbox: args.sandbox, password, envMode: args.envMode });
  printImportPlan(plan);
  if (args.dryRun) return;
  if (!args.force && !(await confirmImport())) {
    console.log("Import cancelled.");
    return;
  }
  const result = applyImport(plan);
  console.log(`Imported archive into ${plan.sandbox}`);
  console.log(`  config.json: written${result.configBackup ? ` (backup: ${result.configBackup})` : ""}`);
  if (result.envAction !== "unchanged") console.log(`  .env: ${result.envAction}${result.envBackup ? ` (backup: ${result.envBackup})` : ""}`);
  console.log("Restart Core to apply config.json changes.");
}
