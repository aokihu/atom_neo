import { MenuScreen } from "./menu-frame";
import type { MenuPreview } from "./menu-frame";

function previewFor(key: string, core: string): MenuPreview {
  if (key === "new") return { title: "NEW CHAT", lines: ["Start a fresh TUI session.", "", "Enter to open."] };
  if (key === "continue") return { title: "CONTINUE CHAT", lines: ["Resume the latest TUI session.", "", "Enter to open."] };
  if (key === "history") return { title: "HISTORY", lines: [core === "online" ? "List sessions from the running Core." : "Core is offline.", "", "Open or delete sessions."] };
  if (key === "core") return { title: "CORE SERVER", lines: ["Start, stop or attach Core.", "", "Uses the current workspace."] };
  return { title: "BACK", lines: ["Return to Home.", "", "Esc back."] };
}

export function SessionView({ workspace, gateway, core, onChat, onHistory, onCoreServer, onBack }: {
  workspace: string;
  gateway: "online" | "offline" | "unknown";
  core: "online" | "offline" | "unknown";
  onChat: (continueSession: boolean) => void;
  onHistory: () => void;
  onCoreServer: () => void;
  onBack: () => void;
}) {
  return (
    <MenuScreen
      title="Session"
      workspace={workspace}
      gateway={gateway}
      core={core}
      items={[
        { key: "new", label: "New Chat" },
        { key: "continue", label: "Continue Chat" },
        { key: "history", label: "History", detail: core === "online" ? "Sessions on this Core" : "Core offline" },
        { key: "core", label: "Core Server", detail: "Start / Stop / Attach" },
        { key: "back", label: "‹ Back" },
      ]}
      preview={(item) => previewFor(item.key, core)}
      onSelect={(key) => {
        if (key === "new") onChat(false);
        else if (key === "continue") onChat(true);
        else if (key === "history") onHistory();
        else if (key === "core") onCoreServer();
        else onBack();
      }}
      onBack={onBack}
      hint="↑/↓ move · Enter open · Esc back"
    />
  );
}
