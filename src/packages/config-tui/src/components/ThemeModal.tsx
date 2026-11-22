import { useState } from "react";
import { THEME_NAMES } from "@atom-neo/shared";
import { THEMES, SelectableRow, useTheme } from "@atom-neo/tui-kit";
import { Modal } from "../modal";
import { MenuScreen } from "../menu/menu-frame";
import type { MenuPreview } from "../menu/menu-frame";
import type { WizardChrome } from "./WizardApp";

const THEME_SET = new Set<string>(THEME_NAMES);

function themePreview(previewName: string, appliedName: string): MenuPreview {
  const colors = THEMES[previewName as keyof typeof THEMES] ?? THEMES.edex;
  return {
    title: "THEME PREVIEW",
    lines: [
      `Preview: ${previewName}`,
      `Current: ${appliedName}`,
      `background  ${colors.bg.page}`,
      `text        ${colors.text.primary}`,
      `accent      ${colors.accent.brand}`,
      "",
      "Enter applies to this TUI.",
      "Save & Exit persists to config.json.",
    ],
    content: (
      <box flexDirection="column">
        <text fg={colors.bg.page}>███ background</text>
        <text fg={colors.text.primary}>███ text</text>
        <text fg={colors.accent.brand}>███ accent</text>
      </box>
    ),
  };
}

export function ThemeModal({ theme, chrome, onSubmit, onBack }: {
  theme: string;
  chrome?: WizardChrome;
  onSubmit: (theme: string) => void;
  onBack: () => void;
}) {
  const { colors } = useTheme();
  const [selected, setSelected] = useState(Math.max(0, THEME_NAMES.indexOf(theme as (typeof THEME_NAMES)[number])));

  if (chrome) {
    return (
      <MenuScreen
        title="Theme"
        breadcrumb="Home / Configure / Theme"
        workspace={chrome.workspace}
        gateway={chrome.gateway}
        core={chrome.core}
        initialSelection={Math.max(0, THEME_NAMES.indexOf(theme as (typeof THEME_NAMES)[number]))}
        items={THEME_NAMES.map(name => ({ key: name, label: name, detail: name === theme ? "current" : undefined }))}
        preview={item => themePreview(item.key, theme)}
        onSelect={key => {
          if (THEME_SET.has(key)) onSubmit(key);
        }}
        onBack={onBack}
        hint="↑/↓ move · Enter apply · Esc back"
      />
    );
  }

  return (
    <Modal
      open
      title="THEME"
      width={48}
      onClose={onBack}
      listLength={THEME_NAMES.length}
      selectedListIndex={selected}
      onListNavigate={setSelected}
      onListActivate={(i) => onSubmit(THEME_NAMES[i]!)}
      hint="↑/↓ select · Enter choose · Esc back"
    >
      <box flexDirection="column">
        {THEME_NAMES.map((name, index) => (
          <SelectableRow
            key={name}
            selected={index === selected}
            label={name}
            trailing={name === theme ? <text fg={colors.text.muted}>  (current)</text> : undefined}
          />
        ))}
      </box>
    </Modal>
  );
}
