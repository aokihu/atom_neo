import { z } from "zod";
import type { ToolDefinition } from "@atom-neo/shared";
import { PermissionLevel } from "@atom-neo/shared";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { readdir, stat, cp, rename } from "node:fs/promises";
import { resolve, dirname, relative } from "node:path";

function createSandbox(sandbox: string) {
  const root = resolve(sandbox);
  if (!existsSync(root)) mkdirSync(root, { recursive: true });

  function sp(filepath: string): string {
    return resolve(root, filepath);
  }

  return { root, sp };
}

export type Sandbox = ReturnType<typeof createSandbox>;
export { createSandbox };

function parse<T>(schema: z.ZodType<T>, args: unknown): T | null {
  const r = schema.safeParse(args);
  return r.success ? r.data : null;
}

export function createReadTool(sb: Sandbox): ToolDefinition {
  const schema = z.object({
    filepath: z.string(),
    offset: z.number().optional(),
    limit: z.number().optional(),
  });
  return {
    name: "read", description: "Read file contents.",
    source: "builtin", inputSchema: schema,
    execute: async (args) => {
      const p = parse(schema, args);
      if (!p) return { ok: false, output: "", error: "Invalid input" };
      try {
        const content = readFileSync(sb.sp(p.filepath), "utf-8");
        const lines = content.split("\n");
        const start = Math.max(0, (p.offset ?? 1) - 1);
        const end = p.limit ? start + p.limit : undefined;
        return { ok: true, output: lines.slice(start, end).join("\n") || "(empty)" };
      } catch (err) { return { ok: false, output: "", error: String(err) }; }
    },
    permission: PermissionLevel.READ_ONLY,
  };
}

export function createWriteTool(sb: Sandbox): ToolDefinition {
  const schema = z.object({ filepath: z.string(), content: z.string() });
  return {
    name: "write", description: "Write content to a file.",
    source: "builtin", inputSchema: schema,
    execute: async (args) => {
      const p = parse(schema, args);
      if (!p) return { ok: false, output: "", error: "Invalid input" };
      try {
        const resolved = sb.sp(p.filepath);
        if (!existsSync(dirname(resolved))) mkdirSync(dirname(resolved), { recursive: true });
        writeFileSync(resolved, p.content, "utf-8");
        return { ok: true, output: `Wrote ${p.content.length} bytes to ${p.filepath}` };
      } catch (err) { return { ok: false, output: "", error: String(err) }; }
    },
    permission: PermissionLevel.FILE_WRITE,
  };
}

export function createLsTool(sb: Sandbox): ToolDefinition {
  const schema = z.object({ path: z.string().default(".") });
  return {
    name: "ls", description: "List directory contents.",
    source: "builtin", inputSchema: schema,
    execute: async (args) => {
      const p = parse(schema, args);
      if (!p) return { ok: false, output: "", error: "Invalid input" };
      try {
        const entries = await readdir(sb.sp(p.path), { withFileTypes: true });
        const result = entries.map(e => `${e.isDirectory() ? "d" : "-"} ${e.name}`).join("\n");
        return { ok: true, output: result || "(empty)", data: { count: entries.length } };
      } catch (err) { return { ok: false, output: "", error: String(err) }; }
    },
    permission: PermissionLevel.READ_ONLY,
  };
}

export function createTreeTool(sb: Sandbox): ToolDefinition {
  const schema = z.object({ path: z.string().default("."), maxDepth: z.number().optional().default(3) });
  return {
    name: "tree", description: "Recursively list directory tree.",
    source: "builtin", inputSchema: schema,
    execute: async (args) => {
      const p = parse(schema, args);
      if (!p) return { ok: false, output: "", error: "Invalid input" };
      try {
        const lines: string[] = [];
        async function walk(dir: string, prefix: string, depth: number) {
          if (depth > p!.maxDepth) return;
          try {
            const entries = await readdir(dir, { withFileTypes: true });
            for (let i = 0; i < entries.length; i++) {
              const e = entries[i], isLast = i === entries.length - 1;
              lines.push(`${prefix}${isLast ? "└──" : "├──"} ${e.name}`);
              if (e.isDirectory()) await walk(resolve(dir, e.name), `${prefix}${isLast ? "    " : "│   "}`, depth + 1);
            }
          } catch { /* skip */ }
        }
        await walk(sb.sp(p.path), "", 0);
        return { ok: true, output: lines.join("\n") || p.path };
      } catch (err) { return { ok: false, output: "", error: String(err) }; }
    },
    permission: PermissionLevel.READ_ONLY,
  };
}

export function createGrepTool(sb: Sandbox): ToolDefinition {
  const schema = z.object({ pattern: z.string(), path: z.string().default("."), include: z.string().optional() });
  return {
    name: "grep", description: "Search file contents with regex pattern.",
    source: "builtin", inputSchema: schema,
    execute: async (args) => {
      const p = parse(schema, args);
      if (!p) return { ok: false, output: "", error: "Invalid input" };
      try {
        const target = sb.sp(p.path);
        const results: string[] = [];
        const info = await stat(target);
        if (info.isFile()) {
          const content = readFileSync(target, "utf-8");
          const re = new RegExp(p.pattern, "g");
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (re.test(lines[i])) { results.push(`${relative(sb.root, target)}:${i + 1}: ${lines[i].trim()}`); re.lastIndex = 0; }
          }
        } else {
          const entries = await readdir(target, { recursive: true, withFileTypes: true });
          for (const e of entries) {
            if (!e.isFile() || (p.include && !e.name.match(p.include))) continue;
            try {
              const content = readFileSync(resolve(target, e.name), "utf-8");
              const re = new RegExp(p.pattern, "g");
              const lines = content.split("\n");
              for (let i = 0; i < lines.length; i++) {
                if (re.test(lines[i])) { results.push(`${e.name}:${i + 1}: ${lines[i].trim()}`); re.lastIndex = 0; }
              }
            } catch { /* skip */ }
          }
        }
        return { ok: true, output: results.slice(0, 100).join("\n") || "No matches", data: { matchCount: results.length } };
      } catch (err) { return { ok: false, output: "", error: String(err) }; }
    },
    permission: PermissionLevel.READ_ONLY,
  };
}

export function createCpTool(sb: Sandbox): ToolDefinition {
  const schema = z.object({ source: z.string(), dest: z.string() });
  return {
    name: "cp", description: "Copy a file or directory.",
    source: "builtin", inputSchema: schema,
    execute: async (args) => {
      const p = parse(schema, args);
      if (!p) return { ok: false, output: "", error: "Invalid input" };
      try {
        await cp(sb.sp(p.source), sb.sp(p.dest), { recursive: true });
        return { ok: true, output: `Copied ${p.source} → ${p.dest}` };
      } catch (err) { return { ok: false, output: "", error: String(err) }; }
    },
    permission: PermissionLevel.FILE_WRITE,
  };
}

export function createMvTool(sb: Sandbox): ToolDefinition {
  const schema = z.object({ source: z.string(), dest: z.string() });
  return {
    name: "mv", description: "Move or rename a file or directory.",
    source: "builtin", inputSchema: schema,
    execute: async (args) => {
      const p = parse(schema, args);
      if (!p) return { ok: false, output: "", error: "Invalid input" };
      try {
        await rename(sb.sp(p.source), sb.sp(p.dest));
        return { ok: true, output: `Moved ${p.source} → ${p.dest}` };
      } catch (err) { return { ok: false, output: "", error: String(err) }; }
    },
    permission: PermissionLevel.FILE_WRITE,
  };
}
