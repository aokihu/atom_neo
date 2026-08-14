import type { ToolDefinition, ToolResult } from "@atom-neo/shared";
import { PermissionLevel, errorMessage } from "@atom-neo/shared";
import { toolResult } from "./outcome";

export async function executeTool(
  tool: ToolDefinition,
  args: unknown,
  level: PermissionLevel,
): Promise<ToolResult> {
  const required = tool.permission ?? PermissionLevel.READ_ONLY;
  if (level < required) {
    return toolResult.failure(`Permission denied: ${tool.name} requires level ${required}`, "guard");
  }

  try {
    return await tool.execute(args);
  } catch (error) {
    return toolResult.failure(errorMessage(error));
  }
}
