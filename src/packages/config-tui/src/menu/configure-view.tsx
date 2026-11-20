import { describeDecisions } from "../components/DecisionsModal";
import type { WizardAction, WizardMenuKey, WizardUiState } from "../wizard/wizard-reducer";
import type { WizardState } from "../wizard-logic";
import { MenuScreen } from "./menu-frame";
import type { MenuItem, MenuPreview } from "./menu-frame";

export const MENU_KEYS = ["providers", "profiles", "decisions", "theme", "gateway", "save"] as const;
export type MenuKey = (typeof MENU_KEYS)[number];

export function buildMenuItems(state: WizardState): { label: string; value: MenuKey }[] {
  const providerCount = Object.keys(state.editedProviders).length;
  return [
    { label: `Providers (${providerCount})`, value: "providers" },
    { label: "Model Profiles", value: "profiles" },
    { label: "Decisions", value: "decisions" },
    { label: `Theme (${state.theme})`, value: "theme" },
    { label: `Gateway (clients · port ${state.gatewayPort})`, value: "gateway" },
    { label: "Save & Exit", value: "save" },
  ];
}

/** Detail lines shown in the right preview for the selected Configure item. */
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
        lines.push(edit.type === "jev" ? `${id} (Jev)` : id);
        lines.push(`  models: ${edit.models.join(", ")}`);
        if (edit.type !== "jev") lines.push(`  thinking: ${edit.thinking}${edit.contextLimit ? ` · ctx ${edit.contextLimit}` : ""}`);
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
    case "decisions":
      return describeDecisions(state);
    case "gateway":
      return [
        `Port: ${state.gatewayPort}`,
        "",
        "Manage clients, install/load",
        "packages, edit credentials,",
        "register/start, and diagnose.",
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

export function ConfigureView({ ui, dispatch, workspace, gateway, core, suspended, onWorkspace, notice, error }: {
  ui: WizardUiState;
  dispatch: (action: WizardAction) => void;
  workspace: string;
  gateway: "online" | "offline" | "unknown";
  core: "online" | "offline" | "unknown";
  suspended?: boolean;
  onWorkspace: () => void;
  notice?: string;
  error?: string;
}) {
  const items: MenuItem[] = [
    { key: "workspace", label: "Workspace path", detail: workspace },
    ...buildMenuItems(ui.wizard).map(item => ({ key: item.value, label: item.label })),
    { key: "back", label: "‹ Back" },
  ];

  const preview = (item: MenuItem): MenuPreview => {
    if (item.key === "workspace") {
      return { title: "WORKSPACE PATH", lines: [workspace, "", "config.json · .env · .atom"] };
    }
    if (item.key === "back") {
      return { title: "BACK", lines: ["Return to Home.", "", "Unsaved changes ask for confirmation."] };
    }
    return {
      title: item.label.replace(/\(.*\)/, "").trim().toUpperCase(),
      lines: describeSelection(item.key as MenuKey, ui.wizard),
    };
  };

  return (
    <MenuScreen
      title="Configure"
      workspace={workspace}
      gateway={gateway}
      core={core}
      items={items}
      preview={preview}
      suspended={suspended}
      onSelect={(key) => {
        if (key === "workspace") onWorkspace();
        else if (key === "back") dispatch({ type: "quit-request" });
        else dispatch({ type: "menu-select", key: key as WizardMenuKey });
      }}
      onBack={() => dispatch({ type: "quit-request" })}
      hint="↑/↓ move · Enter open · Esc back"
      notice={notice}
      error={error}
    />
  );
}
