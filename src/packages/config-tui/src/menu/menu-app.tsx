import { useEffect, useState } from "react";
import { ThemeProvider } from "@atom-neo/tui-kit";
import { GatewayModal } from "../components/GatewayModal";
import { MenuHome } from "./menu-home";
import { MenuConfirm, MenuPrompt, MenuScreen } from "./menu-frame";
import { WorkspaceGate } from "./workspace-gate";
import { ROUTE_LABELS, routeFor } from "./menu-routes";
import type { MenuRoute } from "./menu-routes";
import type { MenuActions, MenuInitialRoute, MenuLaunch } from "./menu-types";

export function MenuApp({ sandbox, workspaceExplicit = false, initialRoute = "home", actions, onExit }: {
  sandbox: string;
  workspaceExplicit?: boolean;
  initialRoute?: MenuInitialRoute;
  actions: MenuActions;
  onExit: (launch?: MenuLaunch) => void;
}) {
  const [workspace, setWorkspace] = useState(sandbox);
  const [route, setRoute] = useState<MenuRoute>(() => routeFor(initialRoute, actions.hasConfig(sandbox), workspaceExplicit));
  const [gateway, setGateway] = useState<"online" | "offline" | "unknown">("unknown");
  const [core, setCore] = useState<"online" | "offline" | "unknown">("unknown");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [quitConfirm, setQuitConfirm] = useState(false);

  const refreshStatuses = async () => {
    const [gatewayState, coreState] = await Promise.all([
      actions.gatewayStatus().catch(() => "offline" as const),
      actions.coreStatus().catch(() => "offline" as const),
    ]);
    setGateway(gatewayState);
    setCore(coreState);
  };

  useEffect(() => {
    void refreshStatuses();
  }, [workspace, route.name]);

  const go = (next: MenuRoute) => {
    setError("");
    setNotice("");
    setRoute(next);
  };

  const back = () => {
    if (route.name === "home") {
      setQuitConfirm(true);
      return;
    }
    setError("");
    setNotice("");
    if (route.name === "gateway-real") {
      setRoute(route.back === "advanced" ? { name: "advanced" } : route.back === "gateway-shortcut" ? { name: "gateway-shortcut" } : { name: "configure" });
      return;
    }
    if (route.name === "gateway-shortcut") return setRoute({ name: "home" });
    if (route.name === "configure") return setRoute({ name: "home" });
    if (route.name === "advanced") return setRoute({ name: "configure" });
    if (route.name === "workspace") {
      if (route.after === "gateway-real") return setRoute({ name: "configure" });
      return setRoute(route.after === "gateway-shortcut" ? { name: "gateway-shortcut" } : { name: "configure" });
    }
    if (route.name === "session") return setRoute({ name: "home" });
    if (route.name === "history" || route.name === "core-server") return setRoute({ name: "session" });
    if (route.name === "backup") return setRoute({ name: "home" });
    if (route.name === "backup-export" || route.name === "backup-import") return setRoute({ name: "backup" });
    if (route.name === "wizard") return setRoute({ name: "advanced" });
    return setRoute({ name: "home" });
  };

  const statusProps = { workspace, gateway, core, error };

  return (
    <ThemeProvider theme={actions.theme}>
      {quitConfirm ? (
        <MenuConfirm
          title="Quit"
          message="Quit Atom Neo without applying pending changes?"
          confirmLabel="Quit"
          onConfirm={() => onExit()}
          onCancel={() => setQuitConfirm(false)}
        />
      ) : route.name === "home" ? (
        <MenuHome
          {...statusProps}
          onSelect={(key) => {
            if (key === "session") go({ name: "session" });
            else if (key === "gateway") go({ name: "gateway-shortcut" });
            else if (key === "configure") go({ name: "configure" });
            else if (key === "backup") go({ name: "backup" });
            else setQuitConfirm(true);
          }}
          onBack={() => setQuitConfirm(true)}
        />
      ) : route.name === "session" ? (
        <MenuScreen
          title="Session"
          {...statusProps}
          items={[
            { key: "new", label: "New Chat" },
            { key: "continue", label: "Continue Chat" },
            { key: "history", label: "History", detail: "Session features are added in M2" },
            { key: "core", label: "Core Server", detail: "Session features are added in M2" },
            { key: "back", label: "‹ Back" },
          ]}
          onSelect={(key) => {
            if (key === "new") onExit({ kind: "chat", sandbox: workspace, continueSession: false });
            else if (key === "continue") onExit({ kind: "chat", sandbox: workspace, continueSession: true });
            else if (key === "back") back();
          }}
          onBack={back}
          hint="↑/↓ move · Enter open · Esc back"
        />
      ) : route.name === "gateway-shortcut" ? (
        <WorkspaceGate
          workspace={workspace}
          gateway={gateway}
          core={core}
          error={error || actions.validateWorkspace(workspace)}
          onContinue={() => {
            const problem = actions.validateWorkspace(workspace);
            if (problem) setError(problem);
            else go({ name: "gateway-real", back: "gateway-shortcut" });
          }}
          onChange={() => go({ name: "workspace", after: "gateway-shortcut" })}
          onBack={back}
        />
      ) : route.name === "gateway-real" ? (
        <GatewayModal
          sandbox={workspace}
          port={actions.gatewayPort}
          gatewayActions={actions.gateway}
          onSubmit={actions.setGatewayPort}
          onBack={back}
        />
      ) : route.name === "configure" ? (
        <MenuScreen
          title="Configure"
          {...statusProps}
          items={[
            { key: "workspace", label: "Workspace path ›", detail: workspace },
            { key: "advanced", label: "Advanced configuration ›" },
            { key: "back", label: "‹ Back" },
          ]}
          onSelect={(key) => key === "workspace" ? go({ name: "workspace", after: "configure" }) : key === "advanced" ? go({ name: "advanced" }) : back()}
          onBack={back}
          hint="↑/↓ move · Enter open · Esc back"
        />
      ) : route.name === "advanced" ? (
        <MenuScreen
          title="Advanced"
          {...statusProps}
          items={[
            { key: "providers", label: "Providers & Models", detail: "Added in M3" },
            { key: "theme", label: "Theme", detail: "Added in M3" },
            { key: "gateway", label: "Gateway ›", detail: "Instance and credential management" },
            { key: "back", label: "‹ Back" },
          ]}
          onSelect={(key) => key === "gateway" ? go({ name: "gateway-real", back: "advanced" }) : back()}
          onBack={back}
          hint="↑/↓ move · Enter open · Esc back"
        />
      ) : route.name === "workspace" ? (
        <MenuPrompt
          title="Workspace"
          label="Workspace path"
          value={workspace}
          placeholder={workspace}
          error={error}
          onSubmit={(value) => {
            const problem = actions.validateWorkspace(value);
            if (problem) {
              setError(problem);
              return;
            }
            setWorkspace(value);
            actions.setWorkspace(value);
            if (route.after === "gateway-real") go({ name: "gateway-real", back: "configure" });
            else if (route.after === "gateway-shortcut") go({ name: "gateway-shortcut" });
            else go({ name: "configure" });
          }}
          onCancel={back}
          hint="Enter save · Esc back"
        />
      ) : route.name === "backup" ? (
        <MenuScreen
          title="Backup"
          {...statusProps}
          items={[
            { key: "export", label: "Export ›", detail: "Added in M4" },
            { key: "import", label: "Import ›", detail: "Added in M4" },
            { key: "back", label: "‹ Back" },
          ]}
          onSelect={back}
          onBack={back}
          hint="↑/↓ move · Enter open · Esc back"
        />
      ) : (
        <MenuScreen
          title={ROUTE_LABELS[route.name]}
          {...statusProps}
          items={[{ key: "back", label: "‹ Back" }]}
          onSelect={back}
          onBack={back}
          hint="Esc back"
          notice={notice}
        />
      )}
    </ThemeProvider>
  );
}
