import { BaseElement, inferProviderProtocol } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus, ProviderProtocol, ToolDefinition } from "@atom-neo/shared";
import type { ElementMemory, ElementTask, PipelineSession } from "../../../session/element-session";
import type { SkillServiceLike } from "../../../skills/types";
import type { ContextService } from "../../../context/context-service";
import type { ToolRecordStore } from "../../../tools/tool-record-store";
import { DEFAULT_MAX_TOKENS, DEFAULT_CONTEXT_LIMIT } from "../../../constants";
import { createToolRuntime } from "./stream/tool-runtime";
import { runConversationStream } from "./stream/stream-run";
import type { DomainEmitter, StreamConfig, StreamReporter } from "./stream/types";
import type { ConversationFlowState } from "./types";

export class StreamLLMElement extends BaseElement<ConversationFlowState, ConversationFlowState> {
  #config: StreamConfig;
  #report: StreamReporter;
  #emitDomain: DomainEmitter;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    apiKey: string;
    model: string;
    provider?: string;
    protocol?: ProviderProtocol;
    baseUrl?: string;
    beforeCall?: (signal?: AbortSignal) => Promise<void>;
    tools: ToolDefinition[];
    mcpToolsRef?: { current: Record<string, any> };
    maxTokens?: number;
    maxSteps?: number;
    providerOptions?: Record<string, any>;
    taskIntent?: string;
    session?: PipelineSession;
    configContextLimit?: number;
    skillService?: SkillServiceLike;
    contextService: ContextService;
    toolRecordStore?: ToolRecordStore;
    task?: ElementTask;
    memory?: ElementMemory;
  }) {
    super({ name: params.name, kind: "transform", bus: params.bus });
    const provider = params.provider ?? "deepseek";
    const maxSteps = params.maxSteps ?? 50;
    this.#report = (event, payload) => this.report(event, payload);
    this.#emitDomain = (event, payload) => this.emitDomain(event as any, payload);
    const toolRuntime = createToolRuntime({
      tools: params.tools,
      report: this.#report,
      maxSteps,
      session: params.session,
      task: params.task,
    });
    this.#config = {
      apiKey: params.apiKey,
      model: params.model,
      provider,
      protocol: params.protocol ?? inferProviderProtocol(provider),
      baseUrl: params.baseUrl,
      beforeCall: params.beforeCall,
      maxTokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
      maxSteps,
      providerOptions: params.providerOptions ?? {},
      taskIntent: params.taskIntent ?? "conversation",
      session: params.session,
      configContextLimit: params.configContextLimit ?? DEFAULT_CONTEXT_LIMIT,
      skillService: params.skillService,
      contextService: params.contextService,
      toolRecordStore: params.toolRecordStore,
      memory: params.memory,
      toolDefinitions: new Map(params.tools.map(definition => [definition.name, definition])),
      sameToolBatchNames: new Set(
        params.tools.filter(tool => tool.allowSameToolBatch === true).map(tool => tool.name),
      ),
      mcpToolsRef: params.mcpToolsRef,
      builtinTools: toolRuntime.builtinTools,
      stepCounter: toolRuntime.stepCounter,
      statuses: toolRuntime.statuses,
      governance: toolRuntime.governance,
    };
  }

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    return runConversationStream({
      config: this.#config,
      report: this.#report,
      emitDomain: this.#emitDomain,
    }, input);
  }
}
