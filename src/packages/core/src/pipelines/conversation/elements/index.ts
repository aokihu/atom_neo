import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap } from "@atom-neo/shared";
import type { PipelineEventBus } from "@atom-neo/shared";
import { generateText, tool, jsonSchema } from "ai";
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
  compiledAgentsPrompt?: string;
  contextData?: string;
  messages?: Message[];
  responseText?: string;
  followUp?: {
    summary: string;
    nextPrompt: string;
    avoidRepeat: string;
  };
  needMoreTools?: boolean;
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

// ── Transform: fetch-agents-prompt ──
export class FetchAgentsPromptElement extends BaseElement<ConversationFlowState, ConversationFlowState> {
  #getCompiledPrompt: () => string;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    getCompiledPrompt: () => string;
  }) {
    super({ name: params.name, kind: "transform", bus: params.bus });
    this.#getCompiledPrompt = params.getCompiledPrompt;
  }

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "streaming") return input;

    const compiled = this.#getCompiledPrompt();
    if (!compiled) return input; // skip: 提示词未就绪则跳过

    return { ...input, compiledAgentsPrompt: compiled };
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
    if (input.compiledAgentsPrompt) {
      messages.push({ role: "system", content: input.compiledAgentsPrompt });
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

    // Convert ToolDefinition to AI SDK v6 tool format
    const aiTools: Record<string, any> = {};
    for (const t of this.#tools) {
      aiTools[t.name] = tool({
        description: t.description,
        parameters: jsonSchema(t.inputSchema as any),
        execute: async (args: any) => {
          const result = await t.execute(args);
          if (!result.ok) return `Error: ${result.error}`;
          return result.output || JSON.stringify(result.data);
        },
      });
    }

    try {
      const result = await generateText({
        model,
        messages: messages as any,
        tools: Object.keys(aiTools).length > 0 ? aiTools : undefined,
        maxTokens: 1024,
        maxSteps: 5,
      });

      this.report("element.data", {
        event: "llm-complete",
        toolCalls: (result as any).toolCalls?.length ?? 0,
        finishReason: (result as any).finishReason,
      });

      const text = result.text || "";
      return { ...input, mode: "executing", responseText: text };
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

    const text = input.responseText ?? "";

    // Check for REQUEST_MORE_TOOLS intent in response
    const hasMoreToolsRequest =
      /request.more.tools|REQUEST_MORE_TOOLS|需要更多工具/i.test(text);

    if (hasMoreToolsRequest) {
      return {
        ...input,
        mode: "ready_to_finalize",
        followUp: {
          summary: "request_more_tools",
          nextPrompt: "",
          avoidRepeat: "",
        },
        needMoreTools: true,
      };
    }

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
    return {
      type: "complete" as const,
      task: input.task,
      output: input.responseText,
      needMoreTools: input.needMoreTools ?? false,
    };
  }
}
