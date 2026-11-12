import type { ToolCallLedger } from "../../../../tools/governance";
import { stringifyToolOutput } from "../tool-loop";
import { executeGovernedTool } from "./tool-runtime";
import { resolveMCPToolMetadata } from "./tool-result-status";
import type { ToolStatusCollector } from "./tool-result-status";
import type { StreamReporter } from "./types";

export function wrapMCPAiTools(
  mcpTools: Record<string, any>,
  report: StreamReporter,
  stepCounter: { count: number },
  statuses: ToolStatusCollector,
  governance: { current: ToolCallLedger },
): Record<string, any> {
  const wrapped: Record<string, any> = {};
  for (const [name, t] of Object.entries(mcpTools)) {
    const origExecute = (t as any).execute;
    if (typeof origExecute !== "function") {
      wrapped[name] = t;
      continue;
    }
    wrapped[name] = {
      ...t as any,
      execute: async (args: any, opts?: any) => executeGovernedTool({
        toolName: name,
        args,
        source: "mcp",
        errorPrefix: "MCP tool error: ",
        invoke: () => origExecute(args, opts),
        normalize: result => {
          const metadata = resolveMCPToolMetadata(result);
          return {
            content: stringifyToolOutput(result),
            rawOutput: result,
            metadata,
            returnValue: result,
          };
        },
        report,
        stepCounter,
        statuses,
        governance,
      }),
    };
  }
  return wrapped;
}
