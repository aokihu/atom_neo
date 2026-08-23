import { Modal } from "../modal";
import type { ModalAction } from "../modal";
import { useTheme } from "../theme";
import type { WizardState } from "../wizard-logic";

const ACTIONS: ModalAction[] = [
  { key: "back", label: "Back", role: "cancel" },
  { key: "save", label: "Save & Exit", role: "confirm", variant: "primary" },
];

function maskKey(key: string): string {
  if (!key) return "(not set)";
  if (key.length <= 6) return "*".repeat(key.length);
  return `${key.slice(0, 6)}***`;
}

export function ConfirmModal({ state, onSave, onBack }: {
  state: WizardState;
  onSave: () => void;
  onBack: () => void;
}) {
  const { colors } = useTheme();
  const entries = Object.entries(state.editedProviders);

  return (
    <Modal
      open
      title="SAVE & EXIT"
      width={64}
      actions={ACTIONS}
      defaultActionKey="save"
      onClose={onBack}
      onAction={(key) => {
        if (key === "save") onSave();
        else onBack();
      }}
      hint="Enter save · Esc back"
    >
      <box flexDirection="column">
        <text fg={colors.text.secondary}>Configuration summary:</text>
        {entries.length === 0 && <text fg={colors.text.muted}>  (no provider changes)</text>}
        {entries.map(([id, edit]) => (
          <box key={id} flexDirection="column">
            <box flexDirection="row">
              <text fg={colors.accent.brand} width={20}>{id}</text>
              <text fg={colors.text.primary}>{edit.models.join(", ")}</text>
            </box>
            <box flexDirection="row">
              <text fg={colors.text.muted} width={20}>  apiKey</text>
              <text fg={colors.text.muted}>{maskKey(edit.apiKey)} ({edit.apiKeyEnv || "no env"})</text>
            </box>
          </box>
        ))}
        <box marginTop={1} flexDirection="row">
          <text fg={colors.text.secondary} width={20}>Profiles</text>
          <text fg={colors.text.primary}>{state.profiles.advanced} / {state.profiles.balanced} / {state.profiles.basic}</text>
        </box>
        <box flexDirection="row">
          <text fg={colors.text.secondary} width={20}>Theme</text>
          <text fg={colors.text.primary}>{state.theme}</text>
        </box>
        {state.mode === "config" && (
          <box flexDirection="row">
            <text fg={colors.text.secondary} width={20}>Gateway port</text>
            <text fg={colors.text.primary}>{state.gatewayPort}</text>
          </box>
        )}
      </box>
    </Modal>
  );
}
