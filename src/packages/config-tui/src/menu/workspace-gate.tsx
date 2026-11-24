import { useKeyboard } from "@opentui/react";
import { MenuScreen } from "./menu-frame";
import type { MenuPreview } from "./menu-frame";

export function WorkspaceGate({ workspace, gateway, core, error, onContinue, onChange, onBack }: {
  workspace: string;
  gateway: "online" | "offline" | "unknown";
  core: "online" | "offline" | "unknown";
  error?: string;
  onContinue: () => void;
  onChange: () => void;
  onBack: () => void;
}) {
  useKeyboard((event) => {
    if (event.name === "c" && !event.ctrl && !event.meta) onChange();
  });

  return (
    <MenuScreen
      title="Gateway"
      workspace={workspace}
      gateway={gateway}
      core={core}
      items={[
        { key: "continue", label: "Continue to Gateway configuration" },
        { key: "change", label: "Change workspace ›" },
        { key: "back", label: "‹ Back" },
      ]}
      preview={(item): MenuPreview => {
        if (item.key === "continue") return { title: "GATEWAY", lines: ["Open Gateway configuration", "for the current workspace.", "", workspace] };
        if (item.key === "change") return { title: "CHANGE WORKSPACE", lines: ["Choose another workspace", "before Gateway configuration."] };
        return { title: "BACK", lines: ["Return to Home.", "", "Esc back."] };
      }}
      onSelect={(key) => key === "continue" ? onContinue() : key === "change" ? onChange() : onBack()}
      onBack={onBack}
      hint="Enter continue · C change · Esc back"
      error={error}
    >
      <box flexDirection="column" marginBottom={1}>
        <text>Gateway configuration uses this workspace.</text>
        <text>{workspace}</text>
      </box>
    </MenuScreen>
  );
}
