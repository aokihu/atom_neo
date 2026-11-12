import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const SOURCE_COMPONENTS = import.meta.dir.replace(`${sep}dist${sep}`, `${sep}src${sep}`);
const TUI_SRC = resolve(SOURCE_COMPONENTS, "..");
const TUI_KIT_SRC = resolve(TUI_SRC, "../../tui-kit/src");
const TUI_KIT_PACKAGE = resolve(TUI_SRC, "../../tui-kit/package.json");
const TUI_KIT = "@atom-neo/tui-kit";
const APP_ENTRY = resolve(TUI_SRC, "components/App");

const SOURCE_FILE = /\.(?:ts|tsx)$/;
const TEST_FILE = /\.(?:test|spec)\.(?:ts|tsx)$/;
const IMPORT_DECLARATION = /^[ \t]*(?:import|export)\s+(?:type\s+)?([^;]*?)\s*from\s*["']([^"']+)["']/gm;

const KNOWN_THEME_CONSUMERS = [
  "AssistantMessage",
  "BounceBarSpinner",
  "ChatView",
  "CommandMenu",
  "EmptyState",
  "InputBar",
  "MessageBubble",
  "PanelTitle",
  "RuntimeSidebar",
  "ScheduleBar",
  "SettingsModal",
  "Sidebar",
  "StatusBar",
  "StatusLine",
  "ThinkingSpinner",
  "ToolMessageBox",
  "UserMessage",
].map(name => `components/${name}.tsx`);

type SourceFile = { path: string; relativePath: string; source: string };
type ImportEntry = { file: SourceFile; clause: string; source: string };

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return SOURCE_FILE.test(entry.name) ? [path] : [];
  });
}

function readSources(root: string, includeTests = false): SourceFile[] {
  return walk(root)
    .filter(path => includeTests || !TEST_FILE.test(path))
    .map(path => ({
      path,
      relativePath: relative(root, path).split(sep).join("/"),
      source: readFileSync(path, "utf8"),
    }));
}

/** Remove comments so prose or examples cannot create false positives. */
function codeOf(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function importsOf(file: SourceFile): ImportEntry[] {
  return [...codeOf(file.source).matchAll(IMPORT_DECLARATION)]
    .map(match => ({ file, clause: match[1] ?? "", source: match[2] ?? "" }));
}

function mentions(symbol: string, clause: string): boolean {
  return new RegExp(`\\b${symbol}\\b`).test(clause);
}

function relativeTarget(file: SourceFile, source: string): string | undefined {
  if (!source.startsWith(".")) return undefined;
  return resolve(dirname(file.path), source).replace(SOURCE_FILE, "");
}

function importsApp(file: SourceFile, source: string): boolean {
  const target = relativeTarget(file, source);
  return target === APP_ENTRY || target === join(APP_ENTRY, "index");
}

const tuiFiles = readSources(TUI_SRC);
const tuiKitFiles = readSources(TUI_KIT_SRC, true);

describe("TUI theme import graph", () => {
  test("non-test TUI files never import theme APIs from App", () => {
    const violations = tuiFiles.flatMap(file => importsOf(file)
      .filter(entry => importsApp(file, entry.source)
        && ["useTheme", "ThemeContext", "ThemeProvider"].some(symbol => mentions(symbol, entry.clause)))
      .map(entry => `${file.relativePath}: ${entry.clause.trim()} from "${entry.source}"`));

    expect(violations).toEqual([]);
  });

  test("useTheme is imported only from @atom-neo/tui-kit", () => {
    const violations = tuiFiles.flatMap(file => importsOf(file)
      .filter(entry => mentions("useTheme", entry.clause) && entry.source !== TUI_KIT)
      .map(entry => `${file.relativePath}: "${entry.source}"`));

    expect(violations).toEqual([]);
  });

  test("every useTheme call resolves to @atom-neo/tui-kit", () => {
    const violations = tuiFiles
      .filter(file => /\buseTheme\s*\(/.test(codeOf(file.source)))
      .filter(file => !importsOf(file).some(entry =>
        entry.source === TUI_KIT && mentions("useTheme", entry.clause)))
      .map(file => file.relativePath);

    expect(violations).toEqual([]);
  });

  test("known current components resolve useTheme from @atom-neo/tui-kit", () => {
    const byPath = new Map(tuiFiles.map(file => [file.relativePath, file]));
    const missing = KNOWN_THEME_CONSUMERS.filter(path => {
      const file = byPath.get(path);
      if (!file) return true;
      const imports = importsOf(file);
      return !imports.some(entry => entry.source === TUI_KIT && mentions("useTheme", entry.clause))
        || !/\buseTheme\s*\(/.test(codeOf(file.source));
    });

    expect(missing).toEqual([]);
  });

  test("App consumes ThemeProvider and getTheme from @atom-neo/tui-kit", () => {
    const app = tuiFiles.find(file => file.relativePath === "components/App.tsx");
    expect(app).toBeDefined();

    const imports = importsOf(app!);
    expect(imports.some(entry => entry.source === TUI_KIT && mentions("ThemeProvider", entry.clause))).toBe(true);
    expect(imports.some(entry => entry.source === TUI_KIT && mentions("getTheme", entry.clause))).toBe(true);
  });

  test("ThemeContext is defined only inside tui-kit", () => {
    const references = tuiFiles
      .filter(file => /\bThemeContext\b/.test(codeOf(file.source)))
      .map(file => file.relativePath);
    expect(references).toEqual([]);

    const theme = tuiKitFiles.find(file => file.relativePath === "theme.tsx");
    expect(theme).toBeDefined();
    expect(codeOf(theme!.source)).toMatch(/\bconst\s+ThemeContext\s*=\s*createContext\b/);
  });

  test("tui-kit does not depend on tui", () => {
    const packageJson = JSON.parse(readFileSync(TUI_KIT_PACKAGE, "utf8")) as Record<string, Record<string, string> | undefined>;
    const dependencyFields = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
    const packageViolations = dependencyFields.filter(field =>
      packageJson[field]?.["@atom-neo/tui"] !== undefined);
    expect(packageViolations).toEqual([]);

    const importViolations = tuiKitFiles.flatMap(file => importsOf(file)
      .filter(entry => entry.source === "@atom-neo/tui" || entry.source.startsWith("@atom-neo/tui/")
        || relativeTarget(file, entry.source) === TUI_SRC
        || relativeTarget(file, entry.source)?.startsWith(`${TUI_SRC}${sep}`))
      .map(entry => `${file.relativePath}: "${entry.source}"`));
    expect(importViolations).toEqual([]);
  });
});
