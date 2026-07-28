import type { ToolDefinition, ToolResult } from "@atom-neo/shared";
import { PermissionLevel, errorMessage } from "@atom-neo/shared";
import { TOOL_OUTCOMES } from "./outcome";

export async function executeTool(
  tool: ToolDefinition,
  args: unknown,
  level: PermissionLevel,
): Promise<ToolResult> {
  const required = tool.permission ?? PermissionLevel.READ_ONLY;
  if (level < required) {
    return {
      ok: false,
      output: "",
      error: `Permission denied: ${tool.name} requires level ${required}`,
      outcome: { status: "blocked", progress: "none", code: "permission_denied" },
    };
  }

  const start = performance.now();

  try {
    const result = await tool.execute(args);
    return {
      ...result,
      metadata: {
        ...result.metadata,
        durationMs: performance.now() - start,
      },
    };
  } catch (error) {
    return {
      ok: false,
      output: "",
      error: errorMessage(error),
      outcome: TOOL_OUTCOMES.error,
      metadata: { durationMs: performance.now() - start },
    };
  }
}
