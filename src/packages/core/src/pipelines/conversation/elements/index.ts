import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap } from "@atom-neo/shared";
import type { PipelineEventBus } from "@atom-neo/shared";
import { streamText, tool, jsonSchema } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import type { ToolDefinition } from "@atom-neo/shared";
import baseSystemPrompt from "@assets/prompts/base_system_prompt.md";
import { IntentRequestType, IntentRequestSource, TaskSource, BusEvents } from "@atom-neo/shared";
import type { IntentRequest } from "@atom-neo/shared";
import { createTaskItem } from "../../../task-factory";
import type { TaskQueue } from "../../../task-queue";
import type { TokenUsage } from "../../../session/context";
import { resolveContextLimit, DEFAULT_MAX_TOKENS } from "../../../constants";

export type ConversationMode =
  | "initial"
  | "streaming"
  | "formatted"
  | "executing"
  | "ready_to_finalize";

type Message = { role: string; content: string; reasoning_content?: string };

export type ConversationFlowState = {
  mode: string;
  task: any;
  prompts?: Array<{ role: string; content: string; reasoning_content?: string }>;
  systemPrompt?: string;
  compiledAgentsPrompt?: string;
  contextData?: string;
  systemText?: string;
  userMessages?: Message[];
  responseText?: string;
  reasoningContent?: string;
  followUp?: {
    summary: string;
    nextPrompt: string;
    avoidRepeat: string;
  };
  chainAction?: "more_tools" | "follow_up";
  intents?: IntentRequest[];
  intentRequestText?: string;
  tokenUsage?: TokenUsage;
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

    const messages = (this.#session.messages ?? []).map((m: any) => {
      const msg: any = { role: m.role, content: m.content };
      if (m.reasoningContent) msg.reasoning_content = m.reasoningContent;
      return msg;
    });

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
  #cwd: string;
  #session: any;
  #providerModel: string;
  #configContextLimit?: number;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    memory?: any;
    sandbox?: string;
    session?: any;
    providerModel?: string;
    configContextLimit?: number;
  }) {
    super({ name: params.name, kind: "transform", bus: params.bus });
    this.#memory = params.memory;
    this.#cwd = params.sandbox ?? process.cwd();
    this.#session = params.session;
    this.#providerModel = params.providerModel ?? "";
    this.#configContextLimit = params.configContextLimit;
  }

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "streaming") return input;

    let contextData = [
      `Current Time: ${new Date().toISOString()}`,
      `cwd: ${this.#cwd}`,
      `OS: ${process.platform} ${process.arch}`,
      `All file paths are relative to cwd.`,
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

    // Inject token usage as context for LLM
    if (this.#session) {
      const tu = this.#session.tokenUsage;
      const limit = resolveContextLimit(this.#providerModel, this.#configContextLimit);
      const pct = ((tu.total / limit) * 100).toFixed(2);
      contextData += `\nSession Token Usage:\n  Total: ${tu.total} / ${limit} (${pct}%)`;
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
  #baseUrl?: string;
  #tools: ToolDefinition[];
  #maxTokens: number;
  #providerOptions: Record<string, any>;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    apiKey: string;
    model: string;
    baseUrl?: string;
    tools: ToolDefinition[];
    maxTokens?: number;
    providerOptions?: Record<string, any>;
  }) {
    super({ name: params.name, kind: "transform", bus: params.bus });
    this.#apiKey = params.apiKey;
    this.#model = params.model;
    this.#baseUrl = params.baseUrl;
    this.#tools = params.tools;
    this.#maxTokens = params.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.#providerOptions = params.providerOptions ?? {};
  }

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "formatted") return input;
    if (!this.#apiKey) {
      return { ...input, mode: "executing", responseText: "(no API key configured)" };
    }

    const userMessages = input.userMessages ?? [];
    const systemText = input.systemText ?? "";

    const provider = createDeepSeek({ apiKey: this.#apiKey, baseURL: this.#baseUrl });
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
        allowSystemInMessages: true,
        providerOptions: this.#providerOptions,
      } as any);

      const MARKER = "<<<REQUEST>>>";
      const WINDOW = MARKER.length - 1;
      const CHUNK_BATCH = 3;  // 缓冲 3 个 chunk 再发送 TUI

      let fullText = "";
      let buffer = "";
      let pastMarker = false;
      let intentRequestText = "";
      let deltaBuffer = "";
      let deltaCount = 0;
      let finishReason = "";

      for await (const chunk of streamResult.fullStream) {
        if (chunk.type === "step-finish") {
          finishReason = (chunk as any).finishReason ?? "";
          continue;
        }
        if (chunk.type !== "text-delta") continue;

        if (pastMarker) {
          intentRequestText += chunk.textDelta;
          continue;
        }

        buffer += chunk.textDelta;
        const idx = buffer.indexOf(MARKER);

        if (idx >= 0) {
          if (idx > 0) {
            fullText += buffer.slice(0, idx);
            deltaBuffer += buffer.slice(0, idx);
            deltaCount++;
          }
          intentRequestText = buffer.slice(idx + MARKER.length);
          pastMarker = true;
          buffer = "";
        } else if (buffer.length > WINDOW) {
          const emitLen = buffer.length - WINDOW;
          const emit = buffer.slice(0, emitLen);
          fullText += emit;
          deltaBuffer += emit;
          deltaCount++;
          buffer = buffer.slice(emitLen);
        }

        // 累积 3 个 chunk 再发送 TUI
        if (deltaCount >= CHUNK_BATCH && deltaBuffer) {
          this.report(BusEvents.Transport.Delta, { textDelta: deltaBuffer });
          deltaBuffer = "";
          deltaCount = 0;
        }
      }

      // 刷新滑动窗口中残留的最后 ≤WINDOW 个字符
      if (buffer) {
        fullText += buffer;
        deltaBuffer += buffer;
      }
      if (deltaBuffer) {
        this.report(BusEvents.Transport.Delta, { textDelta: deltaBuffer });
      }
      const response = await streamResult.response;
      const reasoningContent = (response.messages as any[])?.find((m: any) =>
        m.role === "assistant" && m.reasoningContent
      )?.reasoningContent ?? "";
      const usage = await streamResult.usage;
      const tokenUsage: TokenUsage = {
        total: usage?.totalTokens ?? 0,
      };
      return {
        ...input,
        mode: "executing",
        responseText: fullText,
        reasoningContent: String(reasoningContent),
        tokenUsage,
        intentRequestText,
        chainAction: finishReason === "length" ? "follow_up" : undefined,
      };
    } catch (err: any) {
      return {
        ...input,
        mode: "executing",
        responseText: `Error: ${err?.message ?? String(err)}`,
      };
    }
  }
}

