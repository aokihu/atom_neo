/** @jsxImportSource react */
import React from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";

const items = [
  { label: "DeepSeek", value: "deepseek" },
  { label: "OpenAI", value: "openai" },
  { label: "Custom (OpenAI-compatible API)", value: "custom" },
];

export function StepProvider({ value, onSubmit }: {
  value: string;
  onSubmit: (provider: string) => void;
}) {
  return (
    <Box flexDirection="column" padding={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>  Welcome to Atom Neo</Text>
        <Text dimColor>  AI Agent Development Platform</Text>
      </Box>
      <Box marginBottom={1}>
        <Text>  Choose your LLM provider:</Text>
      </Box>
      <SelectInput
        items={items}
        initialIndex={items.findIndex(i => i.value === value)}
        onSelect={(item) => onSubmit(item.value)}
      />
      <Box marginTop={1}>
        <Text dimColor>  ↑/↓ to navigate, Enter to select</Text>
      </Box>
    </Box>
  );
}
