/**
 * Documentation integrity check.
 *
 * - Walks docs/**\/*.md and verifies relative Markdown link targets exist.
 * - Verifies inline `src/...` paths exist.
 * - docs/index.md is part of the walk (and is checked first).
 *
 * Uses only Node standard APIs; runs under Bun and Node >= 24.
 * Exit code 1 when any problem is found.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Problem = {
  file: string;
  line: number;
  message: string;
};

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS_DIR = join(ROOT, "docs");
const INDEX_FILE = join(DOCS_DIR, "index.md");
const problems: Problem[] = [];

function markdownFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...markdownFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(full);
  }
  return files.sort((a, b) => (a === INDEX_FILE ? -1 : b === INDEX_FILE ? 1 : a.localeCompare(b)));
}

function fail(file: string, line: number, message: string): void {
  problems.push({ file: relative(ROOT, file), line, message });
}

function isExternal(target: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i.test(target);
}

function checkLink(file: string, line: number, rawHref: string): void {
  let href = rawHref.trim();
  if (!href) return;

  if (href.startsWith("<")) {
    const end = href.indexOf(">");
    if (end < 0) return;
    href = href.slice(1, end);
  } else {
    href = href.split(/\s+/)[0];
  }

  if (!href || isExternal(href)) return;

  const targetPart = href.split("#")[0].split("?")[0];
  if (!targetPart || targetPart.includes("{") || targetPart.includes("*")) return;

  let decoded: string;
  try {
    decoded = decodeURIComponent(targetPart);
  } catch {
    fail(file, line, `invalid URL encoding in link: ${href}`);
    return;
  }

  const target = resolve(dirname(file), decoded);
  if (!existsSync(target)) {
    fail(file, line, `missing link target: ${href}`);
  }
}

function checkSourcePath(file: string, line: number, rawPath: string): void {
  let candidate = rawPath.trim();
  candidate = candidate.replace(/:\d+(?:-\d+)?(?:,\s*\d+(?:-\d+)?)*$/, "");
  candidate = candidate.replace(/[#?].*$/, "");
  candidate = candidate.replace(/[),.;]+$/, "");

  if (!candidate.startsWith("src/") || candidate === "src/") return;
  if (/[*{}<>\s|]/.test(candidate) || candidate.includes("...")) return;

  const target = resolve(ROOT, candidate);
  try {
    if (!existsSync(target) || (!statSync(target).isFile() && !statSync(target).isDirectory())) {
      fail(file, line, `missing source path: ${rawPath.trim()}`);
    }
  } catch {
    fail(file, line, `missing source path: ${rawPath.trim()}`);
  }
}

if (!existsSync(INDEX_FILE)) {
  fail(INDEX_FILE, 1, "docs/index.md does not exist");
} else if (!statSync(INDEX_FILE).isFile()) {
  fail(INDEX_FILE, 1, "docs/index.md is not a file");
}

if (existsSync(DOCS_DIR)) {
  for (const file of markdownFiles(DOCS_DIR)) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    let fence: string | null = null;

    lines.forEach((line, index) => {
      const lineNumber = index + 1;

      const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
      if (fenceMatch) {
        const marker = fenceMatch[1][0];
        if (!fence) fence = marker;
        else if (fence === marker) fence = null;
        return;
      }
      if (fence) return;

      const linkPattern = /!?\[[^\]]*\]\(([^)]+)\)/g;
      let linkMatch: RegExpExecArray | null;
      while ((linkMatch = linkPattern.exec(line)) !== null) {
        checkLink(file, lineNumber, linkMatch[1]);
      }

      const codePattern = /`([^`\n]+)`/g;
      let codeMatch: RegExpExecArray | null;
      while ((codeMatch = codePattern.exec(line)) !== null) {
        checkSourcePath(file, lineNumber, codeMatch[1]);
      }
    });
  }
}

if (problems.length > 0) {
  for (const problem of problems) {
    console.error(`${problem.file}:${problem.line}  ${problem.message}`);
  }
  console.error(`\nDocs check failed: ${problems.length} broken reference(s).`);
  process.exitCode = 1;
} else {
  console.log("Docs check passed: all relative links and inline src/ paths resolve.");
}
