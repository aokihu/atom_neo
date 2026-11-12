import { BusEvents } from "@atom-neo/shared";
import { findTodoTarget, selectCurrentTodo } from "../../../../session/context";
import type { ToolRecordStore } from "../../../../tools/tool-record-store";
import type { ManualToolCall } from "../tool-loop";
import { shouldRecordToolResult } from "./stream-model-input";
import type { StreamRun, ToolExecutionStatus } from "./types";

/** Applies one executor status: todo handoff, transport events, context injection and records. */
export function applyToolOutcome(
  run: StreamRun,
  call: ManualToolCall,
  batchIndex: number,
  status: ToolExecutionStatus,
): void {
  run.allToolCalls.push({ toolName: call.toolName, metadata: status.metadata });
  if (call.toolName === "todowrite" && status.metadata.ok) {
    const todos = run.config.session?.todoState ?? [];
    if (!run.currentTodo && !run.reconcile) run.currentTodo = selectCurrentTodo(todos);
    const current = findTodoTarget(todos, run.currentTodo);
    if (current && (current.todo.status === "completed" || current.todo.status === "cancelled")) run.todoHandoff = true;
    if (run.reconcile) run.todoHandoff = true;
  }
  const error = status.metadata.ok ? undefined : status.metadata.error;
  run.report(BusEvents.Element.Data, {
    step: "tool-call-finish",
    toolName: call.toolName,
    stepNumber: run.modelStep,
    result: status.content.slice(0, 300),
    ok: status.metadata.ok,
    effect: status.metadata.effect,
    error,
  });
  run.reportTransport(BusEvents.Transport.ToolFinished, {
    toolName: call.toolName,
    toolCallId: call.toolCallId,
    result: status.content,
    error,
  });
  const contextInjection = status.metadata.ok ? status.metadata.contextInjection : undefined;
  if (contextInjection) run.context.inject(contextInjection, run.modelStep + 1, call.toolName);

  const definition = run.config.toolDefinitions.get(call.toolName);
  const recordable = shouldRecordToolResult(definition, status.metadata);
  let toolRecord: ReturnType<ToolRecordStore["append"]> | undefined;
  if (recordable && run.config.toolRecordStore) {
    run.toolsGroup ??= run.config.toolRecordStore.beginGroup(
      run.config.session?.sessionId ?? run.task.sessionId ?? "default",
      run.task.id ?? "task",
      run.config.session?.currentTopic ?? "",
    );
    toolRecord = run.config.toolRecordStore.append(run.toolsGroup, {
      modelStep: run.modelStep,
      batchIndex,
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      source: definition?.source ?? "mcp",
      startedAt: status.startedAt ?? Date.now(),
      durationMs: status.durationMs ?? 0,
      input: call.input,
      output: status.rawOutput ?? status.content,
      metadata: status.metadata,
    });
    run.report(BusEvents.Element.Data, {
      step: "tool-record-added",
      toolsGroupId: run.toolsGroup.id,
      recordId: toolRecord.id,
      recordStep: toolRecord.step,
      modelStep: run.modelStep,
      batchIndex,
      toolName: call.toolName,
    });
  }
  if (recordable) {
    const session = run.config.session;
    session?.addToolResult?.({
      toolName: call.toolName,
      topic: session.currentTopic ?? "",
      timestamp: toolRecord?.startedAt ?? status.startedAt ?? Date.now(),
      content: status.content,
      metadata: status.metadata,
      durationMs: toolRecord?.durationMs ?? status.durationMs ?? 0,
    });
  }
}
