import type React from "react";

export type ModalActionRole = "confirm" | "cancel" | "destructive";
export type ModalActionVariant = "normal" | "primary" | "danger";

export interface ModalAction {
  key: string;
  label: string;
  role?: ModalActionRole;
  variant?: ModalActionVariant;
  disabled?: boolean;
}

export interface ModalProps {
  open: boolean;
  title?: string;
  width?: number;
  height?: number;
  actions?: ModalAction[];
  defaultActionKey?: string;
  children?: React.ReactNode;
  zIndex?: number;
  onAction?: (key: string, action: ModalAction) => void;
  onClose?: () => void;
  listLength?: number;
  selectedListIndex?: number;
  onListNavigate?: (index: number) => void;
  onListActivate?: (index: number) => void;
  /** When false, the modal ignores all keyboard input (forms drive keys via their textarea). */
  interactive?: boolean;
  hint?: string;
}
