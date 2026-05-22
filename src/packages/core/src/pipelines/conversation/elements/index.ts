import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap } from "@atom-neo/shared";
import type { PipelineEventBus } from "@atom-neo/shared";
import { generateText } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import type { ToolDefinition } from "@atom-neo/shared";
import baseSystemPrompt from "@assets/prompts/base_system_prompt.md";

export type ConversationMode =
  | "initial"
  | "streaming"
  | "formatted"
  | "executing"
  | "ready_to_finalize";

type Message = { role: string; content: string };

export type ConversationFlowState = {
  mode: string;
  task: any;
  prompts?: Array<{ role: string; content: string }>;
  systemPrompt?: string;
  contextData?: string;
  messages?: Message[];
  responseText?: string;
  followUp?: {
    summary: string;
    nextPrompt: string;
    avoidRepeat: string;
  };
};

// ── Source: collect-prompts ──
export class CollectPromptsElement extends BaseElement<ConversationFlowState, ConversationFlowState> {
  #session: any;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    session: any;
  }) {
    super({ name: params.name, kind: "source", bus: params.bus });
    this.#session = params.session;
  }

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "initial") return input;

    const messages = (this.#session.messages ?? []).map((m: any) => ({
      role: m.role,
      content: m.content,
    }));

    return { mode: "streaming", task: input.task, prompts: messages };
  }
}

// ── Transform: load-system-prompt ──
export class LoadSystemPromptElement extends BaseElement<ConversationFlowState, ConversationFlowState> {
  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
  }) {
    super({ name: params.name, kind: "transform", bus: params.bus });
  }

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "streaming") return input;
    return { ...input, systemPrompt: baseSystemPrompt };
  }
}

// ── Transform: collect-context ──
export class CollectContextElement extends BaseElement<ConversationFlowState, ConversationFlowState> {
  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
  }) {
    super({ name: params.name, kind: "transform", bus: params.bus });
  }

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "streaming") return input;

    const contextData = [
      `Current Time: ${new Date().toISOString()}`,
      `Working Directory: ${process.cwd()}`,
      `OS: ${process.platform} ${process.arch}`,
    ].join("\n");

    return { ...input, contextData };
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

    const messages: Message[] = [];

    if (input.systemPrompt) {
      messages.push({ role: "system", content: input.systemPrompt });
    }
    if (input.contextData) {
      messages.push({ role: "system", content: input.contextData });
    }
    for (const m of input.prompts ?? []) {
      messages.push({ role: m.role, content: m.content });
    }
    const text = input.task?.payload?.[0]?.data;
    if (text) {
      messages.push({ role: "user", content: text });
    }

    return { ...input, mode: "formatted", messages };
  }
}

// ── Transform: stream-llm ──
export class StreamLLMElement extends BaseElement<ConversationFlowState, ConversationFlowState> {
  #apiKey: string;
  #model: string;
  #tools: ToolDefinition[];

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    apiKey: string;
    model: string;
    tools: ToolDefinition[];
  }) {
    super({ name: params.name, kind: "transform", bus: params.bus });
    this.#apiKey = params.apiKey;
    this.#model = params.model;
    this.#tools = params.tools;
  }

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "formatted") return input;
    if (!this.#apiKey) {
      return { ...input, mode: "executing", responseText: "(no API key configured)" };
    }

    const messages = input.messages ?? [];
    if (messages.length === 0) {
      return { ...input, mode: "executing", responseText: "(no messages)" };
    }

    const provider = createDeepSeek({ apiKey: this.#apiKey });
    const model = provider(this.#model);

    try {
      const result = await generateText({
        model,
        messages: messages as any,
        maxTokens: 1024,
      });

      this.report("element.data", { event: "llm-complete" });

      return { ...input, mode: "executing", responseText: result.text };
    } catch (err: any) {
      return {
        ...input,
        mode: "executing",
        responseText: `Error: ${err?.message ?? String(err)}`,
      };
    }
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
    return { ...input, mode: "ready_to_finalize" };
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
    return { type: "complete" as const, task: input.task, output: input.responseText };
  }
}
