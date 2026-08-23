import { useState } from "react";
import { Modal } from "../modal";
import { useTheme } from "../theme";
import { THEMES } from "../wizard-logic";

export function ThemeModal({ theme, onSubmit, onBack }: {
  theme: string;
  onSubmit: (theme: string) => void;
  onBack: () => void;
}) {
  const { colors } = useTheme();
  const [selected, setSelected] = useState(Math.max(0, THEMES.indexOf(theme as (typeof THEMES)[number])));

  return (
    <Modal
      open
      title="THEME"
      width={48}
      onClose={onBack}
      listLength={THEMES.length}
      selectedListIndex={selected}
      onListNavigate={setSelected}
      onListActivate={(i) => onSubmit(THEMES[i])}
      hint="↑/↓ select · Enter choose · Esc back"
    >
      <box flexDirection="column">
        {THEMES.map((t, i) => {
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