// ── Transform: parse-intents ──
export class ParseIntentsElement extends BaseElement<ConversationFlowState, ConversationFlowState> {
  constructor(params: { name: string; kind: string; bus: PipelineEventBus<PipelineEventMap> }) {
    super({ name: params.name, kind: "transform", bus: params.bus });
  }

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "executing") return input;

    const text = input.intentRequestText || input.responseText || "";
    const intents: IntentRequest[] = parseIntentRequests(text);

    return { ...input, intents };
  }
}

export function parseIntentRequests(text: string): IntentRequest[] {
  const intents: IntentRequest[] = [];
  const re = /\[([^\]]+)\]/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    const parts = match[1].split(",").map((s: string) => s.trim()).filter(Boolean);
    if (parts.length === 0) continue;

    const type = parts[0];
    const params: Record<string, string> = {};
    for (const kv of parts.slice(1)) {
      const [k, v] = kv.split("=", 2);
      if (k && v) params[k.trim()] = v.trim();
    }

    if (type === "REQUEST_MORE_TOOLS") {
      intents.push({ source: IntentRequestSource.CONVERSATION, request: IntentRequestType.REQUEST_MORE_TOOLS, intent: "more tools", params });
    } else if (type === "KEEP_MEMORY" && params.mem_id) {
      intents.push({ source: IntentRequestSource.CONVERSATION, request: IntentRequestType.KEEP_MEMORY, intent: "keep", params: { id: params.mem_id } });
    } else if (type === "FOLLOW_UP") {
      // must have at least one meaningful param for continuation
      if (!params.next_prompt && !params.history_abstract && !params.summary) continue;
      intents.push({ source: IntentRequestSource.CONVERSATION, request: IntentRequestType.FOLLOW_UP, intent: "follow up", params });
    }
    // unknown TYPE → silently discarded
  }

  return intents;
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

    const intents = input.intents ?? [];

    // Process KEEP_MEMORY first (always, regardless of chain action)
    for (const intent of intents) {
      if (intent.request === IntentRequestType.KEEP_MEMORY && this.#memory) {
        const memId = intent.params.id as string;
        if (memId && this.#memory.has?.(memId)) {
          this.#memory.keep(memId);
        }
      }
    }

    // Chain action: REQUEST_MORE_TOOLS overrides stream-llm's follow_up
    for (const intent of intents) {
      if (intent.request === IntentRequestType.REQUEST_MORE_TOOLS) {
        return { ...input, mode: "ready_to_finalize", chainAction: "more_tools" };
      }
      if (intent.request === IntentRequestType.FOLLOW_UP) {
        return {
          ...input,
          mode: "ready_to_finalize",
          followUp: { summary: "follow_up", nextPrompt: "", avoidRepeat: "" },
        };
      }
    }

    return { ...input, mode: "ready_to_finalize" };
  }
}

