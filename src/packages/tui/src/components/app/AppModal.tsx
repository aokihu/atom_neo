import { Modal } from "../modal";
import { modalSpec } from "./app-modal-config";
import type { ActiveModal } from "./app-modal-config";

export function AppModal({ modal, textColor, onClose, onClearMessages, onQuit }: {
  modal: ActiveModal;
  textColor: string;
  onClose: () => void;
  onClearMessages: () => void;
  onQuit?: () => void;
}) {
  if (!modal || modal.kind === "settings") return null;
  const spec = modalSpec(modal);
  return (
    <Modal
      open
      title={spec.title(modal)}
      placement="center"
      width={spec.width}
      height={spec.height}
      actions={spec.actions}
      defaultActionKey={spec.defaultActionKey}
      onClose={onClose}
      onAction={key => spec.onAction(modal, key, {
        close: onClose,
        clearMessages: onClearMessages,
        quit: () => onQuit?.(),
      })}
    >
      {spec.render(modal, { textColor })}
    </Modal>
  );
}
