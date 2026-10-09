import { BaseElement, BusEvents, PromptKey, resolvePrompt } from "@atom-neo/shared";
import type {
  ContextOwner,
  ContextScope,
  PipelineEventBus,
  PipelineEventMap,
} from "@atom-neo/shared";
import type { ContextService } from "../../../context/context-service";
import type { SkillServiceLike } from "../../../skills/types";
import type { ToolRecordStore } from "../../../tools/tool-record-store";
import { appendCurrentUserMessage } from "./types";
import type { ConversationFlowState } from "./types";

export class RecordContextElement extends BaseElement<ConversationFlowState, ConversationFlowState> {
  #cwd: string;
  #session: any;
  #providerModel: string;
  #taskIntent: string;
  #getCompiledPrompt: () => string;
  #skillService?: SkillServiceLike;
  #contextService: ContextService;
  #toolRecordStore?: ToolRecordStore;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    contextService: ContextService;
    sandbox?: string;
    session?: any;
    providerModel?: string;
    configContextLimit?: number;
    taskIntent?: string;
    getCompiledPrompt?: () => string;
    skillService?: SkillServiceLike;
    toolRecordStore?: ToolRecordStore;
  }) {
    super({ name: params.name, kind: "transform", bus: params.bus });
    this.#contextService = params.contextService;
    this.#cwd = params.sandbox ?? process.cwd();
    this.#session = params.session;
    this.#providerModel = params.providerModel ?? "";
    this.#taskIntent = params.taskIntent ?? "conversation";
    this.#getCompiledPrompt = params.getCompiledPrompt ?? (() => "");
    this.#skillService = params.skillService;
    this.#toolRecordStore = params.toolRecordStore;
  }

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "streaming") return input;

    const sessionId = this.#session?.sessionId ?? input.task?.sessionId ?? "default";
    const topicId = this.#session?.currentTopic || undefined;
    const taskId = input.task?.id ?? "task";
    const taskOwner = compactOwner({ sessionId, topicId, taskId });
    const topicOwner = compactOwner({ sessionId, topicId });
    this.#contextService.remove("session", { sessionId }, "tool-history");
    if (topicId) this.#contextService.remove("topic", { sessionId, topicId }, "tool-history");
    const toolSummary = this.#toolRecordStore?.summarize(sessionId);
    if (toolSummary) {
      this.#contextService.put({
        scope: "session",
        owner: { sessionId },
        entry: {
          key: "tool-record-summary",
          source: "tool-record-store",
          channel: "tool",
          trust: "untrusted",
          priority: 500,
          content: toolSummary,
        },
      });
    } else {
      this.#contextService.remove("session", { sessionId }, "tool-record-summary");
    }
    const systemPrompt = this.#resolve(PromptKey.BASE_SYSTEM);
    const compiledAgentsPrompt = this.#getCompiledPrompt();
    const skillContext = this.#skillService?.buildContext(sessionId) ?? "";

    this.#putText("system", {}, "system-prompt", "prompt-registry", systemPrompt, 1000, true);
    this.#putText("workspace", { workspaceId: this.#cwd }, "workspace-agents", "agents-compiler", compiledAgentsPrompt, 900, true);
    this.#putText(topicId ? "topic" : "session", topicOwner, "topic-skills", "skill-service", skillContext, 600);

    this.#contextService.remove("task", taskOwner, "task-environment");
    this.#putText("task", taskOwner, "task-rules", "prompt-registry",
      this.#resolve(PromptKey.CONTEXT_TOPIC_CONSTRAINT).replace("%s", "task-state.topic")
        + "\nAll file paths are relative to environment.cwd.\nWork on one TODO at a time; update progress with todowrite and finish the reply so the system can continue active TODOs.", 700);
    const putData = (key: string, content: Record<string, unknown>) => this.#contextService.put({
      scope: "task", owner: taskOwner,
      entry: { key, source: key, channel: "runtime", trust: "trusted", priority: 700, content },
    });
    putData("environment", { cwd: this.#cwd, platform: process.platform, arch: process.arch,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    putData("task-state", { topic: this.#session?.currentTopic ?? "",
      difficulty: this.#session?.pendingPrediction?.difficulty ?? "medium",
      todos: this.#session?.todoState ?? [],
      originalGoal: this.#session?.executionBudget?.goal,
      executionBudget: this.#session?.executionBudget ? { globalUsed: this.#session.executionBudget.globalUsed,
        globalAllowance: this.#session.executionBudget.globalAllowance, localUsed: this.#session.executionBudget.localUsed } : undefined });
    const continuation = input.task?.payload?.find((part: any) => part.type === "continuation_request")?.data;
    if (continuation) {
      this.#putText("task", taskOwner, "continuation-rules", "runtime",
        continuation.kind === "reconcile_progress"
          ? "Only reconcile TODO progress against saved output. Use todowrite, do not regenerate business content. Do not mark work complete from claims alone."
          : continuation.kind === "resume_current"
            ? "Continue only the CURRENT unfinished content from the saved breakpoint. The original segment-break request has already been executed: do not execute it again. Do not repeat output. If a current TODO exists, when it is finished use todowrite to mark it completed and hand off the next item; that update ends this reply."
            : "Execute ONLY the selected remaining TODO in continuation-request.target. Previous completed items are already delivered: do not recap, copy or rewrite them. After finishing the selected item, update TODO and end the reply.", 950);
      putData("continuation-request", { kind: continuation.kind, target: continuation.target,
        agentReferenceUntrusted: continuation.followUp });
    }
    putData("current-time", { time: new Date().toISOString() });
    this.#putText("task", taskOwner, "difficulty-rules", "prompt-registry", this.#buildTaskInstructions(), 700);

    const userMessages = (input.prompts ?? [])
      .filter(prompt => prompt.role !== "tool")
      .map(prompt => ({ role: prompt.role, content: prompt.content,
        ...(prompt.reasoning_content ? { reasoning_content: prompt.reasoning_content } : {}) }));
    appendCurrentUserMessage(userMessages, input.task?.payload?.find((part: any) => part.type === "text")?.data);
    this.report(BusEvents.Element.Data, {
      step: "done",
      taskIntent: this.#taskIntent,
    });

    return {
      ...input,
      mode: "context_recorded",
      contextOwner: { workspaceId: this.#cwd, ...taskOwner },
      userMessages,
    };
  }

  #resolve(key: PromptKey): string {
    return resolvePrompt(key, this.#providerModel);
  }

  #putText(
    scope: ContextScope,
    owner: ContextOwner,
    key: string,
    source: string,
    content: string,
    priority: number,
    pinned = false,
  ): void {
    if (!content) {
      this.#contextService.remove(scope, owner, key);
      return;
    }
    this.#contextService.put({
      scope,
      owner,
      entry: {
        key,
        source,
        channel: "instructions",
        format: "text",
        trust: "trusted",
        priority,
        pinned,
        content,
      },
    });
  }

  #buildTaskInstructions(): string {
    const parts: string[] = [];
    const difficulty = this.#session?.pendingPrediction?.difficulty ?? "medium";
    if (difficulty === "hard" || difficulty === "mygod") {
      const verifyRule = difficulty === "mygod" ? "\n5.  每完成一步必须验证结果后再进入下一步" : "";
      parts.push(this.#resolve(PromptKey.CONTEXT_DIFFICULTY_RULES).replace("%s", difficulty).replace("%s", verifyRule));
    }
    return parts.join("\n\n");
  }

}

function compactOwner(owner: ContextOwner): ContextOwner {
  return Object.fromEntries(Object.entries(owner).filter(([, value]) => value)) as ContextOwner;
}
