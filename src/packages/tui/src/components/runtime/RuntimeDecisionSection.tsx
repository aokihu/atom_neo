import { useTheme } from "@atom-neo/tui-kit";
import type { DecisionUpdatePayload } from "@atom-neo/shared";
import { RuntimeSection, stateColor } from "./RuntimeSection";
import type { PipelineState } from "./runtime-steps";

export function RuntimeDecisionSection({
  prediction,
  post,
}: {
  prediction: DecisionUpdatePayload | null;
  post: DecisionUpdatePayload | null;
}) {
  const { colors } = useTheme();
  return <RuntimeSection title="DECISION">
    {([
      { label: "PREDICT", update: prediction },
      { label: "POST CHECK", update: post },
    ] as const).map(({ label, update }) => (
      <box key={label} flexDirection="column">
        <box flexDirection="row" justifyContent="space-between">
          <text fg={colors.text.muted}>{label}</text>
          <text fg={update ? stateColor(colors, update.state.toUpperCase() as PipelineState) : colors.text.muted}>
            {update ? `${update.source.toUpperCase()} ${update.state.toUpperCase()}` : "—"}
          </text>
        </box>
        {update?.state === "ok" && update.purpose === "prediction" && <>
          <text fg={colors.text.secondary}>{`INTENT ${update.intent ?? "—"}`}</text>
          <text fg={colors.text.secondary}>{`MODEL  ${update.modelProfile ?? "—"}`}</text>
          <text fg={colors.text.secondary}>{`TOPIC  ${(update.topic ?? "—").slice(0, 16)}`}</text>
        </>}
        {update?.state === "ok" && update.purpose === "post-conversation" && (
          <text fg={colors.text.secondary}>{`STATUS ${update.analysisStatus ?? "—"}`}</text>
        )}
      </box>
    ))}
  </RuntimeSection>;
}
