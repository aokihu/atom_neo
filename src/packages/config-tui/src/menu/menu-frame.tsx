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

export type MenuPreview = {
  title: string;
  lines: string[];
  content?: ReactNode;
};

const SPLIT_MIN_WIDTH = 80;
const NAV_WIDTH = 34;

function defaultPreview(item: MenuItem, hint: string): MenuPreview {
  return {
    title: item.label.replace(/[›‹]\s*/g, "").trim().toUpperCase(),
    lines: [item.detail ?? "", "", hint],
  };
}

function MenuPreviewPane({ preview, width }: { preview: MenuPreview; width: number }) {
  const { colors } = useTheme();
  return (
    <box flexDirection="column">
      <text fg={colors.text.bright} wrapMode="none" truncate>{truncateByWidth(preview.title, width)}</text>
      <box marginTop={1} flexDirection="column">
        {preview.lines.map((line, index) => (
          <text key={index} fg={colors.text.muted} wrapMode="none" truncate>
            {truncateByWidth(line || " ", width)}
          </text>
        ))}
        {preview.content ? <box marginTop={1}>{preview.content}</box> : null}
      </box>
    </box>
  );
}

type MenuChrome = { version?: string; breadcrumb?: string };
const MenuChromeContext = createContext<MenuChrome>({});

export function MenuChromeProvider({ version, breadcrumb, children }: MenuChrome & { children: ReactNode }) {
  return <MenuChromeContext.Provider value={{ version, breadcrumb }}>{children}</MenuChromeContext.Provider>;
}

export function useMenuChrome(): MenuChrome {
  return useContext(MenuChromeContext);
}

export function MenuStatus({ workspace, gateway, core, breadcrumb }: {
  workspace: string;
  gateway: "online" | "offline" | "unknown";
  core: "online" | "offline" | "unknown";
  breadcrumb?: string;
}) {
  const { colors } = useTheme();
  const { width } = useTerminalDimensions();
  const { breadcrumb: inheritedBreadcrumb } = useContext(MenuChromeContext);
  const crumbText = breadcrumb ?? inheritedBreadcrumb;

  const status = (value: string) => value === "online" ? colors.status.success : value === "offline" ? colors.status.warning : colors.text.muted;
  const contentWidth = menuContentWidth(width);
  const prefix = "workspace: ";
  const pathWidth = Math.max(1, contentWidth - stringWidth(prefix));
  const shown = truncateMiddle(workspace, pathWidth);
  const crumb = crumbText ? truncateByWidth(crumbText, contentWidth) : undefined;
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
export function MenuScreen({ title, workspace, gateway, core, items, onSelect, onBack, onDelete, onSelectionChange, hint, error, notice, suspended = false, preview, breadcrumb, initialSelection = 0, children }: {
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
  preview?: (item: MenuItem) => MenuPreview;
  breadcrumb?: string;
  initialSelection?: number;
  children?: ReactNode;
}) {
  const { colors } = useTheme();
  const { version } = useContext(MenuChromeContext);
  const { width } = useTerminalDimensions();
  const contentWidth = menuContentWidth(width);
  const versionText = version ? `v${version}` : "";
  const titleMax = Math.max(1, contentWidth - (versionText ? stringWidth(versionText) + 1 : 0));
  const titleText = truncateByWidth(`ATOM NEO · ${title}`, titleMax);
  const [selected, setSelected] = useState(initialSelection);
  const bounded = items.length === 0 ? 0 : Math.min(selected, items.length - 1);
  const maxVisible = 10;
  const windowStart = Math.max(0, Math.min(bounded - maxVisible + 1, items.length - maxVisible));
  const visibleItems = items.slice(windowStart, windowStart + maxVisible);
  const split = width >= SPLIT_MIN_WIDTH;
  const showInlineDetail = width >= 64 && !split;
  const selectedItem = items[bounded];
  const previewWidth = Math.max(12, contentWidth - NAV_WIDTH - 3);
  const selectedPreview = selectedItem
    ? preview?.(selectedItem) ?? defaultPreview(selectedItem, hint)
    : undefined;
  const renderRows = (detail: boolean) => {
    return (
      <>
        {items.length === 0
          ? <text fg={colors.text.muted}>No items.</text>
          : visibleItems.map((item, offset) => {
            const index = windowStart + offset;
            const hasDetail = detail && Boolean(item.detail?.trim());
            const labelMax = split ? NAV_WIDTH - 4 : hasDetail ? 24 : Math.max(4, contentWidth - 4);
            const detailMax = hasDetail ? Math.max(1, contentWidth - labelMax - 3) : 0;
            return (
              <SelectableRow
                key={item.key}
                selected={index === bounded}
                label={truncateByWidth(item.label, labelMax)}
                labelWidth={labelMax}
                detail={hasDetail ? truncateByWidth(item.detail ?? "", detailMax) : undefined}
                truncate
              />
            );
          })}
        {items.length > maxVisible
          ? <text fg={colors.text.muted} wrapMode="none" truncate>{`${windowStart + 1}-${windowStart + visibleItems.length} of ${items.length}`}</text>
          : null}
      </>
    );
  };

  useEffect(() => {
    setSelected(initialSelection);
  }, [title, initialSelection]);

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
      hint={truncateByWidth(hint, contentWidth)}
    >
      <box flexDirection="column">
        <MenuStatus workspace={workspace} gateway={gateway} core={core} breadcrumb={breadcrumb} />
        {children}
        {split ? (
          <box flexDirection="row" flexGrow={1}>
            <box width={NAV_WIDTH} flexDirection="column">
              {renderRows(false)}
            </box>
            <box
              flexGrow={1}
              flexDirection="column"
              border={["left"]}
              borderStyle="single"
              borderColor={colors.border.default}
              paddingLeft={2}
            >
              {selectedPreview ? <MenuPreviewPane preview={selectedPreview} width={previewWidth} /> : null}
            </box>
          </box>
        ) : (
          <box flexDirection="column">{renderRows(showInlineDetail)}</box>
        )}
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
  const { colors } = useTheme();
  const { version } = useMenuChrome();
  return (
    <Modal
      open
      title={`ATOM NEO · ${title}`}
      headerRight={version ? <text fg={colors.text.muted}>v{version}</text> : undefined}
      titleTruncate
      width={72}
      interactive={false}
      onClose={onCancel}
      hint={hint}
    >
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
  const { colors } = useTheme();
  const { version } = useMenuChrome();
  return (
    <Modal
      open
      title={`ATOM NEO · ${title}`}
      headerRight={version ? <text fg={colors.text.muted}>v{version}</text> : undefined}
      titleTruncate
      width={72}
      interactive={false}
      onClose={onCancel}
      hint={hint}
    >
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
  const { colors } = useTheme();
  const { version } = useMenuChrome();
  const actions: ModalAction[] = [
    { key: "cancel", label: "Cancel", role: "cancel" },
    { key: "confirm", label: confirmLabel, role: "confirm", variant: "primary" },
  ];
  return (
    <Modal
      open
      title={`ATOM NEO · ${title}`}
      headerRight={version ? <text fg={colors.text.muted}>v{version}</text> : undefined}
      titleTruncate
      width={64}
      actions={actions}
      onAction={(key) => key === "confirm" ? onConfirm() : onCancel()}
      onClose={onCancel}
      hint="Tab/←/→ · Enter · Esc"
    >
      <text>{message}</text>
    </Modal>
  );
}
