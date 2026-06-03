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

      const KILL_GRACE = 3000;
      let killer: ReturnType<typeof setTimeout> | null = null;

      if (timeout) {
        killer = setTimeout(() => {
          proc.kill(); // SIGTERM
          setTimeout(() => proc.kill(9), KILL_GRACE); // SIGKILL if child still alive
        }, timeout);
      }

      const collect = async (stream: ReadableStream<Uint8Array>) => {
        const reader = stream.getReader();
        const chunks: string[] = [];
        let size = 0;
        const limit = 65536;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size <= limit) chunks.push(Buffer.from(value).toString());
        }
        return chunks.join("").slice(0, limit);
      };

      try {
        const [exitCode, stdout, stderr] = await Promise.all([
          proc.exited,
          collect(proc.stdout),
          collect(proc.stderr),
        ]);
        if (killer) clearTimeout(killer);

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
      } catch {
        try { proc.kill(9); } catch { /* already dead */ }
        if (killer) clearTimeout(killer);
        return { ok: false, output: "", error: `Command timed out after ${timeout}ms` };
      }
    },
    permission: PermissionLevel.FULL,
    requiresApproval: true,
  };
}
