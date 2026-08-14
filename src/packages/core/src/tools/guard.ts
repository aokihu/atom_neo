import { resolve } from "node:path";
import { homedir } from "node:os";
import type { ToolDefinition, ToolResult, ToolExecuteOptions } from "@atom-neo/shared";
import { toolResult } from "./outcome";

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
  edit: ["filepath"],
  ls: ["path"],
  tree: ["path"],
  glob: ["path"],
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
      return toolResult.failure(LIST_TOOLS.has(tool.name) ? "Directory not found" : "File not found", "guard");
    }
    if (!isInsideSandbox(sandbox, p) && !isWhitelisted(sandbox, p, resolvedWl)) {
      return toolResult.failure("Path is outside sandbox", "guard");
    }
  }

  if (tool.name === "bash") {
    const cmd = extractArg(args, "command");
    if (cmd && cmd.includes(".atom")) {
      return toolResult.failure("Command not allowed", "guard");
    }
  }

  return null;
}

function postFilter(tool: ToolDefinition, result: ToolResult): ToolResult {
  if (!result.metadata.ok || !LIST_TOOLS.has(tool.name)) return result;
  if (typeof result.content !== "string") return result;
  const filtered = result.content
    .split("\n")
    .filter(l =>
      !l.endsWith(" .atom") &&
      !l.includes("── .atom") &&
      !l.includes("├── .atom") &&
      !l.includes("└── .atom"),
    )
    .join("\n");
  return filtered
    ? { ...result, content: filtered }
    : toolResult.none();
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
      return async (args: unknown, opts?: ToolExecuteOptions) => {
        const blocked = preCheck(target, args, sandbox, resolvedWl);
        if (blocked) return blocked;
        const result = await target.execute(args, opts);
        return postFilter(target, result);
      };
    },
  });
}
