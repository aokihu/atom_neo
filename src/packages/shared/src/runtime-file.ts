import { readFileSync } from "node:fs";
import { join } from "node:path";

export type RuntimeFile = { url: string; token: string; instanceId: string };

export function runtimeFilePath(sandbox: string, kind: "core" | "gateway"): string {
  return join(sandbox, ".atom", `${kind}-runtime.json`);
}

export function readRuntimeFile(sandbox: string, kind: "core" | "gateway"): RuntimeFile {
  const value = JSON.parse(readFileSync(runtimeFilePath(sandbox, kind), "utf8")) as Partial<RuntimeFile>;
  if (
    typeof value.url !== "string" || value.url === ""
    || typeof value.token !== "string" || value.token === ""
    || typeof value.instanceId !== "string" || value.instanceId === ""
  ) throw new Error(`Invalid ${kind} runtime file`);
  return value as RuntimeFile;
}

/** Convert a listening address to a local connect URL. */
export function localUrl(host: string, port: number): string {
  const address = host === "0.0.0.0" ? "127.0.0.1" : host === "::" ? "::1" : host;
  return `http://${address.includes(":") ? `[${address}]` : address}:${port}`;
}
