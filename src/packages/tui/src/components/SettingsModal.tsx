import { useCallback, useEffect, useMemo, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { Modal } from "./modal";
import type { ModalAction } from "./modal";
import { useTheme } from "./App";
import type { ServerInfo, ThemeName } from "../types";

const PROFILE_LEVELS = ["advanced", "balanced", "basic", "fast"] as const;
const THEMES: ThemeName[] = [
  "edex", "github-dark", "github-light", "dracula", "nord",
  "tokyo-night", "solarized-dark", "monokai",
];
const THINKING_OPTIONS = ["disabled", "enabled", "adaptive"];
const MAX_TOKEN_OPTIONS = [2048, 4096, 8192, 16384];

const SETTINGS_ACTIONS: ModalAction[] = [
  { key: "cancel", label: "Cancel", role: "cancel" },
  { key: "reset", label: "Reset to config.json" },
  { key: "save", label: "Save", role: "confirm", variant: "primary" },
];

type RowKey = "advanced" | "balanced" | "basic" | "fast" | "theme" | "thinking" | "maxTokens";

type SettingsRow = { key: RowKey; label: string; options: string[] };

function headers(token?: string): Record<string, string> {
  return token ? { "x-atom-admin-token": token } : {};
}

export function modelOptions(config: Record<string, any>, includeJev = false): string[] {
  const options: string[] = [];
  for (const [provider, def] of Object.entries(config.providers ?? {})) {
    if (!includeJev && (def as any)?.type === "jev") continue;
    for (const model of (def as any)?.models ?? []) options.push(`${provider}/${model}`);
  }
  if (options.length === 0) {
    options.push(config.providerProfiles?.balanced ?? "deepseek/deepseek-v4-flash");
  }
  return [...new Set(options)].sort();
}

export function serverInfoFromConfig(prev: ServerInfo, config: Record<string, any>): ServerInfo {
  const balanced: string = config.providerProfiles?.balanced ?? "deepseek/deepseek-v4-flash";
  const sep = balanced.indexOf("/");
  const provider = sep >= 0 ? balanced.slice(0, sep) : "deepseek";
  const model = sep >= 0 ? balanced.slice(sep + 1) : balanced;
  return {
    ...prev,
    model,
    theme: config.tui?.theme ?? prev.theme,
    thinking: config.providers?.[provider]?.thinking ?? prev.thinking,
  };
}

export function buildRuntimePatch(
  values: Record<RowKey, string>,
  config: Record<string, any>,
): Record<string, unknown> {
  const balanced = values.balanced || "deepseek/deepseek-v4-flash";
  const provider = balanced.includes("/") ? balanced.split("/")[0] : "deepseek";
  const body: Record<string, unknown> = {};

  const profiles: Record<string, string> = {};
  for (const level of PROFILE_LEVELS) {
    const previous = config.providerProfiles?.[level] ?? (level === "fast" ? config.providerProfiles?.basic : undefined);
    if (values[level] && values[level] !== previous) profiles[level] = values[level];
  }
  if (Object.keys(profiles).length > 0) body.providerProfiles = profiles;
  if (values.theme !== config.tui?.theme) body.tui = { theme: values.theme };
  if (values.thinking !== (config.providers?.[provider]?.thinking ?? "disabled")) {
    body.providers = { [provider]: { thinking: values.thinking } };
  }
  if (values.maxTokens !== String(config.transport?.maxOutputTokens ?? 4096)) {
    body.transport = { maxOutputTokens: Number(values.maxTokens) };
  }
  return body;
}

interface SettingsModalProps {
  open: boolean;
  url: string;
  adminToken?: string;
  serverInfo: ServerInfo;
  onSaved: (info: ServerInfo) => void;
  onClose: () => void;
}

export function SettingsModal({ open, url, adminToken, serverInfo, onSaved, onClose }: SettingsModalProps) {
  const { colors } = useTheme();
  const [config, setConfig] = useState<Record<string, any> | null>(null);
  const [values, setValues] = useState<Record<RowKey, string>>({} as Record<RowKey, string>);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const rows: SettingsRow[] = useMemo(() => {
    if (!config) return [];
    const options = modelOptions(config);
    return [
      ...PROFILE_LEVELS.map(level => ({
        key: level as RowKey,
        label: `MODEL (${level})`,
        options: level === "fast" ? modelOptions(config, true) : options,
      })),
      { key: "theme" as RowKey, label: "TUI THEME", options: [...THEMES] },
      { key: "thinking" as RowKey, label: "THINKING", options: THINKING_OPTIONS },
      { key: "maxTokens" as RowKey, label: "MAX OUTPUT TOKENS", options: MAX_TOKEN_OPTIONS.map(String) },
    ];
  }, [config]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`${url}/api/config`, { headers: headers(adminToken) });
      if (!res.ok) throw new Error(`GET /api/config → ${res.status}`);
      const cfg = await res.json();
      setConfig(cfg);
      const balanced: string = cfg.providerProfiles?.balanced ?? "deepseek/deepseek-v4-flash";
      const provider = balanced.includes("/") ? balanced.split("/")[0] : "deepseek";
      setValues({
        advanced: cfg.providerProfiles?.advanced ?? balanced,
        balanced,
        basic: cfg.providerProfiles?.basic ?? balanced,
        fast: cfg.providerProfiles?.fast ?? cfg.providerProfiles?.basic ?? balanced,
        theme: cfg.tui?.theme ?? "edex",
        thinking: cfg.providers?.[provider]?.thinking ?? "disabled",
        maxTokens: String(cfg.transport?.maxOutputTokens ?? 4096),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [url, adminToken]);

  useEffect(() => {
    if (open) { setSelectedIndex(0); load(); }
  }, [open, load]);

  const cycleRow = useCallback((index: number) => {
    const row = rows[index];
    if (!row) return;
    setValues(prev => {
      const i = row.options.indexOf(prev[row.key]);
      return { ...prev, [row.key]: row.options[(i + 1) % row.options.length] };
    });
  }, [rows]);

  const patch = useCallback(async (): Promise<void> => {
    if (!config) return;
    const body = buildRuntimePatch(values, config);

    setError(null);
    try {
      const res = await fetch(`${url}/api/config/runtime`, {
        method: "PATCH",
        headers: { "content-type": "application/json", ...headers(adminToken) },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `PATCH /api/config/runtime → ${res.status}`);
      }
      onSaved(serverInfoFromConfig(serverInfo, await res.json()));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [config, values, url, adminToken, serverInfo, onSaved, onClose]);

  const reset = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const res = await fetch(`${url}/api/config/runtime`, {
        method: "DELETE",
        headers: headers(adminToken),
      });
      if (!res.ok) throw new Error(`DELETE /api/config/runtime → ${res.status}`);
      onSaved(serverInfoFromConfig(serverInfo, await res.json()));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [url, adminToken, serverInfo, onSaved, onClose]);

  const listLength = rows.length;

  return (
    <Modal
      open={open}
      title="RUNTIME SETTINGS"
      width={66}
      height={16}
      placement="center"
      actions={SETTINGS_ACTIONS}
      defaultActionKey="save"
      onClose={onClose}
      onAction={(key) => {
        if (key === "cancel") onClose();
        if (key === "reset") reset();
        if (key === "save") patch();
      }}
      listLength={listLength}
      selectedListIndex={selectedIndex}
      onListNavigate={setSelectedIndex}
      onListActivate={cycleRow}
    >
      <text fg={colors.text.muted}>Up/Down select · Enter change value · Tab actions · Enter confirm</text>
      {error && <text fg={colors.status.error}>{error}</text>}
      {rows.length === 0 ? (
        <text fg={colors.text.muted}>Loading configuration...</text>
      ) : (
        rows.map((row, i) => {
          const selected = i === selectedIndex;
          return (
            <box key={row.key} flexDirection="row" gap={2} backgroundColor={selected ? colors.decoration.subtle : undefined}>
              <text fg={selected ? colors.text.bright : colors.text.secondary} width={22} attributes={selected ? TextAttributes.BOLD : undefined}>
                {row.label}
              </text>
              <text fg={selected ? colors.accent.brand : colors.text.primary}>{values[row.key] ?? "—"}</text>
            </box>
          );
        })
      )}
    </Modal>
  );
}
