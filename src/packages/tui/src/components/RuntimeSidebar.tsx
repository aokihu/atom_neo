import { useEffect, useRef, useState } from "react";
import { useTheme } from "@atom-neo/tui-kit";
import { useChatStore } from "../stores/chat";
import { PanelTitle } from "./PanelTitle";
import { RuntimeDecisionSection } from "./runtime/RuntimeDecisionSection";
import { RuntimePipelineSection } from "./runtime/RuntimePipelineSection";
import { RuntimeSessionSection } from "./runtime/RuntimeSessionSection";
import { RuntimeStatsSection } from "./runtime/RuntimeStatsSection";
import { RuntimeStreamSection } from "./runtime/RuntimeStreamSection";
import { derivePipelineSteps, phaseCount } from "./runtime/runtime-steps";

export type { PipelineState, PipelineStep } from "./runtime/runtime-steps";
export { derivePipelineSteps } from "./runtime/runtime-steps";

export function RuntimeSidebar() {
  const { colors } = useTheme();
  const messages = useChatStore(state => state.messages);
  const busy = useChatStore(state => state.busy);
  const preparing = useChatStore(state => state.showPreparing);
  const predictionDecision = useChatStore(state => state.predictionDecision);
  const postDecision = useChatStore(state => state.postDecision);
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
      <RuntimeSessionSection busy={busy} uptime={uptime} />
      <RuntimePipelineSection steps={steps} />
      <RuntimeDecisionSection prediction={predictionDecision} post={postDecision} />
      <RuntimeStreamSection receivedChars={streamReceivedChars} chunkCount={streamChunkCount} tokenBatches={streamTokenBatches} />
      <RuntimeStatsSection messages={messages.length} completed={phaseCount(messages, "done")} failed={phaseCount(messages, "error")} />
    </box>
  );
}
