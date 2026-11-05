import { useState } from "react";
import { Modal } from "../modal";
import { FieldInput } from "./FieldInput";
import { useTheme } from "../theme";
import { OPENROUTER_JEV } from "../wizard-logic";

export function ProvidersModal({ providers, allowJev, onSelect, onAdd, onBack }: {
  providers: string[];
  allowJev: boolean;
  onSelect: (id: string) => void;
  onAdd: (id: string) => void;
  onBack: () => void;
}) {
  const { colors } = useTheme();
  const [adding, setAdding] = useState(false);
  const [newId, setNewId] = useState("");
  const [selected, setSelected] = useState(0);

  if (adding) {
    return (
      <Modal
        open
        title="ADD PROVIDER"
        width={56}
        interactive={false}
        onClose={onBack}
        hint="Enter confirm · Esc cancel"
      >
        <FieldInput
          label="Provider ID"
          value={newId}
          placeholder="e.g. volengine"
          onSubmit={(id) => {
            if (id) {
              setAdding(false);
              setNewId("");
              if (providers.includes(id) || (allowJev && id === OPENROUTER_JEV)) onSelect(id);
              else onAdd(id);
            }
          }}
          onCancel={() => { setAdding(false); setNewId(""); }}
        />
      </Modal>
    );
  }

  const items = providers.length > 0 ? [...providers] : ["deepseek", "openai", "custom"];
  if (allowJev && !providers.includes(OPENROUTER_JEV)) items.push(OPENROUTER_JEV);
  items.push("__add__", "__back__");

  const label = (v: string) => {
    if (v === "__add__") return "➕ Add Provider";
    if (v === "__back__") return "← Back";
    if (v === OPENROUTER_JEV && !providers.includes(v)) return "Add OpenRouter Jev";
    return `Provider: ${v}`;
  };

  return (
    <Modal
      open
      title="PROVIDERS"
      width={52}
      onClose={onBack}
      listLength={items.length}
      selectedListIndex={selected}
      onListNavigate={setSelected}
      onListActivate={(i) => {
        const v = items[i];
        if (v === "__add__") setAdding(true);
        else if (v === "__back__") onBack();
        else onSelect(v);
      }}
      hint="↑/↓ select · Enter edit · Esc back"
    >
      <box flexDirection="column">
        {items.map((v, i) => {
          const isSelected = i === selected;
          return (
            <box key={v} flexDirection="row" backgroundColor={isSelected ? colors.decoration.subtle : undefined}>
              <text fg={isSelected ? colors.text.bright : colors.text.secondary} width={2}>{isSelected ? "▸" : " "}</text>
              <text fg={isSelected ? colors.accent.brand : colors.text.primary}>{label(v)}</text>
            </box>
          );
        })}
      </box>
    </Modal>
  );
}
