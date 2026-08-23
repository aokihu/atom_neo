import { useState } from "react";
import { Modal } from "../modal";
import { useTheme } from "../theme";
import type { WizardState } from "../wizard-logic";

export const MENU_KEYS = ["providers", "profiles", "theme", "gateway", "save"] as const;
export type MenuKey = (typeof MENU_KEYS)[number];

export function buildMenuItems(state: WizardState): { label: string; value: MenuKey }[] {
  const providerCount = Object.keys(state.editedProviders).length;
  return [
    { label: `Providers (${providerCount})`, value: "providers" },
    { label: "Model Profiles", value: "profiles" },
    { label: `Theme (${state.theme})`, value: "theme" },
    { label: `Gateway (port ${state.gatewayPort})`, value: "gateway" },
    { label: "Save & Exit", value: "save" },
  ];
}

/** Detail lines shown in the left panel for the currently selected menu item. */
export function describeSelection(key: MenuKey, state: WizardState): string[] {
  switch (key) {
    case "providers": {
      const entries = Object.entries(state.editedProviders);
      if (entries.length === 0) {
        return [
          "No providers configured yet.",
          "",
          "Open Providers and use",
          "➕ Add Provider to create one",
          "(deepseek / openai / custom).",
        ];
      }
      const lines: string[] = [];
      for (const [id, edit] of entries) {
        lines.push(id);
        lines.push(`  models: ${edit.models.join(", ")}`);
        lines.push(`  thinking: ${edit.thinking}${edit.contextLimit ? ` · ctx ${edit.contextLimit}` : ""}`);
        lines.push("");
      }
      return lines.slice(0, -1);
    }
    case "profiles":
      return [
        "advanced:",
        `  ${state.profiles.advanced}`,
        "balanced:",
        `  ${state.profiles.balanced}`,
        "basic:",
        `  ${state.profiles.basic}`,
      ];
    case "theme":
      return [
        `Current: ${state.theme}`,
        "",
        "8 themes available.",
        "Changes apply immediately",
        "and persist on save.",
      ];
    case "gateway":
      return [
        `Port: ${state.gatewayPort}`,
        "",
        "Takes effect on the next",
        "start. Clients are configured",
        "manually in config.json.",
      ];
    case "save":
      return [
        "Writes:",
        "  config.json (merged)",
        "  .env (API keys only)",
        "",
        "Runtime overlay and other",
        "files stay untouched.",
      ];
  }
}

export function MenuModal({ state, onSelect, onClose }: {
  state: WizardState;
  onSelect: (key: MenuKey) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const items = buildMenuItems(state);
  const [selected, setSelected] = useState(0);
  const details = describeSelection(items[selected].value, state);

  return (
    <Modal
      open
      title="CONFIGURATION"
      width={96}
      height={16}
      onClose={onClose}
      listLength={items.length}
      selectedListIndex={selected}
      onListNavigate={setSelected}
      onListActivate={(i) => onSelect(items[i].value)}
      hint="↑/↓ select · Enter open · Esc quit"
    >
      <box flexDirection="row" flexGrow={1}>
        <box
          flexDirection="column"
          flexGrow={1}
          flexBasis={0}
          paddingRight={1}
          marginRight={1}
          border={["right"]}
          borderStyle="single"
          borderColor={colors.border.default}
        >
          {items.map((item, i) => {
            const isSelected = i === selected;
            return (
              <box key={item.value} flexDirection="row" backgroundColor={isSelected ? colors.decoration.subtle : undefined}>
                <text fg={isSelected ? colors.text.bright : colors.text.secondary} width={2}>{isSelected ? "▸" : " "}</text>
                <text fg={isSelected ? colors.accent.brand : colors.text.primary}>{item.label}</text>
              </box>
            );
          })}
        </box>
        <box flexDirection="column" flexGrow={1} flexBasis={0} paddingLeft={1}>
          <text fg={colors.text.secondary}>{items[selected].label}</text>
          <box marginTop={1} flexDirection="column">
            {details.map((line, i) => (
              <text key={i} fg={colors.text.muted}>{line || " "}</text>
            ))}
          </box>
        </box>
      </box>
    </Modal>
  );
}
