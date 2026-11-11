import { useState } from "react";
import { Modal } from "../modal";
import type { ModalAction } from "../modal";
import { useTheme } from "@atom-neo/tui-kit";
import { DEFAULT_DECISION_MODES } from "../wizard-logic";
import type { DecisionModes, WizardState } from "../wizard-logic";

type DecisionSettings = DecisionModes & { fast?: string };

const MODE_ROWS = [
  { key: "prediction", label: "Prediction", alternative: "legacy" },
  { key: "postConversation", label: "Post-Conversation", alternative: "legacy" },
  { key: "continuation", label: "Continuation", alternative: "rules" },
] as const;

export function describeDecisions(state: WizardState): string[] {
  const modes = { ...DEFAULT_DECISION_MODES, ...state.decisionMode };
  return [
    `Fast: ${state.profiles.fast ?? "Use Basic"}`,
    ...MODE_ROWS.map(({ key, label }) => `${label}: ${modes[key]}`),
  ];
}

export function DecisionsModal({ state, modelIds, onSubmit, onProviders, onBack }: {
  state: WizardState;
  modelIds: string[];
  onSubmit: (settings: DecisionSettings) => void;
  onProviders: (settings: DecisionSettings) => void;
  onBack: () => void;
}) {
  const { colors } = useTheme();
  const [draft, setDraft] = useState<DecisionSettings>({
    ...DEFAULT_DECISION_MODES,
    ...state.decisionMode,
    fast: state.profiles.fast,
  });
  const [selected, setSelected] = useState(0);
  const fastOptions = [undefined, ...modelIds];
  const rows = [
    { label: "Fast model", value: draft.fast ?? "Use Basic" },
    ...MODE_ROWS.map(({ key, label }) => ({ label, value: draft[key] })),
  ];
  const actions: ModalAction[] = [
    { key: "back", label: "Back", role: "cancel" },
    { key: "providers", label: "Providers" },
    { key: "save", label: state.mode === "first-run" ? "Continue" : "Save", role: "confirm", variant: "primary" },
  ];

  function cycle(index: number) {
    if (index === 0) {
      const next = (fastOptions.indexOf(draft.fast) + 1) % fastOptions.length;
      setDraft({ ...draft, fast: fastOptions[next] });
      return;
    }
    const { key, alternative } = MODE_ROWS[index - 1];
    setDraft({ ...draft, [key]: draft[key] === "jev" ? alternative : "jev" });
  }

  return (
    <Modal open title="DECISIONS" width={76} actions={actions} defaultActionKey="save"
      listLength={rows.length} selectedListIndex={selected} onListNavigate={setSelected}
      onListActivate={cycle} onClose={onBack}
      onAction={key => {
        if (key === "save") onSubmit(draft);
        else if (key === "providers") onProviders(draft);
        else onBack();
      }}
      hint="↑/↓ select · Enter change · Tab/←/→ actions"
    >
      {rows.map(({ label, value }, index) => (
        <box key={label} flexDirection="row" backgroundColor={index === selected ? colors.decoration.subtle : undefined}>
          <text fg={colors.accent.brand} width={2}>{index === selected ? "▸" : " "}</text>
          <text fg={colors.text.secondary} width={22}>{label}</text>
          <text fg={colors.text.primary}>{value}</text>
        </box>
      ))}
      <box marginTop={1}>
        <text fg={colors.text.muted}>Jev modes use LLM simulation when Jev is unavailable.</text>
      </box>
    </Modal>
  );
}
