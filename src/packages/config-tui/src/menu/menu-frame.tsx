import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useKeyboard } from "@opentui/react";
import { FieldInput, Modal, SelectableRow, useTheme } from "@atom-neo/tui-kit";
import type { ModalAction } from "@atom-neo/tui-kit";

export type MenuItem = {
  key: string;
  label: string;
  detail?: string;
};

export function MenuStatus({ workspace, gateway, core }: {
  workspace: string;
  gateway: "online" | "offline" | "unknown";
  core: "online" | "offline" | "unknown";
}) {
  const { colors } = useTheme();
  const status = (value: string) => value === "online" ? colors.status.success : value === "offline" ? colors.status.warning : colors.text.muted;
  return (
    <box flexDirection="column" marginBottom={1}>
      <text fg={colors.text.muted}>workspace: {workspace}</text>
      <box flexDirection="row" gap={2}>
        <text fg={status(gateway)}>Gateway: {gateway}</text>
        <text fg={status(core)}>Core: {core}</text>
      </box>
    </box>
  );
}

/** Shared OpenTUI menu surface: frame, status header, list and keyboard navigation. */
export function MenuScreen({ title, workspace, gateway, core, items, onSelect, onBack, onDelete, onSelectionChange, hint, error, notice, children }: {
  title: string;
  workspace: string;
  gateway: "online" | "offline" | "unknown";
  core: "online" | "offline" | "unknown";
  items: MenuItem[];
  onSelect: (key: string) => void;
  onBack: () => void;
  onDelete?: () => void;
  onSelectionChange?: (index: number) => void;
  hint: string;
  error?: string;
  notice?: string;
  children?: ReactNode;
}) {
  const { colors } = useTheme();
  const [selected, setSelected] = useState(0);
  const bounded = items.length === 0 ? 0 : Math.min(selected, items.length - 1);

  useEffect(() => {
    onSelectionChange?.(bounded);
  }, [bounded, onSelectionChange]);

  useKeyboard((event) => {
    if (event.name === "delete" && onDelete) onDelete();
  });

  return (
    <Modal
      open
      title={`ATOM NEO · ${title}`}
      width={96}
      height={24}
      listLength={Math.max(1, items.length)}
      selectedListIndex={bounded}
      onListNavigate={(index) => setSelected(index)}
      onListActivate={(index) => {
        const item = items[index];
        if (item) onSelect(item.key);
      }}
      onClose={onBack}
      hint={hint}
    >
      <box flexDirection="column">
        <MenuStatus workspace={workspace} gateway={gateway} core={core} />
        {children}
        {items.length === 0
          ? <text fg={colors.text.muted}>No items.</text>
          : items.map((item, index) => (
            <SelectableRow
              key={item.key}
              selected={index === bounded}
              label={item.label}
              labelWidth={32}
              detail={item.detail}
            />
          ))}
        {error ? <box marginTop={1}><text fg={colors.status.error}>{error}</text></box> : null}
        {notice ? <box marginTop={1}><text fg={colors.status.success}>{notice}</text></box> : null}
      </box>
    </Modal>
  );
}

export function MenuPrompt({ title, label, value, placeholder, error, onSubmit, onCancel, hint }: {
  title: string;
  label: string;
  value: string;
  placeholder?: string;
  error?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  hint: string;
}) {
  return (
    <Modal open title={`ATOM NEO · ${title}`} width={72} interactive={false} onClose={onCancel} hint={hint}>
      <FieldInput
        label={label}
        value={value}
        placeholder={placeholder}
        error={error}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    </Modal>
  );
}

export function MenuConfirm({ title, message, confirmLabel, onConfirm, onCancel }: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const actions: ModalAction[] = [
    { key: "cancel", label: "Cancel", role: "cancel" },
    { key: "confirm", label: confirmLabel, role: "confirm", variant: "primary" },
  ];
  return (
    <Modal
      open
      title={`ATOM NEO · ${title}`}
      width={64}
      actions={actions}
      onAction={(key) => key === "confirm" ? onConfirm() : onCancel()}
      onClose={onCancel}
      hint="Tab/←/→ select · Enter confirm · Esc cancel"
    >
      <text>{message}</text>
    </Modal>
  );
}
