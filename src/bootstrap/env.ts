import { readFileSync } from "node:fs";
import { parseEnv } from "@atom-neo/shared";

export function loadEnv(sandboxPath: string): void {
  try {
    const env = parseEnv(readFileSync(`${sandboxPath}/.env`, "utf-8"));
    for (const [key, value] of Object.entries(env)) {
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // .env not found, proceed without
  }
}
