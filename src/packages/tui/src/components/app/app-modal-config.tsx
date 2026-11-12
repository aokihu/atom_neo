import type { ReactNode } from "react";
import type { ToolGroupMessage } from "../../types";
import type { ModalAction } from "../modal";
import { summarizeToolGroups, ToolDetailsContent } from "../ToolMessageBox";

export type ActiveModal =
  | { kind: "confirm-clear" }
  | { kind: "confirm-quit" }
  | { kind: "error"; title: string; message: string }
  | { kind: "tool-details"; groups: ToolGroupMessage[] }
  | { kind: "settings" }
  | null;

type AnyModal = NonNullable<ActiveModal>;
export type ModalKind = AnyModal["kind"];
type ModalOf<K extends ModalKind> = Extract<AnyModal, { kind: K }>;

export type ModalActionContext = {
  close: () => void;
  clearMessages: () => void;
  quit: () => void;
};

export type ModalRenderContext = {
  textColor: string;
};

export type ModalSpec<K extends ModalKind = ModalKind> = {
  title: (modal: ModalOf<K>) => string;
  width: number;
  height?: number;
  actions: ModalAction[];
  defaultActionKey: string;
  render: (modal: ModalOf<K>, context: ModalRenderContext) => ReactNode;
  onAction: (modal: ModalOf<K>, key: string, context: ModalActionContext) => void;
};

const CONFIRM_ACTIONS: ModalAction[] = [
  { key: "cancel", label: "Cancel", role: "cancel" },
  { key: "ok", label: "OK", role: "confirm", variant: "primary" },
];

const ERROR_ACTIONS: ModalAction[] = [
  { key: "ok", label: "OK", role: "confirm", variant: "primary" },
];

const TOOL_ACTIONS: ModalAction[] = [
  { key: "close", label: "Close", role: "confirm", variant: "primary" },
];

export const MODAL_CONFIG = {
  "confirm-clear": {
    title: () => "Clear conversation?",
    width: 56,
    actions: CONFIRM_ACTIONS,
    defaultActionKey: "cancel",
    render: (_modal, { textColor }) => (
      <text fg={textColor}>This will remove all messages from the current TUI view.</text>
    ),
    onAction: (_modal, key, { close, clearMessages }) => {
      if (key === "cancel") { close(); return; }
      clearMessages();
      close();
    },
  },
  "confirm-quit": {
    title: () => "Exit Atom Neo?",
    width: 56,
    actions: CONFIRM_ACTIONS,
    defaultActionKey: "cancel",
    render: (_modal, { textColor }) => (
      <text fg={textColor}>The current terminal UI session will be closed.</text>
    ),
    onAction: (_modal, key, { close, quit }) => {
      if (key === "cancel") { close(); return; }
      close();
      quit();
    },
  },
  error: {
    title: modal => modal.title,
    width: 56,
    actions: ERROR_ACTIONS,
    defaultActionKey: "ok",
    render: (modal, { textColor }) => <text fg={textColor}>{modal.message}</text>,
    onAction: (_modal, _key, { close }) => close(),
  },
  "tool-details": {
    title: modal => {
      const summary = summarizeToolGroups(modal.groups);
      return `TOOLS ${summary.success}/${summary.total}`;
    },
    width: 84,
    height: 20,
    actions: TOOL_ACTIONS,
    defaultActionKey: "close",
    render: modal => <ToolDetailsContent groups={modal.groups} />,
    onAction: (_modal, _key, { close }) => close(),
  },
  settings: {
    // Rendered by SettingsModal, which owns the form; metadata mirrors that modal for the table.
    title: () => "RUNTIME SETTINGS",
    width: 66,
    height: 16,
    actions: [
      { key: "cancel", label: "Cancel", role: "cancel" },
      { key: "reset", label: "Reset to config.json" },
      { key: "save", label: "Save", role: "confirm", variant: "primary" },
    ],
    defaultActionKey: "save",
    render: () => null,
    onAction: (_modal, _key, { close }) => close(),
  },
} satisfies { [K in ModalKind]: ModalSpec<K> };

export function modalSpec(modal: AnyModal): ModalSpec {
  return MODAL_CONFIG[modal.kind] as ModalSpec;
}
