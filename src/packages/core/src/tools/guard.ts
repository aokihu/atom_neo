import { resolve } from "node:path";
import { homedir } from "node:os";
import type { ToolDefinition, ToolResult } from "@atom-neo/shared";

function resolveAliases(input: string, sandbox: string): string {
  return input.replace(/\$HOME\b/g, homedir()).replace(/\$SANDBOX\b/g, sandbox);
}

function isInsideAtomDir(sandbox: string, filepath: string): boolean {
  const r = resolve(sandbox, resolveAliases(filepath, sandbox));
  const atomDir = resolve(sandbox, ".atom");
  return r === atomDir || r.startsWith(atomDir + "/");
}

function isInsideSandbox(sandbox: string, filepath: string): boolean {
  const root = resolve(sandbox);
  const r = resolve(sandbox, resolveAliases(filepath, sandbox));
  return r === root || r.startsWith(root + "/");
}

function isWhitelisted(sandbox: string, filepath: string, wl: string[]): boolean {
  const r = resolve(sandbox, resolveAliases(filepath, sandbox));
  return wl.some(w => r === w || r.startsWith(w + "/"));
}

function extractArg(args: unknown, key: string): string | undefined {
  if (args && typeof args === "object" && key in args) {
    const v = (args as Record<string, unknown>)[key];
    return typeof v === "string" ? v : undefined;
  }
}

const PATH_ARGS: Record<string, string[]> = {
  read: ["filepath"],
  write: ["filepath"],
  ls: ["path"],
  tree: ["path"],
  grep: ["path"],
  cp: ["source", "dest"],
  mv: ["source", "dest"],
};

const LIST_TOOLS = new Set(["ls", "tree"]);

function preCheck(
  tool: ToolDefinition,
  args: unknown,
  sandbox: string,
  resolvedWl: string[],
): ToolResult | null {
  for (const key of (PATH_ARGS[tool.name] ?? [])) {
    const p = extractArg(args, key);
    if (!p) continue;
    if (isInsideAtomDir(sandbox, p)) {
      return {
        ok: false, output: "",
        error: LIST_TOOLS.has(tool.name) ? "Directory not found" : "File not found",
      };
    }
    if (!isInsideSandbox(sandbox, p) && !isWhitelisted(sandbox, p, resolvedWl)) {
      return { ok: false, output: "", error: "Path is outside sandbox" };
    }
  }

  if (tool.name === "bash") {
    const cmd = extractArg(args, "command");
    if (cmd && cmd.includes(".atom")) {
      return { ok: false, output: "", error: "Command not allowed" };
    }
  }

  return null;
}

function postFilter(tool: ToolDefinition, result: ToolResult): ToolResult {
  if (!result.ok || !LIST_TOOLS.has(tool.name)) return result;
  if (typeof result.output !== "string") return result;
  const filtered = result.output
    .split("\n")
    .filter(l =>
      !l.endsWith(" .atom") &&
      !l.includes("── .atom") &&
      !l.includes("├── .atom") &&
      !l.includes("└── .atom"),
    )
    .join("\n");
  return { ...result, output: filtered || "(empty)" };
}

export function createToolGuard(
  tool: ToolDefinition,
  sandbox: string,
  whitelist: string[],
): ToolDefinition {
  const resolvedWl = whitelist.map(w => resolve(sandbox, resolveAliases(w, sandbox)));

  return new Proxy(tool, {
    get(target, prop) {
      if (prop !== "execute") return Reflect.get(target, prop);
      return async (args: unknown) => {
        const blocked = preCheck(target, args, sandbox, resolvedWl);
        if (blocked) return blocked;
        const result = await target.execute(args);
        return postFilter(target, result);
      };
    },
  });
}
