import { useState } from "react";
import { Modal } from "../modal";
import { FieldInput } from "./FieldInput";
import { parsePort } from "../wizard-logic";

export function GatewayModal({ port, onSubmit, onBack }: {
  port: number;
  onSubmit: (port: number) => void;
  onBack: () => void;
}) {
  const [error, setError] = useState("");

  return (
    <Modal
      open
      title="GATEWAY"
      width={56}
      interactive={false}
      onClose={onBack}
      hint="Enter save · Esc cancel"
    >
      <FieldInput
        label="Port"
        value={String(port)}
        placeholder="1-65535"
        error={error}
        onSubmit={(text) => {
          const parsed = parsePort(text);
          if (parsed === undefined) {
            setError("Port must be an integer between 1 and 65535");
            return;
          }
          onSubmit(parsed);
        }}
        onCancel={onBack}
      />
    </Modal>
  );
}
