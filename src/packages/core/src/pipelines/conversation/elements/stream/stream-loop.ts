import { createHash } from "node:crypto";
import { BusEvents } from "@atom-neo/shared";
import { asSchema } from "ai";
import type { ManualToolCall } from "../tool-loop";
import { buildToolStepInstruction, stripToolCallMarkup } from "../tool-loop";
import { runModelStep } from "./stream-step";
import { runToolBatch } from "./tool-batch";
import type { StreamRun } from "./types";

/** Owns the manual tool loop, exit reasons, and governance-driven forcing. */
export async function runStreamLoop(run: StreamRun): Promise<void> {
  let reportedGovernanceStop = "";
  try {
    const schemaDescriptions = await Promise.all(Object.entries(run.modelTools).map(async ([name, definition]) => ({
      name, description: definition.description, inputSchema: await asSchema(definition.inputSchema).jsonSchema,
    })));
    run.toolDefinitionsHash = createHash("sha256").update(JSON.stringify(schemaDescriptions)).digest("hex").slice(0, 16);
    while (!run.timedOut && run.modelStep <= run.config.maxSteps + 1 && (!run.reconcile || run.reconciliationAttempts < 2)) {
      run.context.refresh(run.modelStep);
      const governance = run.config.governance.current.snapshot();
      if (governance.stopReason && governance.stopReason !== reportedGovernanceStop) {
        reportedGovernanceStop = governance.stopReason;
        run.report(BusEvents.Element.Data, { step: "tool-governance-stop", stepNumber: run.modelStep, ...governance });
      }
      const forceText = run.forceFinalText || run.config.governance.current.shouldForceText();
      run.lastStepToolsEnabled = !forceText && run.toolNames.length > 0;
      const instructions = [run.context.systemText, run.stepInstruction].filter(Boolean).join("\n\n");
      const outcome = await runModelStep(run, { instructions, forceText });
      run.finishReason = outcome.finishReason;
      run.streamFailed = outcome.failed;
      run.streamErrorCode = outcome.errorCode;
      run.lastUsage = outcome.usage;
      run.cumulativeUsage = outcome.cumulativeUsage;

      run.reasoningText += outcome.reasoning;
      let stepText = outcome.text;
      if (outcome.calls.length === 0) {
        const markerIndex = stepText.indexOf("<<<COMPLETE>>>");
        if (markerIndex >= 0) {
          stepText = stepText.slice(0, markerIndex);
          run.completeDetected = true;
          run.report(BusEvents.Element.Data, { step: "complete-marker-detected" });
        }
      }
      const visibleStepText = run.reconcile ? "" : stripToolCallMarkup(stepText);
      if (visibleStepText) {
        const offset = run.fullText.length;
        const textDelta = (run.fullText ? "\n\n" : "") + visibleStepText;
        run.fullText += textDelta;
        run.reportTransport(BusEvents.Transport.Delta, { textDelta, offset });
      }

      if (outcome.calls.length === 0) {
        run.loopExitReason = "no_tool_calls";
        run.context.completeStep(run.modelStep);
        break;
      }
      if (forceText) {
        run.loopExitReason = "tools_forced_off";
        run.report(BusEvents.Element.Data, {
          step: "tool-call-ignored",
          stepNumber: run.modelStep,
          reason: "framework_force_text",
          toolNames: outcome.calls.map(call => call.toolName),
        });
        run.context.completeStep(run.modelStep);
        break;
      }

      if (run.reconcile) run.reconciliationAttempts += outcome.calls.length;
      if (await handleToolBatch(run, outcome.calls, visibleStepText, outcome.reasoning) === "break") break;
    }
  } catch (err: any) {
    run.loopExitReason = "stream_error";
    run.streamFailed = true;
    run.finishReason = "error";
    run.streamErrorCode = err?.statusCode ?? 0;
    run.report(BusEvents.Element.Data, { step: "error", level: "warn", error: err?.message ?? String(err) });
  } finally {
    run.deadline.dispose();
    run.context.release();
  }
}

async function handleToolBatch(
  run: StreamRun,
  calls: readonly ManualToolCall[],
  visibleStepText: string,
  stepReasoning: string,
): Promise<"break" | "continue"> {
  const batch = await runToolBatch(run, calls, visibleStepText, stepReasoning);
  if (batch.kind === "blocked") {
    run.modelMessages = [...run.modelMessages, ...batch.projectedMessages];
    run.stepInstruction = batch.error ?? "";
    run.reportTransport(BusEvents.Transport.ToolStepFinished, {
      stepNumber: run.modelStep,
      total: calls.length,
      success: 0,
      failed: calls.length,
      toolNames: calls.map(call => call.toolName),
    });
    run.context.completeStep(run.modelStep);
    run.modelStep++;
    return "continue";
  }

  if (batch.projectedMessages.length > 0) {
    run.modelMessages = [...run.modelMessages, ...batch.projectedMessages];
  }
  const nextGovernance = run.config.governance.current.snapshot();
  run.stepInstruction = buildToolStepInstruction({
    consecutiveNoProgress: nextGovernance.consecutiveNoProgress,
    warningThreshold: nextGovernance.maxConsecutiveNoProgress,
    stopReason: nextGovernance.stopReason,
  });
  run.forceFinalText = Boolean(nextGovernance.stopReason);
  run.reportTransport(BusEvents.Transport.ToolStepFinished, {
    stepNumber: run.modelStep,
    total: calls.length,
    success: batch.completedCalls,
    failed: batch.failedCalls,
    toolNames: calls.map(call => call.toolName),
  });
  run.context.completeStep(run.modelStep);
  if (batch.intentRequested || run.todoHandoff) {
    run.loopExitReason = batch.intentRequested
      ? "intent_follow_up"
      : run.reconcile ? "reconciliation_updated" : "todo_handoff";
    return "break";
  }
  run.modelStep++;
  return "continue";
}
