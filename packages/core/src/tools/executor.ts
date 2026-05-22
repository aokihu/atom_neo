import type { ToolDefinition, ToolResult } from "@atom-neo/shared";
import { PermissionLevel } from "@atom-neo/shared";

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
      error: error instanceof Error ? error.message : String(error),
      metadata: { durationMs: performance.now() - start },
    };
  }
}
