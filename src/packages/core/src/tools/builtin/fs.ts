import { z } from "zod";
import type { ToolDefinition } from "@atom-neo/shared";
import { PermissionLevel } from "@atom-neo/shared";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { readdir, stat, cp, rename } from "node:fs/promises";
import { resolve, dirname, relative } from "node:path";

let sandboxRoot = process.cwd();

export function setSandbox(path: string): void {
  sandboxRoot = resolve(path);
  if (!existsSync(sandboxRoot)) mkdirSync(sandboxRoot, { recursive: true });
}

function sandboxPath(filepath: string): string {
  const resolved = resolve(sandboxRoot, filepath);
  if (!resolved.startsWith(sandboxRoot)) {
    throw new Error(`Path "${filepath}" escapes sandbox`);
  }
  return resolved;
}

function parse<T>(schema: z.ZodType<T>, args: unknown): T | null {
  const r = schema.safeParse(args);
  return r.success ? r.data : null;
}

const readSchema = z.object({
  filepath: z.string().describe("Path to the file"),
  offset: z.number().optional().describe("Line number to start from"),
  limit: z.number().optional().describe("Max lines to read"),
});

export const readTool: ToolDefinition = {
  name: "read",
  description: "Read file contents. Provide the file path.",
  source: "builtin",
  inputSchema: readSchema,
  execute: async (args) => {
    const p = parse(readSchema, args);
    if (!p) return { ok: false, output: "", error: "Invalid input" };
    try {
      const content = readFileSync(sandboxPath(p.filepath), "utf-8");
      const lines = content.split("\n");
      const start = Math.max(0, (p.offset ?? 1) - 1);
      const end = p.limit ? start + p.limit : undefined;
      const result = lines.slice(start, end).join("\n");
      return { ok: true, output: result || "(empty)", data: { lineCount: lines.length } };
    } catch (err) {
      return { ok: false, output: "", error: String(err) };
    }
  },
  permission: PermissionLevel.READ_ONLY,
};

const writeSchema = z.object({
  filepath: z.string().describe("Path to the file"),
  content: z.string().describe("Content to write"),
});

export const writeTool: ToolDefinition = {
  name: "write",
  description: "Write content to a file. Creates the file if it does not exist.",
  source: "builtin",
  inputSchema: writeSchema,
  execute: async (args) => {
    const p = parse(writeSchema, args);
    if (!p) return { ok: false, output: "", error: "Invalid input" };
    try {
      const resolved = sandboxPath(p.filepath);
      const dir = dirname(resolved);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(resolved, p.content, "utf-8");
      return { ok: true, output: `Wrote ${p.content.length} bytes to ${p.filepath}` };
    } catch (err) {
      return { ok: false, output: "", error: String(err) };
    }
  },
  permission: PermissionLevel.FILE_WRITE,
};

const lsSchema = z.object({
  path: z.string().default(".").describe("Directory path"),
});

export const lsTool: ToolDefinition = {
  name: "ls",
  description: "List directory contents.",
  source: "builtin",
  inputSchema: lsSchema,
  execute: async (args) => {
    const p = parse(lsSchema, args);
    if (!p) return { ok: false, output: "", error: "Invalid input" };
    try {
      const entries = await readdir(sandboxPath(p.path), { withFileTypes: true });
      const result = entries
        .map((e) => `${e.isDirectory() ? "d" : "-"} ${e.name}`)
        .join("\n");
      return { ok: true, output: result || "(empty)", data: { count: entries.length } };
    } catch (err) {
      return { ok: false, output: "", error: String(err) };
    }
  },
  permission: PermissionLevel.READ_ONLY,
};

const treeSchema = z.object({
  path: z.string().default(".").describe("Root directory path"),
  maxDepth: z.number().optional().default(3).describe("Max recursion depth"),
});

