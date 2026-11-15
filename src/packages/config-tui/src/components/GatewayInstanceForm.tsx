import { useState } from "react";
import { Modal } from "../modal";
import type { ModalAction } from "../modal";
import { FieldInput, SelectableRow, useTheme } from "@atom-neo/tui-kit";
import {
  beginDraft,
  maskFieldValue,
  setDraftValue,
  validateFieldValues,
} from "../gateway-instance-form";
import type { GatewayInstanceFields } from "../gateway-instance-form";

const ACTIONS: ModalAction[] = [
  { key: "cancel", label: "Back", role: "cancel" },
  { key: "save", label: "Save", role: "confirm", variant: "primary" },
];

type Editing = { name: string; index: number } | null;

/**
 * manifest.config driven instance form.
 *
 * Secrets are masked in the field list. tui-kit's FieldInput has no mask
 * support, so text is visible while the editor is focused; stored secrets are
 * never loaded back into that editor.
 */
export function GatewayInstanceForm({ title = "INSTANCE CONFIG", fields, initialValues, onSubmit, onCancel }: {
  title?: string;
  fields: GatewayInstanceFields;
  initialValues?: Record<string, string>;
  onSubmit: (values: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const { colors } = useTheme();
  const [draft, setDraft] = useState(() => beginDraft(fields, initialValues));
  const [selected, setSelected] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Editing>(null);
  const entries = Object.entries(fields);

  const clearError = (name: string) => {
    setErrors((prev) => {
      if (!(name in prev)) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  const openField = (name: string) => {
    const field = fields[name];
    if (!field) return;
    const index = field.enum && field.enum.length > 0
      ? Math.max(0, field.enum.indexOf(draft.values[name] ?? ""))
      : 0;
    setEditing({ name, index });
  };

  const save = () => {
    const result = validateFieldValues(fields, draft.values);
    setDraft({ values: result.values });
    if (!result.ok) {
      setErrors(result.errors);
      const first = entries.findIndex(([name]) => result.errors[name] !== undefined);
      if (first >= 0) setSelected(first);
      return;
    }
    setErrors({});
    onSubmit(result.values);
  };

  if (editing) {
    const name = editing.name;
    const field = fields[name];
    const current = draft.values[name] ?? "";

    if (field?.enum && field.enum.length > 0) {
      const options = field.enum;
      return (
        <Modal
          open
          title={field.label}
          width={56}
          onClose={() => setEditing(null)}
          listLength={options.length}
          selectedListIndex={editing.index}
          onListNavigate={(index) => setEditing({ name, index })}
          onListActivate={(index) => {
            setDraft((prev) => setDraftValue(fields, prev, name, options[index]));
            clearError(name);
            setEditing(null);
          }}
          hint="↑/↓ select · Enter choose · Esc back"
        >
          <box flexDirection="column">
            {options.map((option, index) => (
              <SelectableRow
                key={option}
                selected={index === editing.index}
                label={option}
                trailing={option === field.default ? <text fg={colors.text.muted}>  (default)</text> : undefined}
              />
            ))}
          </box>
        </Modal>
      );
    }

    if (field) {
      return (
        <Modal
          open
          title={title}
          width={64}
          interactive={false}
          onClose={() => setEditing(null)}
          hint="Enter apply · Esc back"
        >
          <FieldInput
            key={name}
            label={`${field.label}${field.required ? " *" : ""}`}
            value={field.secret ? "" : current}
            placeholder={field.secret ? "Enter secret (masked in list)" : field.required ? "Required" : "(optional)"}
            error={errors[name]}
            onSubmit={(text) => {
              setDraft((prev) => setDraftValue(fields, prev, name, text));
              clearError(name);
              setEditing(null);
            }}
            onCancel={() => setEditing(null)}
          />
          {field.secret ? (
            <box marginTop={1}>
              <text fg={colors.text.muted}>Typed text is visible while editing; saved values are masked.</text>
            </box>
          ) : null}
        </Modal>
      );
    }
  }

  return (
    <Modal
      open
      title={title}
      width={64}
      actions={ACTIONS}
      defaultActionKey="save"
      onClose={onCancel}
      onAction={(key) => {
        if (key === "save") save();
        else onCancel();
      }}
      listLength={entries.length}
      selectedListIndex={selected}
      onListNavigate={setSelected}
      onListActivate={(index) => {
        const entry = entries[index];
        if (entry) openField(entry[0]);
      }}
      hint="↑/↓ field · Enter edit · Tab actions · Esc cancel"
    >
      <box flexDirection="column">
        {entries.length === 0 ? (
          <text fg={colors.text.muted}>No configuration fields declared.</text>
        ) : entries.map(([name, field], index) => {
          const value = draft.values[name] ?? "";
          const masked = maskFieldValue(field, value);
          return (
            <box key={name} flexDirection="column">
              <SelectableRow
                selected={index === selected}
                label={field.label}
                labelWidth={22}
                detail={masked || "(not set)"}
                trailing={field.required ? <text fg={colors.status.error}> *</text> : undefined}
              />
              {errors[name] ? (
                <box paddingLeft={4}>
                  <text fg={colors.status.error}>{errors[name]}</text>
                </box>
              ) : null}
            </box>
          );
        })}
      </box>
    </Modal>
  );
}
