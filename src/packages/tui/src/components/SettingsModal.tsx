import { useCallback, useEffect, useMemo, useState } from "react";
import type { Ref } from "react";
import { TextAttributes } from "@opentui/core";
import type { BoxRenderable } from "@opentui/core";
import { Modal } from "./modal";
import type { ModalAction } from "./modal";
import { useTheme } from "@atom-neo/tui-kit";
import type { ServerInfo } from "../types";
import { buildSettingsRows } from "./settings/settings-model";
import { useSettingsConfig } from "./settings/use-settings-config";

const SETTINGS_ACTIONS: ModalAction[] = [
  { key: "cancel", label: "Cancel", role: "cancel" },
  { key: "reset", label: "Reset to config.json" },
  { key: "save", label: "Save", role: "confirm", variant: "primary" },
];

interface SettingsModalProps {
  open: boolean;
  focusRef?: Ref<BoxRenderable>;
  url: string;
  adminToken?: string;
  serverInfo: ServerInfo;
  onSaved: (info: ServerInfo) => void;
  onClose: () => void;
}

export { modelOptions, serverInfoFromConfig, buildRuntimePatch, headers } from "./settings/settings-model";

export function SettingsModal({ open, focusRef, url, adminToken, serverInfo, onSaved, onClose }: SettingsModalProps) {
  const { colors } = useTheme();
  const { config, values, setValues, error, load, patch, reset } = useSettingsConfig({
    open, url, adminToken, serverInfo, onSaved, onClose,
  });
  const [selectedIndex, setSelectedIndex] = useState(0);

  const rows = useMemo(() => buildSettingsRows(config), [config]);

  useEffect(() => {
    if (open) setSelectedIndex(0);
  }, [open, load]);

  const cycleRow = useCallback((index: number) => {
    const row = rows[index];
    if (!row) return;
    setValues(prev => {
      const i = row.options.indexOf(prev[row.key]);
      return { ...prev, [row.key]: row.options[(i + 1) % row.options.length] };
    });
  }, [rows, setValues]);

  return (
    <Modal
      open={open}
      title="RUNTIME SETTINGS"
      width={66}
      height={16}
      placement="center"
      actions={SETTINGS_ACTIONS}
      defaultActionKey="save"
      titlePadding={0}
      focusRef={focusRef}
      onClose={onClose}
      onAction={(key) => {
        if (key === "cancel") onClose();
        if (key === "reset") reset();
        if (key === "save") patch();
      }}
      listLength={rows.length}
      selectedListIndex={selectedIndex}
      onListNavigate={setSelectedIndex}
      onListActivate={cycleRow}
    >
      <text fg={colors.text.muted}>↑/↓ select · Enter change · Tab actions · Enter confirm</text>
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
