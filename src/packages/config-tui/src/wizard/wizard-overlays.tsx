import { useTheme } from "@atom-neo/tui-kit";
import { Modal } from "../modal";
import type { ModalAction } from "../modal";

const QUIT_ACTIONS: ModalAction[] = [
  { key: "cancel", label: "Cancel", role: "cancel" },
  { key: "quit", label: "Quit", role: "destructive", variant: "danger" },
];

export function WizardBackground() {
  const { colors } = useTheme();
  return (
    <box width="100%" height="100%" backgroundColor={colors.bg.page} />
  );
}

export function WizardQuitConfirm({ open, onQuit, onCancel }: { open: boolean; onQuit: () => void; onCancel: () => void }) {
  const { colors } = useTheme();
  return (
    <Modal
      open={open}
      title="QUIT WITHOUT SAVING?"
      width={48}
      zIndex={1200}
      actions={QUIT_ACTIONS}
      defaultActionKey="cancel"
      onClose={onCancel}
      onAction={(key) => { if (key === "quit") onQuit(); else onCancel(); }}
    >
      <text fg={colors.text.secondary}>All unsaved changes will be discarded.</text>
    </Modal>
  );
}
