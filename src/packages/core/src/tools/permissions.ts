import { PermissionLevel } from "@atom-neo/shared";
import type { ToolDefinition } from "@atom-neo/shared";

export function filterToolsByPermission(
  tools: ToolDefinition[],
  level: PermissionLevel,
): ToolDefinition[] {
  return tools.filter((tool) => {
    const required = tool.permission ?? PermissionLevel.READ_ONLY;
    return level >= required;
  });
}
