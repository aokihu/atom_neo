import { z } from "zod";
import { PermissionLevel } from "@atom-neo/shared";
import type { ToolDefinition } from "@atom-neo/shared";
import { toolResult } from "../outcome";
import { parseToolRecordId } from "../tool-record-store";
import type { ToolRecordStore } from "../tool-record-store";

const recordInput = z.object({
  recordId: z.string().refine(value => Boolean(parseToolRecordId(value)), {
    message: "recordId must use {ToolsGroupID}-{Step} format",
  }),
});

const toolsGroupId = z.string().refine(value => parseToolRecordId(`${value}-1`)?.toolsGroupId === value, {
  message: "Invalid ToolsGroupID",
});

const recordsInput = z.object({
  toolsGroupId: toolsGroupId.optional(),
  recordIds: z.array(recordInput.shape.recordId).max(50).optional(),
  fromStep: z.number().int().positive().optional(),
  toStep: z.number().int().positive().optional(),
  status: z.enum(["success", "failed"]).optional(),
  toolName: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(50).default(20),
  cursor: z.number().int().nonnegative().default(0),
}).refine(value => value.toolsGroupId || value.recordIds?.length, {
  message: "toolsGroupId or recordIds is required",
}).refine(value => value.fromStep === undefined || value.toStep === undefined || value.fromStep <= value.toStep, {
  message: "fromStep must not exceed toStep",
  path: ["toStep"],
});

export function createToolRecordTools(store: ToolRecordStore): ToolDefinition[] {
  return [
    {
      name: "request_tool_record",
      description: "Read one detailed real Tool execution by the {ToolsGroupID}-{Step} ID shown in Context. Use only when the Tool summary is insufficient.",
      source: "builtin",
      inputSchema: recordInput,
      permission: PermissionLevel.READ_ONLY,
      allowSameToolBatch: true,
      recordPolicy: "exclude",
      execute: async (args, opts) => {
        const parsed = recordInput.safeParse(args);
        if (!parsed.success) return toolResult.failure(parsed.error.message);
        if (!opts?.sessionId) return toolResult.failure("sessionId is required");
        const record = store.getRecord(opts.sessionId, parsed.data.recordId);
        return record ? toolResult.reference(record) : toolResult.failure(`ToolRecord not found: ${parsed.data.recordId}`);
      },
    },
    {
      name: "request_tool_records",
      description: "Read a bounded group or set of detailed real Tool executions shown in Context. Supports Group, Step range, status, Tool name, and cursor filters.",
      source: "builtin",
      inputSchema: recordsInput,
      permission: PermissionLevel.READ_ONLY,
      allowSameToolBatch: true,
      recordPolicy: "exclude",
      execute: async (args, opts) => {
        const parsed = recordsInput.safeParse(args);
        if (!parsed.success) return toolResult.failure(parsed.error.message);
        if (!opts?.sessionId) return toolResult.failure("sessionId is required");
        const result = store.query(opts.sessionId, parsed.data);
        return result.records.length > 0 ? toolResult.reference(result) : toolResult.none();
      },
    },
  ];
}
