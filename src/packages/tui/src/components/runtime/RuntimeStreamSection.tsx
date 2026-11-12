import { useTheme } from "@atom-neo/tui-kit";
import { buildNormalizedStreamActivity, estimateReceivedTokens } from "../format";
import { RuntimeSection } from "./RuntimeSection";

export function RuntimeStreamSection({
  receivedChars,
  chunkCount,
  tokenBatches,
}: {
  receivedChars: number;
  chunkCount: number;
  tokenBatches: number[];
}) {
  const { colors } = useTheme();
  const receivedTokens = estimateReceivedTokens(receivedChars);
  return <RuntimeSection title="STREAM">
    <text fg={chunkCount > 0 ? colors.text.secondary : colors.text.muted}>
      {buildNormalizedStreamActivity(tokenBatches)}
    </text>
    <box flexDirection="row" justifyContent="space-between">
      <text fg={colors.text.muted}>{`≈${receivedTokens.toLocaleString()} TOK`}</text>
      <text fg={colors.text.muted}>{`${chunkCount} CH`}</text>
    </box>
  </RuntimeSection>;
}
