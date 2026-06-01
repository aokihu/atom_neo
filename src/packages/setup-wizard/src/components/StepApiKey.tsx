/** @jsxImportSource react */
import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

export function StepApiKey({ activeProvider, apiKey, customBaseUrl, onSubmit, onBack }: {
  activeProvider: string;
  apiKey: string;
  customBaseUrl?: string;
  onSubmit: (apiKey: string, baseUrl?: string, env?: string) => void;
  onBack: () => void;
}) {
  const [key, setKey] = React.useState(apiKey);
  const [baseUrl, setBaseUrl] = React.useState(customBaseUrl ?? "");
  const [envVar, setEnvVar] = React.useState("");
  const [error, setError] = React.useState("");
  const showCustomFields = activeProvider === "custom";

  const handleSubmit = () => {
    if (!key.trim()) {
      setError("API Key is required");
      return;
    }
    setError("");
    onSubmit(key.trim(), baseUrl.trim() || undefined, envVar.trim() || undefined);
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>  {activeProvider === "custom" ? "Custom" : activeProvider.charAt(0).toUpperCase() + activeProvider.slice(1)} API Key Configuration</Text>
      </Box>
      <Box marginBottom={1}>
        <Text>  API Key: </Text>
        <TextInput value={key} onChange={setKey} mask="*" onSubmit={handleSubmit} />
      </Box>
      {showCustomFields && (
        <>
          <Box marginBottom={1}>
            <Text>  Base URL: </Text>
            <TextInput value={baseUrl} onChange={setBaseUrl} onSubmit={handleSubmit} />
          </Box>
          <Box marginBottom={1}>
            <Text>  Env Variable: </Text>
            <TextInput value={envVar} onChange={setEnvVar} onSubmit={handleSubmit} />
          </Box>
        </>
      )}
      {error && (
        <Box marginBottom={1}>
          <Text color="red">  {error}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>  Enter to continue, Esc to go back</Text>
      </Box>
    </Box>
  );
}
