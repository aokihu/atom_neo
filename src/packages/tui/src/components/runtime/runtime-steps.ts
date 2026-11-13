import type { Message, ToolPhase } from "../../types";

export type PipelineState = "IDLE" | "WAIT" | "RUN" | "OK" | "ERR";

export type PipelineStep = {
  label: string;
  state: PipelineState;
};

function currentTurn(messages: Message[]): Message[] {
  const lastUser = messages.findLastIndex(message => message.role === "user");
  return lastUser < 0 ? messages : messages.slice(lastUser);
}

export function derivePipelineSteps(messages: Message[], busy: boolean, preparing: boolean): PipelineStep[] {
  const turn = currentTurn(messages);
  const tools = turn.flatMap(message => message.role === "tool-group" ? message.entries : []);
  const hasToolError = tools.some(tool => tool.phase === "error");
  const toolsRunning = tools.some(tool => tool.phase === "preparing" || tool.phase === "executing");
  const hasTools = tools.length > 0;
  const responseRunning = turn.some(message => message.role === "assistant" && message.streaming);
  const hasResponse = turn.some(message => message.role === "assistant" && message.content.length > 0);
  const hasInput = turn.some(message => message.role === "user");

  return [
    { label: "RECEIVE", state: hasInput ? "OK" : "IDLE" },
    { label: "THINK", state: preparing ? "RUN" : busy ? "OK" : hasResponse || hasTools ? "OK" : "IDLE" },
    {
      label: "TOOLS",
      state: hasToolError ? "ERR" : toolsRunning ? "RUN" : hasTools ? "OK" : busy ? "WAIT" : "IDLE",
    },
    {
      label: "RESPOND",
      state: responseRunning ? "RUN" : hasResponse ? "OK" : busy ? "WAIT" : "IDLE",
    },
  ];
}

export function phaseCount(messages: Message[], phase: ToolPhase): number {
  return messages.reduce((count, message) => (
    message.role === "tool-group"
      ? count + message.entries.filter(entry => entry.phase === phase).length
      : count
  ), 0);
}
