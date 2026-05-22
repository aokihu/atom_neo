import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap } from "@atom-neo/shared";
import type { PipelineEventBus } from "@atom-neo/shared";
import { generateText } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import type { ToolDefinition } from "@atom-neo/shared";

export type ConversationMode =
  | "initial"
  | "streaming"
  | "executing"
  | "ready_to_finalize";

export type ConversationFlowState = {
  mode: string;
  task: any;
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
    return input;
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
    if (input.mode !== "streaming") return input;
    if (!this.#apiKey) {
      return { ...input, mode: "executing", responseText: "(no API key configured)" };
    }

    const messages = (input.prompts ?? []).map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
    }));

    // Add user message if provided
    const text = input.task?.payload?.[0]?.data;
    if (text) {
      messages.push({ role: "user" as const, content: text });
    }

    if (messages.length === 0) {
      return { ...input, mode: "executing", responseText: "(no messages)" };
    }

    const provider = createDeepSeek({ apiKey: this.#apiKey });
    const model = provider(this.#model);

    // Convert ToolDefinition to AI SDK tool format
    const aiTools: Record<string, any> = {};
    for (const tool of this.#tools) {
      const schema: any = tool.inputSchema;
      aiTools[tool.name] = {
        description: tool.description,
        parameters: schema._def ? schema : { type: "object", properties: {} },
        execute: async (args: any) => {
          const result = await tool.execute(args);
          return result.output;
        },
      };
    }

    try {
      const result = await generateText({
        model,
        messages,
        // tools: aiTools,  // TODO: fix schema conversion for AI SDK
        maxTokens: 1024,
      });

      this.report("element.data", { event: "llm-complete" });

      return {
        ...input,
        mode: "executing",
        responseText: result.text,
      };
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      return {
        ...input,
        mode: "executing",
        responseText: `Error: ${msg}`,
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
