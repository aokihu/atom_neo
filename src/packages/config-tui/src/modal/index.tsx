import { Modal as SharedModal } from "@atom-neo/tui-kit";
import type { ModalProps } from "@atom-neo/tui-kit";

/** Config wizard wrapper: keeps the bordered look on the shared Modal. */
export function Modal(props: ModalProps) {
  return <SharedModal {...props} chrome="bordered" />;
}

export { ModalActionBar } from "@atom-neo/tui-kit";
export type {
  ModalAction,
  ModalActionRole,
  ModalActionVariant,
  ModalChrome,
  ModalProps,
} from "@atom-neo/tui-kit";
