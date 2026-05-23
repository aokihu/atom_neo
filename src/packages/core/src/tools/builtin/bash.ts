import { z } from "zod";
import type { ToolDefinition } from "@atom-neo/shared";
import { PermissionLevel } from "@atom-neo/shared";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

export function createBashTool(sandbox: string): ToolDefinition {
  const root = resolve(sandbox);
  if (!existsSync(root)) mkdirSync(root, { recursive: true });

  const schema = z.object({
    command: z.string(),
    timeout: z.number().optional().default(30_000),
  });

  return {
    name: "bash",
    description: "Execute a shell command in sandbox. Requires user approval.",
    source: "builtin",
    inputSchema: schema,
    execute: async (args) => {
      const r = schema.safeParse(args);
      if (!r.success) return { ok: false, output: "", error: r.error.message };
      const { command, timeout } = r.data;
      try {
        const output = execSync(command, { cwd: root, timeout, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 });
        return { ok: true, output: output.trim() || "(no output)" };
      } catch (err: any) {
        return { ok: false, output: err.stdout?.trim() || "", error: err.stderr?.trim() || err.message };
      }
    },
    permission: PermissionLevel.FULL,
    requiresApproval: true,
  };
}
