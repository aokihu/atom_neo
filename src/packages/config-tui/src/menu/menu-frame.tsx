import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { stringWidth } from "@atom-neo/shared";
import { FieldInput, Modal, SelectableRow, useTheme } from "@atom-neo/tui-kit";
import type { ModalAction } from "@atom-neo/tui-kit";
import { SecretFieldInput } from "../components/SecretFieldInput";

const MENU_WIDTH = 96;
const ELLIPSIS = "…";
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Width inside Modal border + panel paddingX; shared by title, breadcrumb and workspace. */
export function menuContentWidth(screenWidth: number): number {
  return Math.min(MENU_WIDTH, Math.max(20, screenWidth - 4)) - 4;
}

function graphemes(text: string): string[] {
  return [...segmenter.segment(text)].map(part => part.segment);
}

export function truncateByWidth(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (stringWidth(text) <= maxWidth) return text;
  if (maxWidth <= 1) return ELLIPSIS;
  let result = "";
  let width = 0;
  for (const char of graphemes(text)) {
    const next = stringWidth(char);
    if (width + next > maxWidth - 1) break;
    result += char;
    width += next;
  }
  return `${result}${ELLIPSIS}`;
}

export function truncateMiddle(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (stringWidth(text) <= maxWidth) return text;
  if (maxWidth <= 1) return ELLIPSIS;
  const chars = graphemes(text);
  const budget = maxWidth - 1;
  const leftTarget = Math.ceil(budget / 2);
  let left = "";
  let leftWidth = 0;
  for (const char of chars) {
    const next = stringWidth(char);
    if (leftWidth + next > leftTarget) break;
    left += char;
    leftWidth += next;
  }
  let right = "";
  let rightWidth = 0;
  for (let index = chars.length - 1; index >= 0; index--) {
    const next = stringWidth(chars[index]!);
    if (leftWidth + rightWidth + next > budget) break;
    right = chars[index]! + right;
    rightWidth += next;
  }
  return `${left}${ELLIPSIS}${right}`;
}

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
  const contentWidth = menuContentWidth(width);
  const prefix = "workspace: ";
  const pathWidth = Math.max(1, contentWidth - stringWidth(prefix));
  const shown = truncateMiddle(workspace, pathWidth);
  const crumb = breadcrumb?.includes(" / ") ? truncateByWidth(breadcrumb, contentWidth) : undefined;
  return (
    <box flexDirection="column" marginBottom={1}>
      {crumb ? <text fg={colors.text.muted} wrapMode="none" truncate>{crumb}</text> : null}
      <text fg={colors.text.muted} wrapMode="none" truncate>{`${prefix}${shown}`}</text>
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
  const { width } = useTerminalDimensions();
  const contentWidth = menuContentWidth(width);
  const versionText = version ? `v${version}` : "";
  const titleMax = Math.max(1, contentWidth - (versionText ? stringWidth(versionText) + 1 : 0));
  const titleText = truncateByWidth(`ATOM NEO · ${title}`, titleMax);
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
      title={titleText}
      headerRight={version ? <text fg={colors.text.muted} wrapMode="none">{versionText}</text> : undefined}
      titleTruncate
      width={MENU_WIDTH}
      height={24}
      titlePadding={0}
      contentPaddingX={0}
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
