import { readFileSync } from "node:fs";
import { parseEnv } from "@atom-neo/shared";

/** Read the sandbox .env without mutating process.env; missing files yield an empty map. */
export function readSandboxEnv(sandboxPath: string): Record<string, string> {
  try {
    return parseEnv(readFileSync(`${sandboxPath}/.env`, "utf-8"));
  } catch {
    return {};
  }
}

export function loadEnv(sandboxPath: string): void {
  for (const [key, value] of Object.entries(readSandboxEnv(sandboxPath))) {
    if (!process.env[key]) process.env[key] = value;
  }
}
