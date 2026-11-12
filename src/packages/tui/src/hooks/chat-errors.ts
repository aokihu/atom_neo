import { TaskFailureCodes } from "@atom-neo/shared";

export type ChatClientError = { code: string; title: string; message: string };

export function resolveChatClientError(error: unknown): ChatClientError | undefined {
  const code = typeof (error as { code?: unknown } | null)?.code === "string"
    ? (error as { code: string }).code
    : "";
  if (code !== TaskFailureCodes.ApiKeyInvalid) return undefined;
  return {
    code,
    title: "API Key Invalid",
    message: "The configured API key was rejected by the model provider. Update it and restart Atom Neo.",
  };
}