// ── Sink: finalize ──
export class FinalizeElement extends BaseElement<ConversationFlowState, any> {
  #queue: TaskQueue;
  #buildChainPipeline: ((taskId: string, sessionId: string, chatId: string, chainDepth: number) => void) | undefined;
  #chainDepth: number;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    queue?: TaskQueue;
    buildChainPipeline?: (taskId: string, sessionId: string, chatId: string, chainDepth: number) => void;
    chainDepth?: number;
  }) {
    super({ name: params.name, kind: "sink", bus: params.bus });
    this.#queue = params.queue as TaskQueue;
    this.#buildChainPipeline = params.buildChainPipeline;
    this.#chainDepth = params.chainDepth ?? 0;
  }

  async doProcess(input: ConversationFlowState): Promise<any> {
    if (input.mode !== "ready_to_finalize") {
      throw new Error("FinalizeElement: expected ready_to_finalize");
    }

    const MAX_FOLLOW_UP_DEPTH = 5;

    if (input.chainAction && this.#chainDepth >= MAX_FOLLOW_UP_DEPTH) {
      // Exceeded max chain depth — stop and output a truncation notice
      return {
        type: "complete" as const,
        task: input.task,
        output: (input.responseText ?? "") + "\n\n(已达到最大连续对话深度，操作已停止)",
        reasoningContent: input.reasoningContent,
        tokenUsage: input.tokenUsage,
      };
    }

    if (input.chainAction && this.#buildChainPipeline && this.#queue) {
      const payload: Array<{ type: "text"; data: string }> =
        input.chainAction === "follow_up"
          ? [{ type: "text", data: "请从上次中断处继续，不要重复已输出的内容。" }]
          : [{ type: "text", data: "" }];

      const chainTask = createTaskItem({
        sessionId: input.task.sessionId,
        chatId: input.task.chatId,
        pipeline: "conversation",
        source: TaskSource.INTERNAL,
        payload,
        parentTaskId: input.task.id,
        chainId: input.task.chainId,
      });

      if (input.chainAction === "more_tools") {
        this.#buildChainPipeline(chainTask.id, input.task.sessionId, input.task.chatId, this.#chainDepth + 1);
      }
      this.#queue.enqueue(chainTask);
    }

    return {
      type: "complete" as const,
      task: input.task,
      output: input.responseText,
      reasoningContent: input.reasoningContent,
      tokenUsage: input.tokenUsage,
    };
  }
}
