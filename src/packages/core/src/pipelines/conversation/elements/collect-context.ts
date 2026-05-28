import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import type { ConversationFlowState } from "./types";
import { resolveContextLimit } from "../../../constants";

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

    if (this.#memory) {
      const text = input.task?.payload?.[0]?.data || "";
      const memories = (await this.#memory.search(text)) || [];
      for (const node of memories) {
        if (node.accessCount >= 5) { this.#memory.decayWeight(node.id, 10); continue; }
        const aging = node.accessCount >= 3 ? ' aging="true"' : "";
        const id = node.id.slice(0, 6);
        contextData += `\n<Memory id="${id}" tags="${node.tags?.join(",") || ""}"${aging}>\n${node.content}\n</Memory>`;
        this.#memory.incrementAccess(node.id);
        this.#memory.boostWeight(node.id);
      }
    }

    if (this.#session) {
      const tu = this.#session.tokenUsage;
      const limit = resolveContextLimit(this.#providerModel, this.#configContextLimit);
      const pct = ((tu.total / limit) * 100).toFixed(2);
      contextData += `\nSession Token Usage:\n  Total: ${tu.total} / ${limit} (${pct}%)`;
    }

    return { ...input, contextData };
  }
}
