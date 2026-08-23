import { useState } from "react";
import { Modal } from "../modal";
import type { ModalAction } from "../modal";
import { useTheme } from "../theme";

const LEVELS = ["advanced", "balanced", "basic"] as const;

const LEVEL_LABELS: Record<string, string> = {
  advanced: "Advanced (complex tasks)",
  balanced: "Balanced (daily use)",
  basic: "Basic (quick tasks)",
};

const ACTIONS: ModalAction[] = [
  { key: "back", label: "Back", role: "cancel" },
  { key: "save", label: "Save", role: "confirm", variant: "primary" },
];

export function ProfilesModal({ profiles, modelIds, onSubmit, onBack }: {
  profiles: { advanced: string; balanced: string; basic: string };
  modelIds: string[];
  onSubmit: (profiles: { advanced: string; balanced: string; basic: string }) => void;
  onBack: () => void;
}) {
  const { colors } = useTheme();
  const [draft, setDraft] = useState({ ...profiles });
  const [levelIndex, setLevelIndex] = useState(0);

  const options = modelIds.length > 0 ? modelIds : [profiles.balanced];

  const cycle = (index: number) => {
    const level = LEVELS[index];
    setDraft(prev => {
      const i = options.indexOf(prev[level]);
      return { ...prev, [level]: options[(i + 1) % options.length] };
    });
  };

  return (
    <Modal
      open
      title="MODEL PROFILES"
      width={60}
      actions={ACTIONS}
      defaultActionKey="save"
      onClose={onBack}
      onAction={(key) => {
        if (key === "save") onSubmit(draft);
        else onBack();
      }}
      listLength={LEVELS.length}
      selectedListIndex={levelIndex}
      onListNavigate={setLevelIndex}
      onListActivate={cycle}
      hint="↑/↓ level · Enter cycle model · Tab actions"
    >
      <box flexDirection="column">
        {LEVELS.map((level, i) => {
          const isSelected = i === levelIndex;
          return (
            <box key={level} flexDirection="row" backgroundColor={isSelected ? colors.decoration.subtle : undefined}>
              <text fg={isSelected ? colors.text.bright : colors.text.secondary} width={2}>{isSelected ? "▸" : " "}</text>
              <text fg={isSelected ? colors.accent.brand : colors.text.primary} width={28}>{LEVEL_LABELS[level]}</text>
              <text fg={isSelected ? colors.text.bright : colors.text.primary}>{draft[level]}</text>
            </box>
          );
        })}
      </box>
    </Modal>
  );
}
