import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { FieldInput, Modal, SelectableRow, useTheme } from "@atom-neo/tui-kit";
import type { ModalAction } from "@atom-neo/tui-kit";
import { SecretFieldInput } from "../components/SecretFieldInput";

export type MenuItem = {
  key: string;
  label: string;
  detail?: string;
};

type MenuChrome = { version?: string; breadcrumb?: string };
const MenuChromeContext = createContext<MenuChrome>({});

export function MenuChromeProvider({ version, breadcrumb, children }: MenuChrome & { children: ReactNode }) {
  return <MenuChromeContext.Provider value={{ version, breadcrumb }}>{children}</MenuChromeContext.Provider>;
}

export function MenuStatus({ workspace, gateway, core }: {
  workspace: string;
  gateway: "online" | "offline" | "unknown";
  core: "online" | "offline" | "unknown";
}) {
  const { colors } = useTheme();
  const { width } = useTerminalDimensions();
  const { breadcrumb } = useContext(MenuChromeContext);
  const status = (value: string) => value === "online" ? colors.status.success : value === "offline" ? colors.status.warning : colors.text.muted;
  const limit = Math.max(16, Math.min(72, width - 18));
  const shown = workspace.length <= limit
    ? workspace
    : `${workspace.slice(0, Math.ceil((limit - 1) / 2))}…${workspace.slice(-Math.floor((limit - 1) / 2))}`;
  return (
    <box flexDirection="column" marginBottom={1}>
      <text fg={colors.text.muted}>{breadcrumb ?? "Home"}</text>
      <text fg={colors.text.muted}>workspace: {shown}</text>
      <box flexDirection="row" gap={2}>
        <text fg={status(gateway)}>Gateway: {gateway}</text>
        <text fg={status(core)}>Core: {core}</text>
      </box>
    </box>
  );
}

/** Shared OpenTUI menu surface: frame, status header, list and keyboard navigation. */
export function MenuScreen({ title, workspace, gateway, core, items, onSelect, onBack, onDelete, onSelectionChange, hint, error, notice, suspended = false, children }: {
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
  /** Keep the list visible but release all keyboard handling to an overlay. */
  suspended?: boolean;
  children?: ReactNode;
}) {
  const { colors } = useTheme();
  const { version } = useContext(MenuChromeContext);
  const [selected, setSelected] = useState(0);
  const bounded = items.length === 0 ? 0 : Math.min(selected, items.length - 1);
  const maxVisible = 10;
  const windowStart = Math.max(0, Math.min(bounded - maxVisible + 1, items.length - maxVisible));
  const visibleItems = items.slice(windowStart, windowStart + maxVisible);

  useEffect(() => {
    setSelected(0);
  }, [title]);

  useEffect(() => {
    onSelectionChange?.(bounded);
  }, [bounded, onSelectionChange]);

  useKeyboard((event) => {
    if (!suspended && event.name === "delete" && onDelete) onDelete();
  });

  return (
    <Modal
      open
      title={`ATOM NEO · ${title}`}
      headerRight={version ? <text fg={colors.text.muted}>{`v${version}`}</text> : undefined}
      width={96}
      height={24}
      titlePadding={0}
      interactive={!suspended}
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
          : visibleItems.map((item, offset) => {
            const index = windowStart + offset;
            return (
              <SelectableRow
                key={item.key}
                selected={index === bounded}
                label={item.label}
                labelWidth={32}
                detail={item.detail}
              />
            );
          })}
        {items.length > maxVisible
          ? <text fg={colors.text.muted}>{`${windowStart + 1}-${windowStart + visibleItems.length} of ${items.length}`}</text>
          : null}
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

export function MenuSecretPrompt({ title, label, placeholder, error, onSubmit, onCancel, hint }: {
  title: string;
  label: string;
  placeholder?: string;
  error?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  hint: string;
}) {
  return (
    <Modal open title={`ATOM NEO · ${title}`} width={72} interactive={false} onClose={onCancel} hint={hint}>
      <SecretFieldInput
        label={label}
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
