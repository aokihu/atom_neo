import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap } from "@atom-neo/shared";
import type { PipelineEventBus } from "@atom-neo/shared";
import { streamText, tool, jsonSchema } from "ai";
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
  systemText?: string;
  userMessages?: Message[];
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
  #memory: any;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    memory?: any;
  }) {
    super({ name: params.name, kind: "transform", bus: params.bus });
    this.#memory = params.memory;
  }

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "streaming") return input;

    const sandbox = input.task?.sandbox ?? process.cwd();

    let contextData = [
      `Current Time: ${new Date().toISOString()}`,
      `Sandbox Directory: ${sandbox}`,
      `OS: ${process.platform} ${process.arch}`,
      `All file paths are relative to the sandbox directory.`,
    ].join("\n");

    // Inject memories if available
    if (this.#memory) {
      const text = input.task?.payload?.[0]?.data || "";
      const memories = this.#memory.search(text) || [];
      for (const node of memories) {
        if (node.accessCount >= 5) { this.#memory.decayWeight(node.id, 10); continue; }
        const aging = node.accessCount >= 3 ? ' aging="true"' : "";
        const id = node.id.slice(0, 6);
        contextData += `\n<Memory id="${id}" tags="${node.tags?.join(",") || ""}"${aging}>\n${node.content}\n</Memory>`;
        this.#memory.incrementAccess(node.id);
        this.#memory.boostWeight(node.id);
      }
    }

    return { ...input, contextData };
  }
}

// ── Transform: format-system-messages ──
export class FormatSystemMessagesElement extends BaseElement<ConversationFlowState, ConversationFlowState> {
  constructor(params: { name: string; kind: string; bus: PipelineEventBus<PipelineEventMap> }) {
    super({ name: params.name, kind: "transform", bus: params.bus });
  }

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "streaming") return input;

    const parts: string[] = [];
    if (input.systemPrompt) parts.push(input.systemPrompt);
    if (input.compiledAgentsPrompt) parts.push(input.compiledAgentsPrompt);
    if (input.contextData) parts.push(input.contextData);

    return { ...input, systemText: parts.join("\n\n") };
  }
}

// ── Transform: format-user-messages ──
export class FormatUserMessagesElement extends BaseElement<ConversationFlowState, ConversationFlowState> {
  constructor(params: { name: string; kind: string; bus: PipelineEventBus<PipelineEventMap> }) {
    super({ name: params.name, kind: "transform", bus: params.bus });
  }

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "streaming") return input;

    const messages: Message[] = [];
    for (const m of input.prompts ?? []) {
      messages.push({ role: m.role, content: m.content });
    }
    const text = input.task?.payload?.[0]?.data;
    if (text) messages.push({ role: "user" as const, content: text });

    return { ...input, mode: "formatted", userMessages: messages };
  }
}

// ── Transform: stream-llm ──
export class StreamLLMElement extends BaseElement<ConversationFlowState, ConversationFlowState> {
  #apiKey: string;
  #model: string;
  #tools: ToolDefinition[];
  #maxTokens: number;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    apiKey: string;
    model: string;
    tools: ToolDefinition[];
    maxTokens?: number;
  }) {
    super({ name: params.name, kind: "transform", bus: params.bus });
    this.#apiKey = params.apiKey;
    this.#model = params.model;
    this.#tools = params.tools;
    this.#maxTokens = params.maxTokens ?? 4096;
  }

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "formatted") return input;
    if (!this.#apiKey) {
      return { ...input, mode: "executing", responseText: "(no API key configured)" };
    }

    const userMessages = input.userMessages ?? [];
    const systemText = input.systemText ?? "";

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
      const streamResult = streamText({
        model,
        system: systemText || undefined,
        messages: userMessages as any,
        tools: Object.keys(aiTools).length > 0 ? aiTools : undefined,
        maxSteps: 5,
        maxTokens: this.#maxTokens,
      });

      let fullText = "";
      for await (const chunk of streamResult.fullStream) {
        if (chunk.type === "text-delta") {
          fullText += chunk.textDelta;
          this.report("transport.delta", { textDelta: chunk.textDelta });
        }
      }
      return { ...input, mode: "executing", responseText: fullText };
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
  #memory: any;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    memory?: any;
  }) {
    super({ name: params.name, kind: "boundary", bus: params.bus });
    this.#memory = params.memory;
  }

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "executing") return input;

    const text = input.responseText ?? "";

    // KEEP_MEMORY detection
    const keepMatch = text.match(/KEEP_MEMORY:\s*(?:mem:)?(\w+)/i);
    if (keepMatch && this.#memory) {
      this.#memory.keep(keepMatch[1]);
    }

    // REQUEST_MORE_TOOLS detection
    if (/request.more.tools|REQUEST_MORE_TOOLS|需要更多工具/i.test(text)) {
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
