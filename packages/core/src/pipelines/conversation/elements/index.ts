import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap } from "@atom-neo/shared";
import type { PipelineEventBus } from "@atom-neo/shared";
import type { TaskItem } from "@atom-neo/shared";
import type { SessionContext } from "../../../session/context";

export type ConversationMode =
  | "initial"
  | "streaming"
  | "executing"
  | "ready_to_finalize";

export type ConversationFlowState = {
  mode: string;
  task: TaskItem;
  prompts?: Array<{ role: string; content: string }>;
  responseText?: string;
  followUp?: {
    summary: string;
    nextPrompt: string;
    avoidRepeat: string;
  };
};

// ── Source: collect-prompts ──
export class CollectPromptsElement extends BaseElement<ConversationFlowState, ConversationFlowState> {
  #session: SessionContext;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    session: SessionContext;
  }) {
    super({ name: params.name, kind: "source", bus: params.bus });
    this.#session = params.session;
  }

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "initial") return input;

    const messages = this.#session.messages.map((m: SessionContext["messages"][number]) => ({
      role: m.role,
      content: m.content,
    }));

    return {
      mode: "streaming",
      task: input.task,
      prompts: messages,
    };
  }
}

// ── Transform: format-messages ──
export class FormatMessagesElement extends BaseElement<ConversationFlowState, ConversationFlowState> {
  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
  }) {
    super({ name: params.name, kind: "transform", bus: params.bus });
  }

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "streaming") return input;
    // Messages already formatted — pass through
    return input;
  }
}

// ── Transform: stream-llm ──
export class StreamLLMElement extends BaseElement<ConversationFlowState, ConversationFlowState> {
  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
  }) {
    super({ name: params.name, kind: "transform", bus: params.bus });
  }

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "streaming") return input;

    // Placeholder: actual streamText call will be wired here
    // For now, simulate a response
    this.report("element.data", { event: "streaming-started" });

    return {
      ...input,
      mode: "executing",
      responseText: "(placeholder: streamText response)",
    };
  }
}

// ── Boundary: check-follow-up ──
export class CheckFollowUpElement extends BaseElement<ConversationFlowState, ConversationFlowState> {
  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
  }) {
    super({ name: params.name, kind: "boundary", bus: params.bus });
  }

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "executing") return input;

    // Parse response text for follow_up intent
    // For now, no follow_up detected → ready to finalize
    return {
      ...input,
      mode: "ready_to_finalize",
    };
  }
}

// ── Sink: finalize ──
export class FinalizeElement extends BaseElement<ConversationFlowState, any> {
  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
  }) {
    super({ name: params.name, kind: "sink", bus: params.bus });
  }

  async doProcess(input: ConversationFlowState): Promise<any> {
    if (input.mode !== "ready_to_finalize") {
      throw new Error("FinalizeElement: expected ready_to_finalize");
    }

    return {
      type: "complete" as const,
      task: input.task,
    };
  }
}
