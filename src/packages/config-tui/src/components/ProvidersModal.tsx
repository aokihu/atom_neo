import { useState } from "react";
import { Modal } from "../modal";
import { FieldInput, SelectableRow } from "@atom-neo/tui-kit";
import { OPENROUTER_JEV } from "../wizard-logic";
import { MenuScreen } from "../menu/menu-frame";
import type { MenuPreview } from "../menu/menu-frame";
import type { WizardChrome } from "./WizardApp";
import type { WizardState } from "../wizard-logic";

function previewFor(state: WizardState, id: string): MenuPreview {
  if (id === "__add__") return { title: "ADD PROVIDER", lines: ["Create a provider entry.", "", "Enter to type an id."] };
  if (id === "__back__") return { title: "BACK", lines: ["Return to Configure.", "", "Esc back."] };
  const edit = state.editedProviders[id];
  if (!edit) return { title: id.toUpperCase(), lines: ["Not configured."] };
  return {
    title: id.toUpperCase(),
    lines: [
      `Models    ${edit.models.join(", ") || "(none)"}`,
      `API key   ${edit.apiKeyEnv || "(none)"}`,
      edit.type === "jev" ? "Type      jev" : `Thinking  ${edit.thinking}`,
      edit.contextLimit ? `Context   ${edit.contextLimit}` : "",
      "",
      "Enter to edit.",
    ],
  };
}

export function ProvidersModal({ state, allowJev, chrome, onSelect, onAdd, onBack }: {
  state: WizardState;
  allowJev: boolean;
  chrome?: WizardChrome;
  onSelect: (id: string) => void;
  onAdd: (id: string) => void;
  onBack: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newId, setNewId] = useState("");
  const [selected, setSelected] = useState(0);
  const configured = Object.keys(state.editedProviders);
  const items = configured.length > 0 ? [...configured] : ["deepseek", "openai", "custom"];
  if (allowJev && !configured.includes(OPENROUTER_JEV)) items.push(OPENROUTER_JEV);
  items.push("__add__", "__back__");

  const label = (v: string) => {
    if (v === "__add__") return "➕ Add Provider";
    if (v === "__back__") return "‹ Back";
    if (v === OPENROUTER_JEV && !configured.includes(v)) return "Add OpenRouter Jev";
    return v;
  };

  const activate = (value: string) => {
    if (value === "__add__") setAdding(true);
    else if (value === "__back__") onBack();
    else onSelect(value);
  };

  const closeAdd = () => { setAdding(false); setNewId(""); };

  const addForm = adding ? (
    <Modal
      open
      title="ADD PROVIDER"
      width={56}
      interactive={false}
      onClose={closeAdd}
      hint="Enter confirm · Esc cancel"
    >
      <FieldInput
        label="Provider ID"
        value={newId}
        placeholder="e.g. volengine"
        onSubmit={(id) => {
          if (!id) return;
          const exists = configured.includes(id) || (allowJev && id === OPENROUTER_JEV);
          closeAdd();
          if (exists) onSelect(id);
          else onAdd(id);
        }}
        onCancel={closeAdd}
      />
    </Modal>
  ) : null;

  if (chrome) {
    return (
      <>
        <MenuScreen
          title="Providers & Models"
          breadcrumb="Home / Configure / Providers & Models"
          workspace={chrome.workspace}
          gateway={chrome.gateway}
          core={chrome.core}
          items={items.map(value => ({ key: value, label: label(value) }))}
          preview={item => previewFor(state, item.key)}
          suspended={adding}
          onSelect={activate}
          onBack={onBack}
          hint="↑/↓ move · Enter edit · Esc back"
        />
        {addForm}
      </>
    );
  }

  return (
    <>
      <Modal
        open
        title="PROVIDERS"
        width={52}
        onClose={onBack}
        listLength={items.length}
        selectedListIndex={selected}
        onListNavigate={setSelected}
        onListActivate={(i) => activate(items[i]!)}
        hint="↑/↓ select · Enter edit · Esc back"
      >
        <box flexDirection="column">
          {items.map((value, index) => (
            <SelectableRow key={value} selected={index === selected} label={label(value)} />
          ))}
        </box>
      </Modal>
      {addForm}
    </>
  );
}