export const treeTool: ToolDefinition = {
  name: "tree",
  description: "Recursively list directory tree.",
  source: "builtin",
  inputSchema: treeSchema,
  execute: async (args) => {
    const p = parse(treeSchema, args);
    if (!p) return { ok: false, output: "", error: "Invalid input" };
    try {
      const lines: string[] = [];
      async function walk(dir: string, prefix: string, depth: number) {
        if (depth > p!.maxDepth) return;
        try {
          const entries = await readdir(dir, { withFileTypes: true });
          for (let i = 0; i < entries.length; i++) {
            const e = entries[i];
            const isLast = i === entries.length - 1;
            lines.push(`${prefix}${isLast ? "└──" : "├──"} ${e.name}`);
            if (e.isDirectory()) {
              await walk(resolve(dir, e.name), `${prefix}${isLast ? "    " : "│   "}`, depth + 1);
            }
          }
        } catch { /* skip */ }
      }
      await walk(sandboxPath(p.path), "", 0);
      return { ok: true, output: lines.join("\n") || p.path };
    } catch (err) {
      return { ok: false, output: "", error: String(err) };
    }
  },
  permission: PermissionLevel.READ_ONLY,
};

const grepSchema = z.object({
  pattern: z.string().describe("Regex pattern to search for"),
  path: z.string().default(".").describe("Directory or file to search in"),
  include: z.string().optional().describe("File glob pattern to filter"),
});

export const grepTool: ToolDefinition = {
  name: "grep",
  description: "Search file contents with regex pattern.",
  source: "builtin",
  inputSchema: grepSchema,
  execute: async (args) => {
    const p = parse(grepSchema, args);
    if (!p) return { ok: false, output: "", error: "Invalid input" };
    try {
      const target = sandboxPath(p.path);
      const results: string[] = [];
      const info = await stat(target);

      if (info.isFile()) {
        const content = readFileSync(target, "utf-8");
        const re = new RegExp(p.pattern, "g");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) {
            results.push(`${relative(process.cwd(), target)}:${i + 1}: ${lines[i].trim()}`);
            re.lastIndex = 0;
          }
        }
      } else {
        const entries = await readdir(target, { recursive: true, withFileTypes: true });
        for (const e of entries) {
          if (!e.isFile()) continue;
          if (p.include && !e.name.match(p.include)) continue;
          try {
            const content = readFileSync(resolve(target, e.name), "utf-8");
            const re = new RegExp(p.pattern, "g");
            const lines = content.split("\n");
            for (let i = 0; i < lines.length; i++) {
              if (re.test(lines[i])) {
                results.push(`${e.name}:${i + 1}: ${lines[i].trim()}`);
                re.lastIndex = 0;
              }
            }
          } catch { /* skip */ }
        }
      }

      return {
        ok: true,
        output: results.slice(0, 100).join("\n") || "No matches",
        data: { matchCount: results.length },
      };
    } catch (err) {
      return { ok: false, output: "", error: String(err) };
    }
  },
  permission: PermissionLevel.READ_ONLY,
};

const cpSchema = z.object({
  source: z.string().describe("Source path"),
  dest: z.string().describe("Destination path"),
});

export const cpTool: ToolDefinition = {
  name: "cp",
  description: "Copy a file or directory.",
  source: "builtin",
  inputSchema: cpSchema,
  execute: async (args) => {
    const p = parse(cpSchema, args);
    if (!p) return { ok: false, output: "", error: "Invalid input" };
    try {
      await cp(sandboxPath(p.source), sandboxPath(p.dest), { recursive: true });
      return { ok: true, output: `Copied ${p.source} → ${p.dest}` };
    } catch (err) {
      return { ok: false, output: "", error: String(err) };
    }
  },
  permission: PermissionLevel.FILE_WRITE,
};

const mvSchema = z.object({
  source: z.string().describe("Source path"),
  dest: z.string().describe("Destination path"),
});

export const mvTool: ToolDefinition = {
  name: "mv",
  description: "Move or rename a file or directory.",
  source: "builtin",
  inputSchema: mvSchema,
  execute: async (args) => {
    const p = parse(mvSchema, args);
    if (!p) return { ok: false, output: "", error: "Invalid input" };
    try {
      await rename(sandboxPath(p.source), sandboxPath(p.dest));
      return { ok: true, output: `Moved ${p.source} → ${p.dest}` };
    } catch (err) {
      return { ok: false, output: "", error: String(err) };
    }
  },
  permission: PermissionLevel.FILE_WRITE,
};
