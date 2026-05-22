import { z } from "zod";
import type { ToolDefinition } from "@atom-neo/shared";
import { PermissionLevel } from "@atom-neo/shared";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

let sandboxRoot = process.cwd();

export function setBashSandbox(path: string): void {
  sandboxRoot = resolve(path);
  if (!existsSync(sandboxRoot)) mkdirSync(sandboxRoot, { recursive: true });
}

const bashSchema = z.object({
  command: z.string().describe("The shell command to execute"),
  timeout: z.number().optional().default(30_000).describe("Timeout in ms"),
});

export const bashTool: ToolDefinition = {
  name: "bash",
  description:
    "Execute a shell command in a sandboxed workspace directory. Requires user approval.",
  source: "builtin",
  inputSchema: bashSchema,
  execute: async (args) => {
    const r = bashSchema.safeParse(args);
    if (!r.success) return { ok: false, output: "", error: r.error.message };

    const { command, timeout } = r.data;
    try {
      const output = execSync(command, {
        cwd: sandboxRoot,
        timeout,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
      });
      return { ok: true, output: output.trim() || "(no output)" };
    } catch (err: any) {
      return {
        ok: false,
        output: err.stdout?.trim() || "",
        error: err.stderr?.trim() || err.message,
      };
    }
  },
  permission: PermissionLevel.FULL,
  requiresApproval: true,
};
