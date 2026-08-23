import { Modal } from "../modal";
import { FieldInput } from "./FieldInput";

export function ProjectModal({ value, onSubmit, onBack }: {
  value: string;
  onSubmit: (description: string) => void;
  onBack: () => void;
}) {
  return (
    <Modal
      open
      title="PROJECT INFORMATION"
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
