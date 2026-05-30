import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { IntentRequestType, IntentRequestSource } from "@atom-neo/shared";
import { BusEvents } from "@atom-neo/shared";
import type { IntentRequest } from "@atom-neo/shared";
import type { ConversationFlowState } from "./types";

export class ParseIntentsElement extends BaseElement<ConversationFlowState, ConversationFlowState> {
  constructor(params: { name: string; kind: string; bus: PipelineEventBus<PipelineEventMap> }) {
    super({ name: params.name, kind: "transform", bus: params.bus });
  }

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "executing") return input;
    const text = input.intentRequestText || input.responseText || "";
    const intents: IntentRequest[] = parseIntentRequests(text);
    this.report(BusEvents.Element.Data, { step: "done", intentCount: intents.length, types: intents.map(i => i.request) });
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
      if (!params.next_prompt && !params.history_abstract && !params.summary) continue;
      intents.push({ source: IntentRequestSource.CONVERSATION, request: IntentRequestType.FOLLOW_UP, intent: "follow up", params });
    }
  }

  return intents;
}
