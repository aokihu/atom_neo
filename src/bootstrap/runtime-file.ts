import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type RuntimeFile = { url: string; token: string; instanceId: string };
export function readRuntimeFile(sandbox: string, service: "core" | "gateway"): RuntimeFile {
  const value = JSON.parse(readFileSync(join(sandbox, ".atom", `${service}-runtime.json`), "utf8"));
  if (!value.url || !value.token || !value.instanceId) throw new Error(`Invalid ${service} runtime file`);
  return value;
}
export function publishRuntimeFile(sandbox: string, service: "core" | "gateway", value: RuntimeFile): () => void {
  const dir = join(sandbox, ".atom");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${service}-runtime.json`);
  const temp = `${path}.${value.instanceId}`;
  writeFileSync(temp, JSON.stringify(value), { mode: 0o600, flag: "wx" });
  chmodSync(temp, 0o600);
  renameSync(temp, path);
  return () => {
    try { if (readRuntimeFile(sandbox, service).instanceId === value.instanceId) rmSync(path); } catch { /* absent or replaced */ }
  };
}
export function localUrl(host: string, port: number): string {
  const address = host === "0.0.0.0" ? "127.0.0.1" : host === "::" ? "::1" : host;
  return `http://${address.includes(":") ? `[${address}]` : address}:${port}`;
}
