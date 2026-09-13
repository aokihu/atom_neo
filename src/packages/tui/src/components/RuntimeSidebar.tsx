import { useEffect, useRef, useState } from "react";
import type { Message, ToolPhase } from "../types";
import { useChatStore } from "../stores/chat";
import { useTheme } from "./App";
import { EmptyState } from "./EmptyState";
import {
  buildNormalizedStreamActivity,
  estimateReceivedTokens,
  formatUptime,
} from "./format";
import { PanelTitle } from "./PanelTitle";

type PipelineState = "IDLE" | "WAIT" | "RUN" | "OK" | "ERR";

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

function phaseCount(messages: Message[], phase: ToolPhase): number {
  return messages.reduce((count, message) => (
    message.role === "tool-group"
      ? count + message.entries.filter(entry => entry.phase === phase).length
      : count
  ), 0);
}

export function RuntimeSidebar() {
  const { colors } = useTheme();
  const messages = useChatStore(state => state.messages);
  const busy = useChatStore(state => state.busy);
  const preparing = useChatStore(state => state.showPreparing);
  const streamReceivedChars = useChatStore(state => state.streamReceivedChars);
  const streamChunkCount = useChatStore(state => state.streamChunkCount);
  const streamTokenBatches = useChatStore(state => state.streamTokenBatches);
  const [uptime, setUptime] = useState(0);
  const startRef = useRef(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setUptime(Math.floor((Date.now() - startRef.current) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  const steps = derivePipelineSteps(messages, busy, preparing);
  const completed = phaseCount(messages, "done");
  const failed = phaseCount(messages, "error");
  const receivedTokens = estimateReceivedTokens(streamReceivedChars);

  const stateColor = (state: PipelineState) => (
    state === "RUN" ? colors.status.warning
      : state === "OK" ? colors.status.success
        : state === "ERR" ? colors.status.error
          : colors.text.muted
  );

  return (
    <box
      width={26}
      flexShrink={0}
      flexDirection="column"
      border={["right"]}
      borderColor={colors.decoration.subtle}
      borderStyle="single"
      overflow="hidden"
      backgroundColor={colors.bg.page}
    >
      <PanelTitle title="RUNTIME" />

      <box
        flexDirection="column"
        marginLeft={1}
        marginRight={1}
        marginBottom={1}
        paddingLeft={1}
        border={["left"]}
        borderColor={colors.decoration.subtle}
      >
        <box flexDirection="row" justifyContent="space-between">
          <text fg={colors.text.muted}>SESSION</text>
          <text fg={busy ? colors.status.warning : colors.text.muted}>{busy ? "ACTIVE" : "IDLE"}</text>
        </box>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={colors.text.muted}>UPTIME</text>
          <text fg={colors.text.muted}>{formatUptime(uptime)}</text>
        </box>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={colors.text.muted}>QUEUE</text>
          {busy ? <text fg={colors.text.muted}>1 ACTIVE</text> : <EmptyState />}
        </box>
      </box>

      <box
        flexDirection="column"
        marginLeft={1}
        marginRight={1}
        marginBottom={1}
        paddingLeft={1}
        border={["left"]}
        borderColor={colors.decoration.subtle}
      >
        <text fg={colors.text.muted}>PIPELINE</text>
        {steps.map((step, index) => (
          <box key={step.label} flexDirection="row">
            <text width={3} fg={step.state === "RUN" ? colors.accent.brand : colors.text.muted}>
              {step.state === "RUN" ? "›" : String(index + 1).padStart(2, "0")}
            </text>
            <text flexGrow={1} fg={step.state === "RUN" ? colors.text.secondary : colors.text.muted}>
              {step.label}
            </text>
            <text fg={step.state === "OK" ? colors.text.muted : stateColor(step.state)}>{step.state}</text>
          </box>
        ))}
      </box>

      <box
        flexDirection="column"
        marginLeft={1}
        marginRight={1}
        marginBottom={1}
        paddingLeft={1}
        border={["left"]}
        borderColor={colors.decoration.subtle}
      >
        <text fg={colors.text.muted}>STREAM</text>
        <text fg={streamChunkCount > 0 ? colors.text.secondary : colors.text.muted}>
          {buildNormalizedStreamActivity(streamTokenBatches)}
        </text>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={colors.text.muted}>{`≈${receivedTokens.toLocaleString()} TOK`}</text>
          <text fg={colors.text.muted}>{`${streamChunkCount} CH`}</text>
        </box>
      </box>

      <box
        flexDirection="column"
        marginLeft={1}
        marginRight={1}
        paddingLeft={1}
        border={["left"]}
        borderColor={colors.decoration.subtle}
      >
        <text fg={colors.text.muted}>STATS</text>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={colors.text.muted}>MESSAGES</text>
          <text fg={colors.text.muted}>{messages.length}</text>
        </box>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={colors.text.muted}>TOOLS OK</text>
          <text fg={colors.text.muted}>{completed}</text>
        </box>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={colors.text.muted}>TOOLS ERR</text>
          <text fg={failed > 0 ? colors.status.error : colors.text.muted}>{failed}</text>
        </box>
      </box>
    </box>
  );
}
