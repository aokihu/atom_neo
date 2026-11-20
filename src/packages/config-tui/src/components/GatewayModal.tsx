import { useEffect, useState } from "react";
import { FieldInput, SelectableRow, useTheme } from "@atom-neo/tui-kit";
import { Modal } from "../modal";
import { useMenuChrome } from "../menu/menu-frame";
import { parsePort } from "../wizard-logic";
import {
  fetchGatewayDiagnostics,
  fetchGatewayInstances,
  gatewayAction,
  saveGatewayInstance,
} from "../gateway-status";
import type {
  GatewayDiagnostics,
  GatewayInstanceActions,
  GatewayInstanceStatus,
} from "../gateway-status";
import { GatewayInstanceForm } from "./GatewayInstanceForm";
import { splitFieldValues } from "../gateway-instance-form";

type View = "clients" | "actions" | "check" | "logs" | "port" | "install" | "load-dir" | "load-id" | "pack" | "edit";
type Item = { key: string; label: string; detail?: string };

function sourceLabel(client: GatewayInstanceStatus): string {
  return client.source.type === "package"
    ? `package ${client.source.id}@${client.source.version}`
    : `directory ${client.source.directory}`;
}

function lastError(client: GatewayInstanceStatus): string | undefined {
  const events = client.diagnostics.filter(event => event.level === "error" || event.level === "warn");
  return events.length > 0 ? events[events.length - 1]!.message : undefined;
}

const CLIENT_KEY_PREFIX = "client:";

function isRegistered(client: GatewayInstanceStatus): boolean {
  return client.registered !== false;
}

function clientItems(clients: GatewayInstanceStatus[]): Item[] {
  return clients.map(client => ({
    key: `${CLIENT_KEY_PREFIX}${client.id}`,
    label: client.id,
    detail: isRegistered(client)
      ? `${sourceLabel(client)} · ${client.state} · ${client.platform} · :${client.port}${lastError(client) ? ` · ${lastError(client)}` : ""}`
      : `${sourceLabel(client)} · configured · unregistered`,
  }));
}

const ACTION_ITEMS: Item[] = [
  { key: "start", label: "Start" },
  { key: "stop", label: "Stop" },
  { key: "reload", label: "Reload" },
  { key: "check", label: "Check platform credentials" },
  { key: "logs", label: "Diagnostics / logs" },
  { key: "edit", label: "Edit configuration" },
  { key: "pack", label: "Pack directory (developer)" },
  { key: "back", label: "‹ back" },
];

const CONFIGURED_ACTION_ITEMS: Item[] = [
  { key: "register", label: "Register with Gateway" },
  { key: "edit", label: "Edit configuration" },
  { key: "pack", label: "Pack directory (developer)" },
  { key: "back", label: "‹ back" },
];

function actionItems(client: GatewayInstanceStatus): Item[] {
  if (!isRegistered(client)) {
    return CONFIGURED_ACTION_ITEMS.filter(item => item.key !== "pack" || client.source.type === "directory");
  }
  return ACTION_ITEMS.filter(item => item.key !== "pack" || client.source.type === "directory");
}

