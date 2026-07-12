import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { BusEvents, containsSkillHint, PromptKey, resolvePrompt } from "@atom-neo/shared";
import type { ConversationFlowState, MemorySearchStatus } from "./types";
import { resolveContextLimit } from "../../../constants";

export class CollectContextElement extends BaseElement<ConversationFlowState, ConversationFlowState> {
  #memory: any;
  #cwd: string;
  #session: any;
  #providerModel: string;
  #configContextLimit?: number;
  #taskIntent: string;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    memory?: any;
    sandbox?: string;
    session?: any;
    providerModel?: string;
    configContextLimit?: number;
    taskIntent?: string;
  }) {
    super({ name: params.name, kind: "transform", bus: params.bus });
    this.#memory = params.memory;
    this.#cwd = params.sandbox ?? process.cwd();
    this.#session = params.session;
    this.#providerModel = params.providerModel ?? "";
    this.#configContextLimit = params.configContextLimit;
    this.#taskIntent = params.taskIntent ?? "conversation";
  }

  #resolve(key: PromptKey): string {
    return resolvePrompt(key, this.#providerModel);
  }

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "streaming") return input;

    const now = new Date();
    const tzOffset = -now.getTimezoneOffset() / 60;
    const tz = `UTC${tzOffset >= 0 ? '+' : ''}${tzOffset}`;
    const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    let contextData = this.#resolve(PromptKey.CONTEXT_ENV_INFO)
      .replace("%s", ts + " " + tz)
      .replace("%s", this.#cwd)
      .replace("%s", process.platform)
      .replace("%s", process.arch);

    const memoryQuery = this.#session?.pendingPrediction?.memoryQuery?.trim() || "";
    let memorySearchAttempted = false;
    let memorySearchStatus: MemorySearchStatus = "not_started";
    let injectedMemoryCount = 0;
    let memorySuggestsSkill = false;
    let memories: any[] = [];

    if (memoryQuery) {
      memorySearchAttempted = true;
      try {
        memories = this.#memory ? (await this.#memory.search(memoryQuery)) || [] : [];
        if (!this.#memory) {
          memorySearchStatus = "unavailable";
          this.report(BusEvents.Element.Data, { step: "memory-search-unavailable", memoryQuery });
        } else {
          memorySearchStatus = memories.length > 0 ? "found" : "empty";
        }
      } catch (err) {
        memorySearchStatus = "unavailable";
        this.report(BusEvents.Element.Data, { step: "memory-search-error", memoryQuery, error: err instanceof Error ? err.message : String(err) });
      }

      for (const node of memories) {
        if (node.accessCount >= 5) { this.#memory.decayWeight(node.id, 10); continue; }
        const aging = node.accessCount >= 3 ? ' aging="true"' : "";
        const id = node.id.slice(0, 6);
        contextData += `\n<Memory id="${id}" tags="${node.tags?.join(",") || ""}"${aging}>\n${node.content}\n</Memory>`;
        if (containsSkillHint(`${node.content}\n${node.tags?.join(" ") || ""}`)) memorySuggestsSkill = true;
        this.#memory.incrementAccess(node.id);
        this.#memory.boostWeight(node.id);
        injectedMemoryCount++;
      }
      if (memorySearchStatus === "found" && injectedMemoryCount === 0) memorySearchStatus = "empty";
    }

    if (this.#session) {
      const tu = this.#session.tokenUsage;
      const limit = resolveContextLimit(this.#providerModel, this.#configContextLimit);
      const pct = ((tu.total / limit) * 100).toFixed(2);
      contextData += `\nSession Token Usage:\n  Total: ${tu.total} / ${limit} (${pct}%)`;

      if (this.#session.evaluatorSuggestion) {
        contextData += `\n\n${this.#resolve(PromptKey.CONTEXT_EVALUATOR_HINT).replace("%s", this.#session.evaluatorSuggestion)}`;
        delete this.#session.evaluatorSuggestion;
      }
      if (this.#session.upgradeModel) {
        contextData += `\n\n${this.#resolve(PromptKey.CONTEXT_MODEL_UPGRADE)}`;
        delete this.#session.upgradeModel;
      }
      if (this.#session.conversationSummary) {
        contextData += `\n\n${this.#session.conversationSummary}`;
        delete this.#session.conversationSummary;
      }
      if (this.#session.postCheckGuidance) {
        contextData += `\n\n${this.#session.postCheckGuidance}`;
        delete this.#session.postCheckGuidance;
      }

      const results = this.#session.toolContext?.results ?? [];
      if (results.length > 0) {
        const topicResults = results.filter((r: any) => r.topic === this.#session.currentTopic);
        if (topicResults.length > 0) {
          const lines = topicResults.map((r: any) =>
            `- [${new Date(r.timestamp).toISOString().slice(11, 19)}] ${r.toolName}: ${r.ok ? "ok" : "error"}${r.output ? ` — ${r.output.slice(0, 80)}` : ""}`
          );
          contextData += `\n\n[Tool Execution History]\n${lines.join("\n")}`;
          this.#session.toolContext.results = results.filter((r: any) => r.topic !== this.#session.currentTopic);
        }
      }

      const topic = this.#session.currentTopic;
      if (topic) {
        contextData += `\n\n${this.#resolve(PromptKey.CONTEXT_TOPIC_CONSTRAINT).replace("%s", topic)}`;
      }

      const todos = this.#session.todoState;
      this.report(BusEvents.Element.Data, { step: "todo-check", todoLen: todos?.length ?? 0, hasSession: !!this.#session });
      if (todos && todos.length > 0) {
        const icons: Record<string, string> = { pending: "⬜", in_progress: "🔄", completed: "✅", cancelled: "❌" };
        const lines = todos.map((t: any) => `- ${icons[t.status] ?? "⬜"} [${t.priority}] ${t.content}`);
        contextData += `\n\n⚠️  一次只能执行一个任务。完成当前任务后需调用 todowrite 更新进度，再调用 intent(action: follow_up) 继续。\n当前任务进度:\n${lines.join("\n")}`;
      }

      const difficulty: string = this.#session?.pendingPrediction?.difficulty ?? "medium";
      this.report(BusEvents.Element.Data, { step: "diff-check", difficulty, hasPrediction: !!this.#session?.pendingPrediction });
      if (difficulty === "hard" || difficulty === "mygod") {
        const verifyRule = difficulty === "mygod"
          ? "\n5.  每完成一步必须验证结果后再进入下一步"
          : "";
        const tmpl = this.#resolve(PromptKey.CONTEXT_DIFFICULTY_RULES);
        contextData += `\n\n${tmpl.replace("%s", difficulty).replace("%s", verifyRule)}`;
      }
    }

    this.report(BusEvents.Element.Data, { step: "done", memoryQuery, memorySearchAttempted, memorySearchStatus, injectedMemoryCount, memorySuggestsSkill, taskIntent: this.#taskIntent, hasSuggestion: !!this.#session?.evaluatorSuggestion, hasSummary: !!this.#session?.conversationSummary, hasPostCheck: !!this.#session?.postCheckGuidance });
    return { ...input, contextData, memorySearchAttempted, memorySearchStatus, injectedMemoryCount, memorySuggestsSkill };
  }
}
