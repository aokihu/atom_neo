import { BaseElement, BusEvents, PromptKey, resolvePrompt } from "@atom-neo/shared";
import type {
  ContextMessage,
  ContextOwner,
  ContextScope,
  PipelineEventBus,
  PipelineEventMap,
} from "@atom-neo/shared";
import { DEFAULT_CONTEXT_LIMIT } from "../../../constants";
import type { ContextService } from "../../../context/context-service";
import type { SkillServiceLike } from "../../../skills/types";
import { appendCurrentUserMessage } from "./types";
import type { ConversationFlowState, MemorySearchStatus } from "./types";

export class RecordContextElement extends BaseElement<ConversationFlowState, ConversationFlowState> {
  #memory: any;
  #cwd: string;
  #session: any;
  #providerModel: string;
  #configContextLimit: number;
  #taskIntent: string;
  #getCompiledPrompt: () => string;
  #skillService?: SkillServiceLike;
  #contextService: ContextService;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    contextService: ContextService;
    memory?: any;
    sandbox?: string;
    session?: any;
    providerModel?: string;
    configContextLimit?: number;
    taskIntent?: string;
    getCompiledPrompt?: () => string;
    skillService?: SkillServiceLike;
  }) {
    super({ name: params.name, kind: "transform", bus: params.bus });
    this.#contextService = params.contextService;
    this.#memory = params.memory;
    this.#cwd = params.sandbox ?? process.cwd();
    this.#session = params.session;
    this.#providerModel = params.providerModel ?? "";
    this.#configContextLimit = params.configContextLimit ?? DEFAULT_CONTEXT_LIMIT;
    this.#taskIntent = params.taskIntent ?? "conversation";
    this.#getCompiledPrompt = params.getCompiledPrompt ?? (() => "");
    this.#skillService = params.skillService;
  }

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "streaming") return input;

    const sessionId = this.#session?.sessionId ?? input.task?.sessionId ?? "default";
    const topicId = this.#session?.currentTopic || undefined;
    const taskId = input.task?.id ?? "task";
    const taskOwner = compactOwner({ sessionId, topicId, taskId });
    const topicOwner = compactOwner({ sessionId, topicId });
    const systemPrompt = this.#resolve(PromptKey.BASE_SYSTEM);
    const compiledAgentsPrompt = this.#getCompiledPrompt();
    const skillContext = this.#skillService?.buildContext(sessionId) ?? "";

    this.#putText("system", {}, "system-prompt", "prompt-registry", systemPrompt, 1000, true);
    this.#putText("workspace", { workspaceId: this.#cwd }, "workspace-agents", "agents-compiler", compiledAgentsPrompt, 900, true);
    this.#putText(topicId ? "topic" : "session", topicOwner, "topic-skills", "skill-service", skillContext, 600);

    const taskInstructions = this.#buildTaskInstructions();
    this.#putText("task", taskOwner, "task-environment", "collect-context", taskInstructions, 700);

    const memoryResult = await this.#collectMemories();
    if (memoryResult.messages.length > 0) {
      this.#contextService.put({
        scope: "task",
        owner: taskOwner,
        entry: {
          key: "memory-summaries",
          source: "memory",
          channel: "messages",
          trust: "untrusted",
          priority: 650,
          content: memoryResult.messages,
        },
      });
    }

    const userMessages = (input.prompts ?? [])
      .filter(prompt => prompt.role !== "tool")
      .map(prompt => ({ role: prompt.role, content: prompt.content }));
    appendCurrentUserMessage(userMessages, input.task?.payload?.[0]?.data);
    this.report(BusEvents.Element.Data, {
      step: "done",
      memoryQuery: memoryResult.query,
      memorySearchAttempted: memoryResult.attempted,
      memorySearchStatus: memoryResult.status,
      injectedMemoryCount: memoryResult.messages.length,
      taskIntent: this.#taskIntent,
    });

    return {
      ...input,
      mode: "context_recorded",
      contextOwner: { workspaceId: this.#cwd, ...taskOwner },
      memorySearchAttempted: memoryResult.attempted,
      memorySearchStatus: memoryResult.status,
      injectedMemoryCount: memoryResult.messages.length,
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
        trust: "trusted",
        priority,
        pinned,
        content,
      },
    });
  }

  #buildTaskInstructions(): string {
    const now = new Date();
    const tzOffset = -now.getTimezoneOffset() / 60;
    const tz = `UTC${tzOffset >= 0 ? "+" : ""}${tzOffset}`;
    const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const parts = [this.#resolve(PromptKey.CONTEXT_ENV_INFO)
      .replace("%s", `${ts} ${tz}`)
      .replace("%s", this.#cwd)
      .replace("%s", process.platform)
      .replace("%s", process.arch)];

    if (!this.#session) return parts.join("\n\n");
    const usage = this.#session.tokenUsage?.total ?? 0;
    const pct = ((usage / this.#configContextLimit) * 100).toFixed(2);
    parts.push(`Session Token Usage:\n  Total: ${usage} / ${this.#configContextLimit} (${pct}%)`);
    if (this.#session.currentTopic) {
      parts.push(this.#resolve(PromptKey.CONTEXT_TOPIC_CONSTRAINT).replace("%s", this.#session.currentTopic));
    }
    const todos = this.#session.todoState;
    if (todos?.length) {
      const icons: Record<string, string> = { pending: "⬜", in_progress: "🔄", completed: "✅", cancelled: "❌" };
      const lines = todos.map((todo: any) => `- ${icons[todo.status] ?? "⬜"} [${todo.priority}] ${todo.content}`);
      parts.push(`⚠️  一次只能执行一个任务。完成当前任务后调用 todowrite 更新进度并正常结束当前回复，系统会自动继续 active TODO。\n当前任务进度:\n${lines.join("\n")}`);
    }
    const difficulty = this.#session.pendingPrediction?.difficulty ?? "medium";
    if (difficulty === "hard" || difficulty === "mygod") {
      const verifyRule = difficulty === "mygod" ? "\n5.  每完成一步必须验证结果后再进入下一步" : "";
      parts.push(this.#resolve(PromptKey.CONTEXT_DIFFICULTY_RULES).replace("%s", difficulty).replace("%s", verifyRule));
    }
    return parts.join("\n\n");
  }

  async #collectMemories(): Promise<{
    query: string;
    attempted: boolean;
    status: MemorySearchStatus;
    messages: readonly ContextMessage[];
  }> {
    const query = this.#session?.pendingPrediction?.memoryQuery?.trim() || "";
    if (!query) return { query, attempted: false, status: "not_started", messages: [] };
    if (!this.#memory) {
      this.report(BusEvents.Element.Data, { step: "memory-search-unavailable", memoryQuery: query });
      return { query, attempted: true, status: "unavailable", messages: [] };
    }
    try {
      const memories = await this.#memory.search(query) || [];
      const messages = memories.map((node: any) => ({
        role: "assistant",
        content: `<MemorySummary id="${node.id.slice(0, 6)}" tags="${node.tags?.join(",") || ""}">\n${node.summary}\n</MemorySummary>`,
      }));
      return { query, attempted: true, status: messages.length ? "found" : "empty", messages };
    } catch (error) {
      this.report(BusEvents.Element.Data, {
        step: "memory-search-error",
        memoryQuery: query,
        error: error instanceof Error ? error.message : String(error),
      });
      return { query, attempted: true, status: "unavailable", messages: [] };
    }
  }
}

function compactOwner(owner: ContextOwner): ContextOwner {
  return Object.fromEntries(Object.entries(owner).filter(([, value]) => value)) as ContextOwner;
}
