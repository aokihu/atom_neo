import type { Ref } from "react";
import type { BoxRenderable } from "@opentui/core";
import { Modal } from "../modal";
import { modalSpec } from "./app-modal-config";
import type { ActiveModal } from "./app-modal-config";

export function AppModal({ modal, textColor, focusRef, onClose, onClearMessages, onQuit }: {
  modal: ActiveModal;
  textColor: string;
  focusRef?: Ref<BoxRenderable>;
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
      focusRef={focusRef}
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
