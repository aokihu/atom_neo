import { useState } from "react";
import { MenuScreen } from "./menu-frame";
import type { MenuPreview } from "./menu-frame";
import type { MenuActions, MenuLaunch } from "./menu-types";

export function CoreServerView({ workspace, gateway, core, actions, onLaunch, onBack, onRefreshStatus }: {
  workspace: string;
  gateway: "online" | "offline" | "unknown";
  core: "online" | "offline" | "unknown";
  actions: MenuActions;
  onLaunch: (launch: MenuLaunch) => void;
  onBack: () => void;
  onRefreshStatus: () => void;
}) {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const stop = async () => {
    if (core !== "online") {
      setError("Core is offline.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await actions.stopCore();
      let offline = false;
      for (let attempt = 0; attempt < 20 && !offline; attempt++) {
        offline = await actions.coreStatus().then(state => state === "offline", () => true);
        if (!offline) await new Promise((done) => setTimeout(done, 150));
      }
      setNotice(offline ? "Core stopped." : "Core shutdown requested; waiting for it to go offline.");
      onRefreshStatus();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const attach = async () => {
    if (core !== "online") {
      setError("Core is offline. Start or attach to a running server first.");
      return;
    }
    try {
      const target = await actions.coreTarget();
      onLaunch({ kind: "attach", sandbox: workspace, ...target });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <MenuScreen
      title="Session / Core Server"
      workspace={workspace}
      gateway={gateway}
      core={core}
      items={[
        { key: "start", label: "Start Server", detail: "Run Core in this terminal" },
        { key: "stop", label: "Stop Server", detail: core === "online" ? "Controlled admin shutdown" : "Core offline" },
        { key: "attach", label: "Attach Server", detail: core === "online" ? "Open the TUI" : "Core offline" },
        { key: "back", label: "‹ Back" },
      ]}
      preview={(item): MenuPreview => {
        if (item.key === "start") return { title: "START SERVER", lines: [core === "online" ? "Core already running." : "Run Core in this terminal.", "", core === "online" ? "Use Attach Server." : "Enter to start."] };
        if (item.key === "stop") return { title: "STOP SERVER", lines: [core === "online" ? "Request controlled shutdown." : "Core is offline.", "", "Uses the admin token."] };
        if (item.key === "attach") return { title: "ATTACH SERVER", lines: [core === "online" ? "Open the TUI with this Core." : "Core is offline.", "", "Enter to attach."] };
        return { title: "BACK", lines: ["Return to Session.", "", "Esc back."] };
      }}
      onSelect={(key) => {
        if (key === "start") {
          if (core === "online") {
            setError("Core already running; use Attach Server.");
            return;
          }
          setError("");
          onLaunch({ kind: "core", sandbox: workspace, ...actions.coreStartTarget() });
        } else if (key === "stop") void stop();
        else if (key === "attach") void attach();
        else onBack();
      }}
      onBack={onBack}
      hint={busy ? "Stopping Core…" : "↑/↓ move · Enter open · Esc back"}
      error={error}
      notice={notice}
    />
  );
}
