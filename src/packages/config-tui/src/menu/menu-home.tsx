import { MenuScreen } from "./menu-frame";
import type { MenuItem } from "./menu-frame";

const ITEMS: MenuItem[] = [
  { key: "session", label: "Session", detail: "Chat and Core server" },
  { key: "gateway", label: "Gateway", detail: "Workspace-confirmed shortcut" },
  { key: "configure", label: "Configure", detail: "Workspace and advanced settings" },
  { key: "backup", label: "Backup", detail: "Export or import sandbox config" },
  { key: "quit", label: "Quit", detail: "Close Atom Neo" },
];

export function MenuHome({ workspace, gateway, core, onSelect, onBack, error }: {
  workspace: string;
  gateway: "online" | "offline" | "unknown";
  core: "online" | "offline" | "unknown";
  onSelect: (key: string) => void;
  onBack: () => void;
  error?: string;
}) {
  return (
    <MenuScreen
      title="Home"
      workspace={workspace}
      gateway={gateway}
      core={core}
      items={ITEMS}
      onSelect={onSelect}
      onBack={onBack}
      hint="↑/↓ move · Enter open · Esc quit"
      error={error}
    />
  );
}
