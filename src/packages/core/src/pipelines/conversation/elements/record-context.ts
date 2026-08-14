import { BaseElement, BusEvents, PromptKey, resolvePrompt } from "@atom-neo/shared";
import type {
  ContextOwner,
  ContextScope,
  PipelineEventBus,
  PipelineEventMap,
} from "@atom-neo/shared";
import { DEFAULT_CONTEXT_LIMIT } from "../../../constants";
import type { ContextService } from "../../../context/context-service";
import type { SkillServiceLike } from "../../../skills/types";
import type { ToolRecordStore } from "../../../tools/tool-record-store";
import { appendCurrentUserMessage } from "./types";
import type { ConversationFlowState } from "./types";

export class RecordContextElement extends BaseElement<ConversationFlowState, ConversationFlowState> {
  #cwd: string;
  #session: any;
  #providerModel: string;
  #configContextLimit: number;
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
    this.#configContextLimit = params.configContextLimit ?? DEFAULT_CONTEXT_LIMIT;
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

    const taskInstructions = this.#buildTaskInstructions();
    this.#putText("task", taskOwner, "task-environment", "collect-context", taskInstructions, 700);

    const userMessages = (input.prompts ?? [])
      .filter(prompt => prompt.role !== "tool")
      .map(prompt => ({ role: prompt.role, content: prompt.content }));
    appendCurrentUserMessage(userMessages, input.task?.payload?.[0]?.data);
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
    const usage = this.#session.contextTokens ?? 0;
    const pct = ((usage / this.#configContextLimit) * 100).toFixed(2);
    parts.push(`Current Context Tokens:\n  Total: ${usage} / ${this.#configContextLimit} (${pct}%)`);
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

}

function compactOwner(owner: ContextOwner): ContextOwner {
  return Object.fromEntries(Object.entries(owner).filter(([, value]) => value)) as ContextOwner;
}
