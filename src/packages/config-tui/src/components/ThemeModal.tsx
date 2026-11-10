import { useState } from "react";
import { THEME_NAMES } from "@atom-neo/shared";
import { Modal } from "../modal";
import { useTheme } from "../theme";

export function ThemeModal({ theme, onSubmit, onBack }: {
  theme: string;
  onSubmit: (theme: string) => void;
  onBack: () => void;
}) {
  const { colors } = useTheme();
  const [selected, setSelected] = useState(Math.max(0, THEME_NAMES.indexOf(theme as (typeof THEME_NAMES)[number])));

  return (
    <Modal
      open
      title="THEME"
      width={48}
      onClose={onBack}
      listLength={THEME_NAMES.length}
      selectedListIndex={selected}
      onListNavigate={setSelected}
      onListActivate={(i) => onSubmit(THEME_NAMES[i])}
      hint="↑/↓ select · Enter choose · Esc back"
    >
      <box flexDirection="column">
        {THEME_NAMES.map((t, i) => {
          const isSelected = i === selected;
          return (
            <box key={t} flexDirection="row" backgroundColor={isSelected ? colors.decoration.subtle : undefined}>
              <text fg={isSelected ? colors.text.bright : colors.text.secondary} width={2}>{isSelected ? "▸" : " "}</text>
              <text fg={isSelected ? colors.accent.brand : colors.text.primary}>{t}</text>
              {t === theme && <text fg={colors.text.muted}>  (current)</text>}
            </box>
          );
        })}
      </box>
    </Modal>
  );
}
