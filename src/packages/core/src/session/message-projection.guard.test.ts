/**
 * S12-E17 static guard: one tool-output stringifier, one pure user-message append,
 * one reasoning projection. Scans production sources only (tests/dist excluded).
 *
 * S12-E18 residual line counts (2026-11-12, after S12-E):
 * - message-projection.ts 51, collect-prompts.ts 49, record-context.ts 186,
 *   format-user-messages.ts 26, types.ts 62, tool-loop.ts 119,
 *   stream/tool-runtime.ts 195, message-policy.ts 23.
 * - Core files above 300 lines: none; session/context.ts is now 284 lines with
 *   pure TODO helpers extracted to session/todo.ts (29 lines).
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const SOURCE_DIR = import.meta.dir.replace(`${sep}dist${sep}`, `${sep}src${sep}`);
const SOURCE_ROOT = resolve(SOURCE_DIR, "..");
const ELEMENTS = "pipelines/conversation/elements";

const SOURCE_FILE = /\.(?:ts|tsx)$/;
const TEST_FILE = /\.(?:test|spec)\.(?:ts|tsx)$/;
const DECLARATION_FILE = /\.d\.ts$/;
const SKIP_DIRS = new Set(["dist", "node_modules"]);

function codeOf(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (SKIP_DIRS.has(entry.name)) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name) && !DECLARATION_FILE.test(entry.name)
      ? [path]
      : [];
  });
}

function productionSources(): { path: string; relativePath: string; code: string }[] {
  return walk(SOURCE_ROOT).map(path => ({
    path,
    relativePath: relative(SOURCE_ROOT, path).split(sep).join("/"),
    code: codeOf(readFileSync(path, "utf8")),
  }));
}

function sourcesDeclaring(sources: ReturnType<typeof productionSources>, pattern: RegExp): string[] {
  return sources.filter(source => pattern.test(source.code)).map(source => source.relativePath);
}

function sourceAt(relativePath: string): { relativePath: string; code: string } {
  const source = productionSources().find(item => item.relativePath === relativePath);
  if (!source) throw new Error(`missing production source: ${relativePath}`);
  return source;
}

describe("S12 message projection / tool output guards", () => {
  test("stringifyToolOutput is defined only in tool-loop", () => {
    expect(sourcesDeclaring(
      productionSources(),
      /\b(?:function|const)\s+stringifyToolOutput\b/,
    )).toEqual([`${ELEMENTS}/tool-loop.ts`]);
  });

  test("stream tool runtimes import the shared stringifyToolOutput", () => {
    const importPattern = /import\s*\{[^}]*\bstringifyToolOutput\b[^}]*\}\s*from\s*["']\.\.\/tool-loop["']/;
    for (const name of ["tool-runtime.ts", "tool-runtime-mcp.ts"]) {
      expect(sourceAt(`${ELEMENTS}/stream/${name}`).code).toMatch(importPattern);
    }
  });

  test("appendCurrentUserMessage is defined once and never mutates its input", () => {
    const path = "session/message-projection.ts";
    expect(sourcesDeclaring(
      productionSources(),
      /\b(?:function|const)\s+appendCurrentUserMessage\b/,
    )).toEqual([path]);
    expect(sourceAt(path).code).not.toMatch(/\.push\s*\(/);
  });

  test("projectPipelineMessage is defined once and used by prompt projection call sites", () => {
    const path = "session/message-projection.ts";
    expect(sourcesDeclaring(
      productionSources(),
      /\b(?:function|const)\s+projectPipelineMessage\b/,
    )).toEqual([path]);
    for (const name of ["collect-prompts.ts", "record-context.ts"]) {
      expect(sourceAt(`${ELEMENTS}/${name}`).code).toMatch(/\bprojectPipelineMessage\b/);
    }
  });
});
