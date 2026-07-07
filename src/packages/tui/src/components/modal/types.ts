import type React from "react";

export type ModalPlacement = "center" | "top" | "bottom";

export type ModalAnchorPoint =
  | "top-left"
  | "top"
  | "top-right"
  | "left"
  | "center"
  | "right"
  | "bottom-left"
  | "bottom"
  | "bottom-right";

export type ModalActionRole = "confirm" | "cancel" | "destructive";

export type ModalActionVariant = "normal" | "primary" | "danger";

export interface ModalAnchorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ModalOffset {
  x?: number;
  y?: number;
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
  anchorPosition?: ModalAnchorPoint;
  position?: ModalAnchorPoint;
  offset?: ModalOffset;
  matchAnchorWidth?: boolean;
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
  interactive?: boolean;
  titlePadding?: number;
  contentPaddingX?: number;
}
