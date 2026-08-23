import { useState } from "react";
import { Modal } from "../modal";
import { FieldInput } from "./FieldInput";
import { useTheme } from "../theme";

type Phase = "key" | "env" | "baseUrl";

export function ApiKeyModal({ provider, apiKey, apiKeyEnv, baseUrl, showEnv, showBaseUrl, onSubmit, onCancel }: {
  provider: string;
  apiKey: string;
  apiKeyEnv: string;
  baseUrl?: string;
  showEnv: boolean;
  showBaseUrl: boolean;
  onSubmit: (apiKey: string, baseUrl?: string, env?: string) => void;
  onCancel: () => void;
}) {
  const { colors } = useTheme();
  const [phase, setPhase] = useState<Phase>("key");
  const [draftKey, setDraftKey] = useState(apiKey);
  const [draftEnv, setDraftEnv] = useState(apiKeyEnv);
  const [draftUrl, setDraftUrl] = useState(baseUrl ?? "");
  const [error, setError] = useState("");

  const finish = (key: string, env?: string, url?: string) => {
    if (!key) {
      setError("API Key is required");
      setPhase("key");
      return;
    }
    onSubmit(
      key,
      url ?? (showBaseUrl ? draftUrl || undefined : baseUrl || undefined),
      env ?? (showEnv ? draftEnv || undefined : undefined),
    );
  };

  const title = `API KEY — ${provider.toUpperCase()}`;

  if (phase === "env" && showEnv) {
    return (
      <Modal open title={title} width={60} interactive={false} onClose={onCancel} hint="Enter continue · Esc cancel">
        <FieldInput
          label="Env Variable"
          value={draftEnv}
          placeholder="e.g. VOLENGINE_API_KEY"
          onSubmit={(env) => {
            if (showBaseUrl) {
              setDraftEnv(env);
              setPhase("baseUrl");
            } else {
              finish(draftKey, env);
            }
          }}
          onCancel={() => setPhase("key")}
        />
      </Modal>
    );
  }

  if (phase === "baseUrl" && showBaseUrl) {
    return (
      <Modal open title={title} width={60} interactive={false} onClose={onCancel} hint="Enter continue · Esc cancel">
        <FieldInput
          label="Base URL"
          value={draftUrl}
          placeholder="(optional, leave empty to unset)"
          onSubmit={(url) => {
            finish(draftKey, undefined, url);
          }}
          onCancel={() => setPhase(showEnv ? "env" : "key")}
        />
      </Modal>
    );
  }

  return (
    <Modal open title={title} width={60} interactive={false} onClose={onCancel} hint="Enter continue · Esc cancel">
      <box flexDirection="column">
        <FieldInput
          label="API Key"
          value={draftKey}
          placeholder="sk-..."
          error={error}
          onSubmit={(key) => {
            setDraftKey(key);
            setError("");
            if (showEnv) setPhase("env");
            else if (showBaseUrl) setPhase("baseUrl");
            else finish(key);
          }}
          onCancel={onCancel}
        />
        <box marginTop={1}>
          <text fg={colors.text.muted}>Plaintext input — stored in .env only</text>
        </box>
      </box>
    </Modal>
  );
}
