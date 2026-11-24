import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { localUrl, readRuntimeFile, runtimeFilePath, writeFileAtomic } from "@atom-neo/shared";
import type { RuntimeFile } from "@atom-neo/shared";

export type { RuntimeFile };
export { localUrl, readRuntimeFile, runtimeFilePath };

export function publishRuntimeFile(sandbox: string, service: "core" | "gateway", value: RuntimeFile): () => void {
  const dir = join(sandbox, ".atom");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = runtimeFilePath(sandbox, service);
  writeFileAtomic(path, JSON.stringify(value), { mode: 0o600, fsync: true, createDirs: false });
  return () => {
    try { if (readRuntimeFile(sandbox, service).instanceId === value.instanceId) rmSync(path); } catch { /* absent or replaced */ }
  };
}

/** Local runtime credentials stay authoritative; remote credentials are explicit. */
export function readAttachToken(sandbox: string, host: string, remoteToken?: string): string {
  if (["localhost", "127.0.0.1", "::1"].includes(host)) {
    try { return readRuntimeFile(sandbox, "core").token; }
    catch (error) { if (!remoteToken) throw error; }
  }
  if (!remoteToken?.trim()) throw new Error("Remote attach requires ATOM_ADMIN_TOKEN in the environment or sandbox .env");
  return remoteToken.trim();
}
