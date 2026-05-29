import { z } from "zod";
import type { ToolDefinition } from "@atom-neo/shared";
import { PermissionLevel } from "@atom-neo/shared";
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

      const proc = Bun.spawn(["sh", "-c", command], {
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env },
      });

      const timer = timeout ? setTimeout(() => proc.kill("SIGTERM"), timeout) : null;

      const [exitCode, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      if (timer) clearTimeout(timer);

      const out = stdout.trim();
      const err = stderr.trim();

      if (exitCode === 0) {
        return { ok: true, output: out || err || "(no output)" };
      }
      return {
        ok: false,
        output: out || "",
        error: err || `exit code ${exitCode}`,
      };
    },
    permission: PermissionLevel.FULL,
    requiresApproval: true,
  };
}
