import type { ToolContextInjection, ToolEffect, ToolResult } from "@atom-neo/shared";

function success(
  effect: ToolEffect,
  content?: unknown,
  contextInjection?: ToolContextInjection,
): ToolResult {
  return {
    ...(content === undefined ? {} : { content }),
    metadata: {
      ok: true,
      effect,
      ...(contextInjection ? { contextInjection } : {}),
    },
  };
}

export const toolResult = {
  evidence: (content: unknown) => success("evidence", content),
  reference: (content: unknown, contextInjection?: ToolContextInjection) =>
    success("reference", content, contextInjection),
  stateChanged: (content?: unknown) => success("state_changed", content),
  none: () => success("none"),
  failure: (error: string): ToolResult => ({
    metadata: { ok: false, effect: "none", error },
  }),
};
