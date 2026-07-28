import { z } from "zod";
import type { ToolDefinition, ToolExecuteOptions } from "@atom-neo/shared";
import { PermissionLevel } from "@atom-neo/shared";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { TOOL_OUTCOMES } from "../outcome";

const OUTPUT_LIMIT = 65536;

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
    execute: async (args, opts?: ToolExecuteOptions) => {
      const r = schema.safeParse(args);
      if (!r.success) return { ok: false, output: "", error: r.error.message, outcome: TOOL_OUTCOMES.error };
      const { command, timeout } = r.data;

      const proc = Bun.spawn(["sh", "-c", command], {
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env },
        timeout,
        killSignal: "SIGKILL",
        signal: opts?.abortSignal,
      });

      const collect = async (stream: ReadableStream<Uint8Array>) => {
        const reader = stream.getReader();
        const chunks: string[] = [];
        let size = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size <= OUTPUT_LIMIT) chunks.push(Buffer.from(value).toString());
        }
        return chunks.join("").slice(0, OUTPUT_LIMIT);
      };

      try {
        const [exitCode, stdout, stderr] = await Promise.all([
          proc.exited,
          collect(proc.stdout),
          collect(proc.stderr),
        ]);

        const out = stdout.trim();
        const err = stderr.trim();

        if (opts?.abortSignal?.aborted) {
          return { ok: false, output: out, error: "Command cancelled", outcome: TOOL_OUTCOMES.cancelled };
        }
        if (exitCode === 0) {
          const output = out || err;
          return output
            ? { ok: true, output, outcome: TOOL_OUTCOMES.evidence }
            : { ok: true, output: "(no output)", outcome: TOOL_OUTCOMES.empty };
        }
        return { ok: false, output: out || "", error: err || `exit code ${exitCode}`, outcome: TOOL_OUTCOMES.error };
      } catch (err: any) {
        if (opts?.abortSignal?.aborted) {
          return { ok: false, output: "", error: "Command cancelled", outcome: TOOL_OUTCOMES.cancelled };
        }
        return { ok: false, output: "", error: `Command timed out after ${timeout}ms`, outcome: { ...TOOL_OUTCOMES.error, code: "timeout" } };
      }
    },
    permission: PermissionLevel.FULL,
    requiresApproval: true,
  };
}
