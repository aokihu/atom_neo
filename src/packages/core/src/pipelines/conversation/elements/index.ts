import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap } from "@atom-neo/shared";
import type { PipelineEventBus } from "@atom-neo/shared";
import { streamText } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import type { ToolDefinition } from "@atom-neo/shared";
import { z } from "zod";

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
      aiTools[tool.name] = {
        description: tool.description,
        parameters: zodToJSONSchema(tool.inputSchema as z.ZodType<any>),
        execute: async (args: any) => {
          const result = await tool.execute(args);
          return result.output;
        },
      };
    }

    try {
      const self = this;
      const result = streamText({
        model,
        messages,
        tools: aiTools,
        onChunk({ chunk }) {
          if (chunk.type === "text-delta") {
            self.bus.emit("transport.delta" as any, { textDelta: chunk.textDelta } as any);
          }
        },
      });

      const fullText = await result.text;

      this.report("element.data", { event: "stream-complete" });

      return {
        ...input,
        mode: "executing",
        responseText: fullText,
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

function zodToJSONSchema(schema: z.ZodType<any>): Record<string, unknown> {
  const def = (schema as any)._def ?? (schema as any).def;
  if (!def) return { type: "object", properties: {} };

  const typeMap: Record<string, string> = {
    ZodString: "string",
    ZodNumber: "number",
    ZodBoolean: "boolean",
    ZodArray: "array",
    ZodEnum: "string",
  };
  const type = typeMap[def.typeName] ?? "string";

  if (def.typeName === "ZodObject") {
    const props: Record<string, any> = {};
    const shape = def.shape?.() ?? {};
    for (const [key, value] of Object.entries(shape)) {
      props[key] = zodToJSONSchema(value as z.ZodType<any>);
    }
    return { type: "object", properties: props, required: Object.keys(props) };
  }

  if (def.typeName === "ZodEnum") {
    return { type: "string", enum: def.values };
  }

  return { type, description: def.description };
}
