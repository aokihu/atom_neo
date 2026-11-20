import { useEffect, useState } from "react";
import { ThemeProvider } from "@atom-neo/tui-kit";
import { GatewayModal } from "../components/GatewayModal";
import { WizardApp } from "../components/WizardApp";
import { MenuHome } from "./menu-home";
import { MenuChromeProvider, MenuConfirm, MenuPrompt } from "./menu-frame";
import { SessionView } from "./session-view";
import { HistoryView } from "./history-view";
import { CoreServerView } from "./core-server-view";
import { BackupExportView, BackupImportView, BackupView } from "./backup-view";
import { WorkspaceGate } from "./workspace-gate";
import { breadcrumbFor, routeFor } from "./menu-routes";
import type { MenuRoute } from "./menu-routes";
import type { MenuActions, MenuInitialRoute, MenuLaunch } from "./menu-types";

export function MenuApp({ sandbox, initialRoute = "home", initialError, version, actions, onExit }: {
  sandbox: string;
  initialRoute?: MenuInitialRoute;
  initialError?: string;
  version?: string;
  actions: MenuActions;
  onExit: (launch?: MenuLaunch) => void;
}) {
  const [workspace, setWorkspace] = useState(sandbox);
  const [theme, setTheme] = useState(actions.theme);
  const [gatewayPort, setGatewayPort] = useState(actions.gatewayPort);
  const [route, setRoute] = useState<MenuRoute>(() => routeFor(initialRoute, actions.hasConfig(sandbox)));
  const [gateway, setGateway] = useState<"online" | "offline" | "unknown">("unknown");
  const [core, setCore] = useState<"online" | "offline" | "unknown">("unknown");
  const [error, setError] = useState(initialError ?? "");
  const [notice, setNotice] = useState("");
  const [quitConfirm, setQuitConfirm] = useState(false);
  const [workspaceEditing, setWorkspaceEditing] = useState(false);

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
    setWorkspaceEditing(false);
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
      setRoute(route.back === "gateway-shortcut" ? { name: "gateway-shortcut" } : { name: "configure" });
      return;
    }
    if (route.name === "gateway-shortcut") return setRoute({ name: "home" });
    if (route.name === "configure") return setRoute({ name: "home" });
    if (route.name === "workspace") {
      if (route.after === "gateway-real") return setRoute({ name: "configure" });
      return setRoute(route.after === "gateway-shortcut" ? { name: "gateway-shortcut" } : { name: "configure" });
    }
    if (route.name === "session") return setRoute({ name: "home" });
    if (route.name === "history" || route.name === "core-server") return setRoute({ name: "session" });
    if (route.name === "backup") return setRoute({ name: "home" });
    if (route.name === "backup-export" || route.name === "backup-import") return setRoute({ name: "backup" });
    return setRoute({ name: "home" });
  };

  const statusProps = { workspace, gateway, core, error };

  return (
    <ThemeProvider theme={theme}>
      <MenuChromeProvider version={version} breadcrumb={breadcrumbFor(route)}>
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
        <SessionView
          workspace={workspace}
          gateway={gateway}
          core={core}
          onChat={(continueSession) => onExit({ kind: "chat", sandbox: workspace, continueSession })}
          onHistory={() => go({ name: "history" })}
          onCoreServer={() => go({ name: "core-server" })}
          onBack={back}
        />
      ) : route.name === "history" ? (
        <HistoryView
          workspace={workspace}
          gateway={gateway}
          core={core}
          actions={actions}
          externalError={error}
          onBack={back}
          onRefreshStatus={() => { void refreshStatuses(); }}
          onOpen={(sessionId) => {
            void actions.coreTarget().then(target => {
              onExit({ kind: "attach", sandbox: workspace, sessionId, ...target });
            }).catch(caught => setError(caught instanceof Error ? caught.message : String(caught)));
          }}
        />
      ) : route.name === "core-server" ? (
        <CoreServerView
          workspace={workspace}
          gateway={gateway}
          core={core}
          actions={actions}
          onLaunch={onExit}
          onBack={back}
          onRefreshStatus={() => { void refreshStatuses(); }}
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
          port={gatewayPort}
          gatewayActions={actions.gateway}
          onSubmit={(port) => {
            actions.setGatewayPort(port);
            setGatewayPort(port);
          }}
          onBack={back}
        />
      ) : route.name === "configure" ? (
        <>
          <WizardApp
            sandboxPath={workspace}
            mode="config"
            initialView="menu"
            gatewayActions={actions.gateway}
            onComplete={() => {
              const settings = actions.refreshSettings();
              setTheme(settings.theme);
              setGatewayPort(settings.gatewayPort);
              setError("");
              setNotice("Saved");
            }}
            onAbort={() => go({ name: "home" })}
            chrome={{
              workspace,
              gateway,
              core,
              suspended: workspaceEditing,
              onWorkspace: () => setWorkspaceEditing(true),
              notice,
              error,
            }}
          />
          {workspaceEditing ? (
            <MenuPrompt
              title="Configure / Workspace"
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
                const normalized = actions.setWorkspace(value);
                const settings = actions.refreshSettings();
                setWorkspace(normalized);
                setTheme(settings.theme);
                setGatewayPort(settings.gatewayPort);
                setError("");
                setNotice("");
                setWorkspaceEditing(false);
              }}
              onCancel={() => {
                setError("");
                setWorkspaceEditing(false);
              }}
              hint="Enter save · Esc cancel"
            />
          ) : null}
        </>
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
            const normalized = actions.setWorkspace(value);
            const settings = actions.refreshSettings();
            setWorkspace(normalized);
            setTheme(settings.theme);
            setGatewayPort(settings.gatewayPort);
            if (route.after === "gateway-real") go({ name: "gateway-real", back: "configure" });
            else if (route.after === "gateway-shortcut") go({ name: "gateway-shortcut" });
            else go({ name: "configure" });
          }}
          onCancel={back}
          hint="Enter save · Esc back"
        />
      ) : route.name === "backup" ? (
        <BackupView
          {...statusProps}
          notice={notice}
          onExport={() => go({ name: "backup-export" })}
          onImport={() => go({ name: "backup-import" })}
          onBack={back}
        />
      ) : route.name === "backup-export" ? (
        <BackupExportView
          actions={actions}
          title="Backup / Export"
          onDone={(message) => {
            setRoute({ name: "backup" });
            setError("");
            setNotice(message);
          }}
          onBack={back}
        />
      ) : route.name === "backup-import" ? (
        <BackupImportView
          actions={actions}
          workspace={workspace}
          gateway={gateway}
          core={core}
          title="Backup / Import"
          onDone={(message) => {
            setRoute({ name: "backup" });
            setError("");
            setNotice(message);
          }}
          onBack={back}
        />
      ) : null}
      </MenuChromeProvider>
    </ThemeProvider>
  );
}
