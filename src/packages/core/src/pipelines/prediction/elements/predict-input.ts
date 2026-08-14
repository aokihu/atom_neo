import { BaseElement, substringWellFormed } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus, SessionMessage } from "@atom-neo/shared";
import { BusEvents } from "@atom-neo/shared";
import { isPromptEligibleMessage } from "../../../session/message-policy";
import type { PredictionFlowState } from "./types";
import type { PreviousTurnContext } from "./types";

const MAX_PREVIOUS_USER_LENGTH = 500;
const MAX_PREVIOUS_ASSISTANT_LENGTH = 1000;
const OMITTED_MARKER = "\n…\n";

function buildExcerpt(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const available = maxLength - OMITTED_MARKER.length;
  const headLength = Math.floor(available * 0.4);
  const tailLength = available - headLength;
  return `${substringWellFormed(text, 0, headLength)}${OMITTED_MARKER}${substringWellFormed(text, text.length - tailLength)}`;
}

export function getPreviousTurnContext(messages: readonly SessionMessage[]): PreviousTurnContext | undefined {
  const eligible = messages.filter(isPromptEligibleMessage);
  const assistantIndex = eligible.findLastIndex(message => message.role === "assistant" && message.content.length > 0);
  if (assistantIndex < 0) return undefined;

  let userIndex = assistantIndex - 1;
  while (userIndex >= 0 && eligible[userIndex]?.role !== "user") userIndex--;
  if (userIndex < 0) return undefined;

  const assistantParts: string[] = [];
  for (let index = userIndex + 1; index < eligible.length; index++) {
    const message = eligible[index]!;
    if (message.role === "user") break;
    if (message.role === "assistant" && message.content.length > 0) assistantParts.push(message.content);
  }
  const assistant = assistantParts.join("\n");
  if (!assistant) return undefined;

  return {
    user: buildExcerpt(eligible[userIndex]!.content, MAX_PREVIOUS_USER_LENGTH),
    assistant: buildExcerpt(assistant, MAX_PREVIOUS_ASSISTANT_LENGTH),
  };
}

export class PredictInputElement extends BaseElement<any, PredictionFlowState> {
  #session: any;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    session: any;
    task: any;
  }) {
    super({ name: params.name, kind: "source", bus: params.bus });
    this.#session = params.session;
  }

  async doProcess(input: any): Promise<PredictionFlowState> {
    const task = input.task;
    const raw = task?.payload?.[0]?.data ?? "";
    const text = typeof raw === "string" ? raw : "";
    const currentTopic = this.#session?.currentTopic ?? "";
    const previousTurnContext = getPreviousTurnContext(this.#session?.messages ?? []);

    this.report(BusEvents.Element.Data, {
      step: "done",
      userMsgLen: text.length,
      currentTopic,
      hasPreviousTurn: !!previousTurnContext,
    });
    return {
      mode: "predicting",
      task,
      session: this.#session,
      userMessage: text,
      currentTopic,
      ...(previousTurnContext ? { previousTurnContext } : {}),
    };
  }
}
