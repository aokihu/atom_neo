import { useState } from "react";
import { THEME_NAMES } from "@atom-neo/shared";
import { Modal } from "../modal";
import { SelectableRow, useTheme } from "@atom-neo/tui-kit";

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
        {THEME_NAMES.map((t, i) => (
          <SelectableRow
            key={t}
            selected={i === selected}
            label={t}
            trailing={t === theme ? <text fg={colors.text.muted}>  (current)</text> : undefined}
          />
        ))}
      </box>
    </Modal>
  );
}
