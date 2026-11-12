/**
 * S11 global-state guard.
 * Static scan of production sources for the module-level symbols removed by S11.
 * Tests and build output are excluded; comments are stripped before matching.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const SOURCE_DIR = import.meta.dir.replace(`${sep}dist${sep}`, `${sep}src${sep}`);
const SOURCE_ROOT = resolve(SOURCE_DIR, "../../..");
const TUI_SRC = join(SOURCE_ROOT, "packages/tui/src");
const TUI_KIT_THEME = join(SOURCE_ROOT, "packages/tui-kit/src/theme.tsx");
const TUI_KIT = "@atom-neo/tui-kit";
const APP_ENTRY = join(TUI_SRC, "components/App");

const SOURCE_FILE = /\.(?:ts|tsx)$/;
const TEST_FILE = /\.(?:test|spec)\.(?:ts|tsx)$/;
const DECLARATION_FILE = /\.d\.ts$/;
const SKIP_DIRS = new Set(["dist", "node_modules"]);
const IMPORT_DECLARATION = /^[ \t]*(?:import|export)\s+(?:type\s+)?([^;]*?)\s*from\s*["']([^"']+)["']/gm;

type Rule = { name: string; pattern: RegExp };

const FORBIDDEN_GLOBALS: Rule[] = [
  { name: "pipelineMap", pattern: /\bpipelineMap\b/ },
  { name: "clearRegistry", pattern: /\bclearRegistry\b/ },
  { name: "getRegistry(", pattern: /\bgetRegistry\s*\(/ },
  { name: "initPromptRegistry(", pattern: /\binitPromptRegistry\s*\(/ },
  { name: "free resolvePrompt(", pattern: /(^|[^.\w])resolvePrompt\s*\(/ },
  { name: "let _instance", pattern: /\blet\s+_instance\b/ },
  { name: "module-level const registry = new Map", pattern: /^\s*const\s+registry\s*=\s*new\s+Map\b/ },
  { name: "sm.get(", pattern: /\bsm\s*\.\s*get\s*\(/ },
];

/** Remove comments so prose or examples cannot create false positives. */
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

function productionSources(root: string): string[] {
  return walk(root).filter(path => !path.split(sep).includes("dist"));
}

function scanGlobals(files: string[]): string[] {
  const violations: string[] = [];
  for (const path of files) {
    const code = codeOf(readFileSync(path, "utf8"));
    const lines = code.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      for (const rule of FORBIDDEN_GLOBALS) {
        if (rule.pattern.test(line)) violations.push(`${relative(SOURCE_ROOT, path)}:${index + 1}: ${rule.name}`);
      }
    }
  }
  return violations;
}

function importsOf(path: string): { clause: string; source: string }[] {
  const code = codeOf(readFileSync(path, "utf8"));
  return [...code.matchAll(IMPORT_DECLARATION)].map(match => ({
    clause: match[1] ?? "",
    source: match[2] ?? "",
  }));
}

function mentions(symbol: string, clause: string): boolean {
  return new RegExp(`\\b${symbol}\\b`).test(clause);
}

function isAppSource(path: string, source: string): boolean {
  if (!source.startsWith(".")) return false;
  const target = resolve(dirname(path), source).replace(SOURCE_FILE, "");
  return target === APP_ENTRY || target === join(APP_ENTRY, "index");
}

describe("S11 global-state guard", () => {
  test("production sources contain no removed module-level state", () => {
    const files = productionSources(SOURCE_ROOT);
    expect(files.length).toBeGreaterThan(0);
    expect(scanGlobals(files)).toEqual([]);
  });

  test("non-test TUI files never import theme APIs from App", () => {
    const violations = productionSources(TUI_SRC).flatMap(path => importsOf(path)
      .filter(entry => isAppSource(path, entry.source)
        && ["useTheme", "ThemeContext", "ThemeProvider"].some(symbol => mentions(symbol, entry.clause)))
      .map(entry => `${relative(TUI_SRC, path)}: ${entry.clause.trim()} from "${entry.source}"`));
    expect(violations).toEqual([]);
  });

  test("useTheme is imported only from @atom-neo/tui-kit", () => {
    const violations = productionSources(TUI_SRC).flatMap(path => importsOf(path)
      .filter(entry => mentions("useTheme", entry.clause) && entry.source !== TUI_KIT)
      .map(entry => `${relative(TUI_SRC, path)}: "${entry.source}"`));
    expect(violations).toEqual([]);
  });

  test("ThemeContext stays inside tui-kit", () => {
    const tuiReferences = productionSources(TUI_SRC)
      .filter(path => /\bThemeContext\b/.test(codeOf(readFileSync(path, "utf8"))))
      .map(path => relative(TUI_SRC, path));
    expect(tuiReferences).toEqual([]);
    expect(codeOf(readFileSync(TUI_KIT_THEME, "utf8")))
      .toMatch(/\bconst\s+ThemeContext\s*=\s*createContext\b/);
  });
});
