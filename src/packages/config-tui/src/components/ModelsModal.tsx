import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { Modal } from "../modal";
import { FieldInput } from "./FieldInput";
import { useTheme } from "../theme";
import { addModel, removeModelAt, parseContextLimit } from "../wizard-logic";
import type { ThinkingMode } from "../wizard-logic";

const THINKING_LABELS = [
  { label: "disabled (default)", value: "disabled" },
  { label: "enabled (forced thinking)", value: "enabled" },
  { label: "adaptive (model decides)", value: "adaptive" },
];

type Phase = "list" | "add" | "baseUrl" | "thinking" | "contextLimit";

export function ModelsModal({ provider, models, baseUrl, thinking, contextLimit, onSubmit, onCancel }: {
  provider: string;
  models: string[];
  baseUrl?: string;
  thinking: ThinkingMode;
  contextLimit?: number;
  onSubmit: (patch: { models: string[]; baseUrl?: string; thinking: ThinkingMode; contextLimit?: number }) => void;
  onCancel: () => void;
}) {
  const { colors } = useTheme();
  const [phase, setPhase] = useState<Phase>("list");
  const [list, setList] = useState<string[]>(models);
  const [selected, setSelected] = useState(0);
  const [draftUrl, setDraftUrl] = useState(baseUrl ?? "");
  const [draftThinking, setDraftThinking] = useState<ThinkingMode>(thinking);
  const [draftLimit, setDraftLimit] = useState(contextLimit ? String(contextLimit) : "");
  const [error, setError] = useState("");

  // 'd' deletes the highlighted model in the list phase (Modal handles the rest)
  useKeyboard((event) => {
    if (phase !== "list") return;
    if (event.name === "d" && selected >= 0 && selected < list.length) {
      setList(prev => removeModelAt(prev, selected));
    }
  });

  const close = () => {
    if (phase === "list") onCancel();
    else setPhase("list");
  };

  const finalize = () => {
    if (list.length === 0) {
      setError("At least one model is required — Esc to cancel this provider edit");
      return;
    }
    if (!draftLimit.trim()) {
      onSubmit({ models: list, baseUrl: draftUrl.trim() || undefined, thinking: draftThinking, contextLimit: undefined });
      return;
    }
    const parsed = parseContextLimit(draftLimit);
    if (parsed === undefined) {
      setError("Context limit must be a positive integer");
      return;
    }
    onSubmit({ models: list, baseUrl: draftUrl.trim() || undefined, thinking: draftThinking, contextLimit: parsed });
  };

  const title = `MODELS — ${provider.toUpperCase()}`;

  if (phase === "add") {
    return (
      <Modal open title={title} width={56} interactive={false} onClose={onCancel} hint="Enter add · Esc back">
        <FieldInput
          label="Model name"
          value=""
          placeholder="e.g. deepseek-v4-max"
          onSubmit={(name) => {
            if (name) setList(prev => addModel(prev, name));
            setPhase("list");
          }}
          onCancel={() => setPhase("list")}
        />
      </Modal>
    );
  }

  if (phase === "baseUrl") {
    return (
      <Modal open title={title} width={60} interactive={false} onClose={onCancel} hint="Enter continue · Esc back">
        <FieldInput
          label="Base URL"
          value={draftUrl}
          placeholder="(optional, leave empty to unset)"
          onSubmit={(url) => { setDraftUrl(url); setPhase("thinking"); }}
          onCancel={() => setPhase("list")}
        />
      </Modal>
    );
  }

  if (phase === "thinking") {
    return (
      <Modal
        open
        title={title}
        width={56}
        onClose={close}
        listLength={THINKING_LABELS.length}
        selectedListIndex={THINKING_LABELS.findIndex(t => t.value === draftThinking)}
        onListNavigate={(i) => setDraftThinking(THINKING_LABELS[i].value as ThinkingMode)}
        onListActivate={() => setPhase("contextLimit")}
        hint="↑/↓ select · Enter continue · Esc back"
      >
        <box flexDirection="column">
          {THINKING_LABELS.map((t, i) => {
            const isSelected = t.value === draftThinking;
            return (
              <box key={t.value} flexDirection="row" backgroundColor={isSelected ? colors.decoration.subtle : undefined}>
                <text fg={isSelected ? colors.text.bright : colors.text.secondary} width={2}>{isSelected ? "▸" : " "}</text>
                <text fg={isSelected ? colors.accent.brand : colors.text.primary}>{t.label}</text>
              </box>
            );
          })}
        </box>
      </Modal>
    );
  }

  if (phase === "contextLimit") {
    return (
      <Modal open title={title} width={56} interactive={false} onClose={onCancel} hint="Enter finish · Esc back">
        <FieldInput
          label="Context tokens"
          value={draftLimit}
          placeholder="(optional, e.g. 131072)"
          error={error}
          onSubmit={() => finalize()}
          onCancel={() => setPhase("thinking")}
        />
      </Modal>
    );
  }

  const items = [...list, "__add__"];

  return (
    <Modal
      open
      title={title}
      width={56}
      onClose={close}
      listLength={items.length}
      selectedListIndex={selected}
      onListNavigate={setSelected}
      onListActivate={(i) => {
        if (items[i] === "__add__") setPhase("add");
        else setPhase("baseUrl");
      }}
      hint="↑/↓ select · Enter edit · d delete · Esc back"
    >
      <box flexDirection="column">
        {items.map((m, i) => {
          const isSelected = i === selected;
          const isAdd = m === "__add__";
          return (
            <box key={m} flexDirection="row" backgroundColor={isSelected ? colors.decoration.subtle : undefined}>
              <text fg={isSelected ? colors.text.bright : colors.text.secondary} width={2}>{isSelected ? "▸" : " "}</text>
              <text fg={isSelected ? colors.accent.brand : isAdd ? colors.text.muted : colors.text.primary}>
                {isAdd ? "➕ Add model..." : m}
              </text>
            </box>
          );
        })}
      </box>
    </Modal>
  );
}
