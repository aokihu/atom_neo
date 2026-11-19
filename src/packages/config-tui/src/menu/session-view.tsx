import { MenuScreen } from "./menu-frame";

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
