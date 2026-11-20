import { MenuScreen } from "./menu-frame";
import type { MenuItem, MenuPreview } from "./menu-frame";

const ITEMS: MenuItem[] = [
  { key: "session", label: "Session", detail: "Chat and Core server" },
  { key: "gateway", label: "Gateway", detail: "Workspace-confirmed shortcut" },
  { key: "configure", label: "Configure", detail: "Workspace and advanced settings" },
  { key: "backup", label: "Backup", detail: "Export or import sandbox config" },
  { key: "quit", label: "Quit", detail: "Close Atom Neo" },
];

const PREVIEWS: Record<string, MenuPreview> = {
  session: { title: "SESSION", lines: ["Chat with the current agent.", "", "New, continue, history or Core server."] },
  gateway: { title: "GATEWAY", lines: ["Confirm the workspace before Gateway.", "", "Install, load, edit and start clients."] },
  configure: { title: "CONFIGURE", lines: ["Workspace, providers, models,", "decisions, theme and Gateway.", "", "Save & Exit writes config.json/.env."] },
  backup: { title: "BACKUP", lines: ["Export or import config.json/.env.", "", "Encrypted or plaintext archives."] },
  quit: { title: "QUIT", lines: ["Close Atom Neo.", "", "Enter to confirm."] },
};

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
      preview={(item) => PREVIEWS[item.key] ?? { title: item.label.toUpperCase(), lines: [item.detail ?? ""] }}
      onSelect={onSelect}
      onBack={onBack}
      hint="↑/↓ move · Enter open · Esc quit"
      error={error}
    />
  );
}
