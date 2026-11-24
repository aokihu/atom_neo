import { Modal } from "../modal";
import { FieldInput, useTheme } from "@atom-neo/tui-kit";
import { useMenuChrome } from "../menu/menu-frame";

export function ProjectModal({ value, onSubmit, onBack }: {
  value: string;
  onSubmit: (description: string) => void;
  onBack: () => void;
}) {
  const { colors } = useTheme();
  const { version } = useMenuChrome();
  return (
    <Modal
      open
      title="ATOM NEO · PROJECT INFORMATION"
      headerRight={version ? <text fg={colors.text.muted}>v{version}</text> : undefined}
      titleTruncate
      width={64}
      interactive={false}
      onClose={onBack}
      hint="Enter continue · Esc back"
    >
      <FieldInput
        label="Description"
        value={value}
        placeholder="Describe your project (written to AGENTS.md)"
        onSubmit={onSubmit}
        onCancel={onBack}
      />
    </Modal>
  );
}
