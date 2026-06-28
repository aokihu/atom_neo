import type React from "react";

export type ModalPlacement =
  | "center"
  | "top"
  | "bottom"
  | "attach-top"
  | "attach-bottom"
  | "attach-left"
  | "attach-right";

export type ModalActionRole = "confirm" | "cancel" | "destructive";

export type ModalActionVariant = "normal" | "primary" | "danger";

export interface ModalAnchorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

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
  placement?: ModalPlacement;
  anchorRect?: ModalAnchorRect;
  actions?: ModalAction[];
  defaultActionKey?: string;
  children?: React.ReactNode;
  zIndex?: number;
  onAction?: (key: string, action: ModalAction) => void;
  onClose?: () => void;
}
