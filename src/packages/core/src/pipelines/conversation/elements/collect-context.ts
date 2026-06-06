import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { BusEvents } from "@atom-neo/shared";
import type { ConversationFlowState } from "./types";
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

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "streaming") return input;

    const now = new Date();
    const tzOffset = -now.getTimezoneOffset() / 60;
    const tz = `UTC${tzOffset >= 0 ? '+' : ''}${tzOffset}`;
    const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    let contextData = [
      `Current Time: ${ts} ${tz}`,
      `cwd: ${this.#cwd}`,
      `OS: ${process.platform} ${process.arch}`,
      `All file paths are relative to cwd.`,
    ].join("\n");

    let memoryCount = 0;
    if (this.#memory && (this.#taskIntent === "tool_execution" || this.#taskIntent === "knowledge_retrieval")) {
      const text = input.task?.payload?.[0]?.data || "";
      const memories = (await this.#memory.search(text)) || [];
      for (const node of memories) {
        if (node.accessCount >= 5) { this.#memory.decayWeight(node.id, 10); continue; }
        const aging = node.accessCount >= 3 ? ' aging="true"' : "";
        const id = node.id.slice(0, 6);
        contextData += `\n<Memory id="${id}" tags="${node.tags?.join(",") || ""}"${aging}>\n${node.content}\n</Memory>`;
        this.#memory.incrementAccess(node.id);
        this.#memory.boostWeight(node.id);
        memoryCount++;
      }
    }

    if (this.#session) {
      const tu = this.#session.tokenUsage;
      const limit = resolveContextLimit(this.#providerModel, this.#configContextLimit);
      const pct = ((tu.total / limit) * 100).toFixed(2);
      contextData += `\nSession Token Usage:\n  Total: ${tu.total} / ${limit} (${pct}%)`;

      if (this.#session.evaluatorSuggestion) {
        contextData += `\n\n[评估建议] ${this.#session.evaluatorSuggestion}`;
        delete this.#session.evaluatorSuggestion;
      }
      if (this.#session.upgradeModel) {
        contextData += `\n\n[模型提示] 已切换为更高级别的模型处理此任务。`;
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

      const todos = this.#session.todoState;
      if (todos && todos.length > 0) {
        const icons: Record<string, string> = { pending: "⬜", in_progress: "🔄", completed: "✅", cancelled: "❌" };
        const lines = todos.map((t: any) => `- ${icons[t.status] ?? "⬜"} [${t.priority}] ${t.content}`);
        contextData += `\n\n当前任务进度:\n${lines.join("\n")}`;
      }

      const difficulty: string = this.#session?.pendingPrediction?.difficulty ?? "medium";
      if (difficulty === "hard" || difficulty === "mygod") {
        const verifyRule = difficulty === "mygod"
          ? "\n5.  每完成一步必须验证结果后再进入下一步"
          : "";
        contextData += [
          `\n\n[任务难度: ${difficulty}]`,
          "你正在执行一个困难任务，必须严格遵守以下规则：",
          "1. 使用 `todowrite` 创建完整的任务计划，每次只执行当前 in_progress 项",
          "2. 完成一项后，调用 `todowrite` 更新状态（已完成项标记 completed、下一项 pending 置为 in_progress）",
          "3. 调用 `intent`（action: follow_up）进入下一项",
          "4. 不要在同一回复中执行多项任务" + verifyRule,
          "6. 所有任务 completed 后方可进入决策协议步骤 1",
        ].join("\n");
      }
    }

    this.report(BusEvents.Element.Data, { step: "done", memoryCount, taskIntent: this.#taskIntent, hasSuggestion: !!this.#session?.evaluatorSuggestion, hasSummary: !!this.#session?.conversationSummary, hasPostCheck: !!this.#session?.postCheckGuidance });
    return { ...input, contextData };
  }
}