export function GatewayModal({ sandbox, port, gatewayActions, onSubmit, onBack }: {
  sandbox: string;
  port: number;
  gatewayActions?: GatewayInstanceActions;
  onSubmit: (port: number) => void;
  onBack: () => void;
}) {
  const { colors } = useTheme();
  const { version } = useMenuChrome();
  const versionRight = version ? <text fg={colors.text.muted}>v{version}</text> : undefined;
  const [clients, setClients] = useState<GatewayInstanceStatus[] | null | undefined>(undefined);
  const [offline, setOffline] = useState(false);
  const [view, setView] = useState<View>("clients");
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activeId, setActiveId] = useState<string>();
  const [diagnostics, setDiagnostics] = useState<GatewayDiagnostics>();
  const [draft, setDraft] = useState("");

  const active = clients?.find(client => client.id === activeId);

  const refresh = async () => {
    setError("");
    try {
      const result = await fetchGatewayInstances(sandbox, gatewayActions);
      setClients(result.instances);
      setOffline(result.offline);
    } catch (err) {
      setClients(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    void refresh();
  }, [sandbox, gatewayActions]);

  const open = (next: View) => {
    setError("");
    setNotice("");
    setView(next);
    setSelected(0);
  };

  const runAction = async (action: "start" | "stop" | "reload" | "register") => {
    if (!active) return;
    setError("");
    try {
      await gatewayAction(sandbox, action, active.id);
      await refresh();
      open("clients");
      setNotice(`${action} ${active.id}: ok`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const showDiagnostics = async (mode: "check" | "logs") => {
    if (!active) return;
    if (!isRegistered(active)) {
      setError("Register this instance before checking platform diagnostics");
      return;
    }
    setError("");
    try {
      setDiagnostics(await fetchGatewayDiagnostics(sandbox, active.id));
      open(mode);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const runOffline = async (action: "install" | "load" | "pack", value: string, id?: string) => {
    if (!gatewayActions) {
      setError("Gateway actions are unavailable in this context");
      return;
    }
    setError("");
    try {
      const result = action === "install" ? await gatewayActions.install(value)
        : action === "load" ? await gatewayActions.load(value, id || undefined)
        : await gatewayActions.pack(value);
      await refresh();
      open("clients");
      setNotice(result.trim() || `${action}: ok`);
    } catch (err) {
      await refresh();
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const saveEdit = async (values: Record<string, string>) => {
    if (!active) return;
    const { secrets } = splitFieldValues(active.config, values);
    try {
      saveGatewayInstance(sandbox, active, values, secrets);
      await refresh();
      open("clients");
      setNotice(`Saved ${active.id}; ${isRegistered(active) ? "restart/reload to apply" : "configured, not registered"}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (view === "edit" && active) {
    return (
      <GatewayInstanceForm
        title={`ATOM NEO · INSTANCE CONFIG · ${active.id}`}
        mode="edit"
        fields={active.config}
        initialValues={active.clientArgs}
        configuredSecrets={active.secretFields}
        error={error}
        onSubmit={saveEdit}
        onCancel={() => open("actions")}
      />
    );
  }

  if (view === "port") {
    return (
      <Modal open title="ATOM NEO · GATEWAY PORT" headerRight={versionRight} titleTruncate width={56} interactive={false} onClose={() => open("clients")} hint="Enter save · Esc cancel">
        <FieldInput
          label="Port"
          value={String(port)}
          placeholder="1-65535"
          error={error}
          onSubmit={(text) => {
            const parsed = parsePort(text);
            if (parsed === undefined) {
              setError("Port must be an integer between 1 and 65535");
              return;
            }
            try {
              onSubmit(parsed);
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : String(caught));
              return;
            }
            setNotice("Port saved; restart Gateway to apply");
            open("clients");
          }}
          onCancel={() => open("clients")}
        />
      </Modal>
    );
  }

  if (view === "install" || view === "load-dir" || view === "pack") {
    const label = view === "install" ? "Archive path" : view === "load-dir" ? "Client directory" : "Client directory to pack";
    return (
      <Modal
        open
        title={`ATOM NEO · ${view === "install" ? "INSTALL CLIENT PACKAGE" : view === "load-dir" ? "LOAD CLIENT DIRECTORY" : "PACK CLIENT"}`}
        headerRight={versionRight}
        titleTruncate
        width={72}
        interactive={false}
        onClose={() => open("clients")}
        hint="Enter continue · Esc cancel"
      >
        <FieldInput
          key={view}
          label={label}
          value={draft}
          error={error}
          onSubmit={(value) => {
            if (!value) {
              setError(`${label} is required`);
              return;
            }
            if (view === "load-dir") {
              setDraft(value);
              open("load-id");
              return;
            }
            void runOffline(view, value);
          }}
          onCancel={() => open("clients")}
        />
      </Modal>
    );
  }

  if (view === "load-id") {
    return (
      <Modal open title="ATOM NEO · LOAD CLIENT DIRECTORY" headerRight={versionRight} titleTruncate width={72} interactive={false} onClose={() => open("clients")} hint="Enter continue · Esc cancel">
        <FieldInput
          key="load-id"
          label="Instance ID (optional)"
          value=""
          placeholder="manifest.id"
          error={error}
          onSubmit={(id) => void runOffline("load", draft, id)}
          onCancel={() => open("clients")}
        />
      </Modal>
    );
  }

  if (view === "check" || view === "logs") {
    const lines = diagnostics?.events ?? [];
    return (
      <Modal
        open
        title={`ATOM NEO · ${view === "check" ? "CLIENT CHECK" : "DIAGNOSTICS"} · ${activeId ?? ""}`}
        headerRight={versionRight}
        titleTruncate
        width={96}
        height={20}
        onClose={() => open("actions")}
        listLength={lines.length + 1}
        selectedListIndex={0}
        onListActivate={() => open("actions")}
        hint="Enter/Esc back"
      >
        <box flexDirection="column">
          {view === "check" ? (
            <text fg={colors.text.secondary}>
              Client check: {diagnostics?.client.status ?? "unknown"}
            </text>
          ) : null}
          {view === "check" && diagnostics?.client.status === "ok"
            ? diagnostics.client.checks.map((check, index) => (
              <text key={index} fg={colors.text.muted}>{`  ${JSON.stringify(check)}`}</text>
            ))
            : null}
          {diagnostics?.client.status === "unreachable"
            ? <text fg={colors.status.error}>Client diagnostics: {diagnostics.client.error}</text>
            : null}
          <text fg={colors.text.muted}>
            {lines.length === 0 ? "No diagnostic events." : `${lines.length} local event(s)`}
          </text>
          {lines.slice(-12).map((event, index) => (
            <text key={index} fg={event.level === "error" ? colors.status.error : colors.text.muted}>
              {`${event.at} ${event.level} ${event.stage}: ${event.message}`}
            </text>
          ))}
        </box>
      </Modal>
    );
  }

  if (view === "actions" && active) {
    const items = actionItems(active);
    return (
      <Modal
        open
        title={`ATOM NEO · INSTANCE · ${active.id}`}
        headerRight={versionRight}
        titleTruncate
        width={80}
        onClose={() => open("clients")}
        listLength={items.length}
        selectedListIndex={selected}
        onListNavigate={setSelected}
        onListActivate={(index) => {
          const key = items[index]?.key;
          if (key === "back") open("clients");
          else if (key === "start" || key === "stop" || key === "reload" || key === "register") void runAction(key);
          else if (key === "check" || key === "logs") void showDiagnostics(key);
          else if (key === "edit") open("edit");
          else if (key === "pack") {
            setDraft(active.source.type === "directory" ? active.source.directory : "");
            open("pack");
          }
        }}
        hint="↑/↓ select · Enter choose · Esc back"
      >
        <box flexDirection="column">
          <text fg={colors.text.muted}>{sourceLabel(active)}</text>
          {isRegistered(active) ? (
            <text fg={colors.text.muted}>state {active.state} · port {active.port} · {active.platform}</text>
          ) : (
            <text fg={colors.status.warning ?? colors.text.muted}>configured · unregistered</text>
          )}
          {active.descriptionError ? (
            <text fg={colors.status.error}>Manifest: {active.descriptionError}</text>
          ) : null}
          {lastError(active) ? <text fg={colors.status.error}>{lastError(active)}</text> : null}
          <box marginTop={1} flexDirection="column">
            {items.map((item, index) => (
              <SelectableRow key={item.key} selected={index === selected} label={item.label} />
            ))}
          </box>
          {error ? <text fg={colors.status.error}>{error}</text> : null}
          {notice ? <text fg={colors.status.success ?? colors.text.muted}>{notice}</text> : null}
        </box>
      </Modal>
    );
  }

  const items: Item[] = [
    ...(clients ? clientItems(clients) : []),
    { key: "refresh", label: "Refresh" },
    { key: "install", label: "Install client package" },
    { key: "load", label: "Load client directory" },
    { key: "pack", label: "Pack client directory (developer)" },
    { key: "port", label: "Gateway port" },
    { key: "back", label: "‹ back" },
  ];

  return (
    <Modal
      open
      title="ATOM NEO · GATEWAY CLIENTS"
      headerRight={versionRight}
      titleTruncate
      width={96}
      height={22}
      onClose={onBack}
      listLength={items.length}
      selectedListIndex={selected}
      onListNavigate={setSelected}
      onListActivate={(index) => {
        const item = items[index];
        if (!item) return;
        if (item.key === "back") onBack();
        else if (item.key === "refresh") void refresh();
        else if (item.key === "install" || item.key === "load" || item.key === "pack") {
          setDraft("");
          open(item.key === "load" ? "load-dir" : item.key);
        } else if (item.key === "port") open("port");
        else if (item.key.startsWith(CLIENT_KEY_PREFIX)) {
          setActiveId(item.key.slice(CLIENT_KEY_PREFIX.length));
          open("actions");
        }
      }}
      hint="↑/↓ select · Enter open · Esc back"
    >
      <box flexDirection="column">
        {clients === undefined ? <text fg={colors.text.muted}>Loading…</text> : null}
        {clients === null && error ? <text fg={colors.status.error}>Unable to load Gateway status.</text> : null}
        {offline ? <text fg={colors.status.warning}>OFFLINE — config-only entries remain editable</text> : null}
        {clients !== null && clients !== undefined && clients.length === 0 && !offline
          ? <text fg={colors.text.muted}>No configured clients.</text>
          : null}
        {items.map((item, index) => (
          <SelectableRow
            key={item.key}
            selected={index === selected}
            label={item.label}
            labelWidth={item.detail ? 18 : undefined}
            detail={item.detail}
          />
        ))}
        {error ? <text fg={colors.status.error}>{error}</text> : null}
        {notice ? <text fg={colors.text.muted}>{notice}</text> : null}
      </box>
    </Modal>
  );
}
