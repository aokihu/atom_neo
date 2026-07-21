import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { BusEvents } from "@atom-neo/shared";
import type { ContextService } from "../../../context/context-service";
import type { CompressFlowState } from "./types";
import type { ContextCompressRequest } from "@atom-neo/shared";

function resolveStrategy(ratio: number): { keepCount: number; summaryMaxTokens: number } {
  if (ratio >= 1.2) return { keepCount: 1, summaryMaxTokens: 1600 };
  if (ratio >= 0.9) return { keepCount: 2, summaryMaxTokens: 1200 };
  if (ratio >= 0.6) return { keepCount: 5, summaryMaxTokens: 800 };
  if (ratio >= 0.3) return { keepCount: 10, summaryMaxTokens: 600 };
  return { keepCount: 20, summaryMaxTokens: 400 };
}

export class CompressInputElement extends BaseElement<any, CompressFlowState> {
  #session: any;
  #contextService: ContextService;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    session: any;
    contextService: ContextService;
  }) {
    super({ name: params.name, kind: "source", bus: params.bus });
    this.#session = params.session;
    this.#contextService = params.contextService;
  }

  async doProcess(input: any): Promise<CompressFlowState> {
    const messages = [...(this.#session?.messages ?? [])].map(message => ({ ...message }));
    const request = input.task?.payload?.find((part: { type?: string }) =>
      part.type === "context_compress_request")?.data as ContextCompressRequest | undefined;
    const resolvedRequest = request ?? { trigger: "manual", resumeConversation: false };

    const ratio = this.#session?.compressRatio ?? 0.5;
    const strategy = resolveStrategy(ratio);

    const safeCount = this.#session?.lastSafeMsgCount ?? 0;
    const keepFromSafe = safeCount > 0 && safeCount < messages.length ? messages.length - safeCount : 0;
    const keepCount = keepFromSafe > 0 ? keepFromSafe : Math.min(strategy.keepCount, messages.length);
    const archiveMessages = messages.slice(0, messages.length - keepCount);
    const summaryMessages = archiveMessages.filter(message =>
      message.visible !== false && (message.role === "user" || message.role === "assistant"));
    const previous = this.#contextService.get(
      "session",
      { sessionId: this.#session?.sessionId ?? "default" },
      "conversation-summary",
    )?.content;
    const previousSummary = Array.isArray(previous)
      ? previous.map(message => message.content).join("\n")
      : typeof previous === "string" ? previous : "";
    const summaryText = [
      previousSummary ? `Previous cumulative summary:\n${previousSummary}` : "",
      summaryMessages.length > 0
        ? `New archived messages:\n${summaryMessages.map(message => `${message.role}: ${message.content}`).join("\n")}`
        : "",
    ].filter(Boolean).join("\n\n");

    this.report(BusEvents.Element.Data, {
      step: "plan created",
      taskId: input.task?.id,
      sessionId: this.#session?.sessionId ?? "default",
      trigger: resolvedRequest.trigger,
      target: "context+messages",
      resumeConversation: resolvedRequest.resumeConversation,
      contextTokens: this.#session?.contextTokens ?? 0,
      totalMessages: messages.length,
      visibleMessages: messages.filter(message => message.visible !== false).length,
      safeCount,
      archiveMessages: archiveMessages.length,
      summaryMessages: summaryMessages.length,
      keepMessages: keepCount,
      compressRatio: ratio.toFixed(2),
      strategy: JSON.stringify(strategy),
      mode: keepFromSafe > 0 ? "safe_boundary" : "default",
    });
    return {
      mode: "archiving",
      task: input.task,
      session: this.#session,
      request: resolvedRequest,
      archiveMessages,
      summaryMessages,
      keepCount,
      summaryText,
      summaryMaxTokens: strategy.summaryMaxTokens,
    };
  }
}
