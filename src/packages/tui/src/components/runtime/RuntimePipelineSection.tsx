import { useTheme } from "@atom-neo/tui-kit";
import { RuntimeSection, stateColor } from "./RuntimeSection";
import type { PipelineStep } from "./runtime-steps";

export function RuntimePipelineSection({ steps }: { steps: PipelineStep[] }) {
  const { colors } = useTheme();
  return <RuntimeSection title="PIPELINE">
    {steps.map((step, index) => (
      <box key={step.label} flexDirection="row">
        <text width={3} fg={step.state === "RUN" ? colors.accent.brand : colors.text.muted}>
          {step.state === "RUN" ? "›" : String(index + 1).padStart(2, "0")}
        </text>
        <text flexGrow={1} fg={step.state === "RUN" ? colors.text.secondary : colors.text.muted}>
          {step.label}
        </text>
        <text fg={step.state === "OK" ? colors.text.muted : stateColor(colors, step.state)}>{step.state}</text>
      </box>
    ))}
  </RuntimeSection>;
}
