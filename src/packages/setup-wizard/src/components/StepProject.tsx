/** @jsxImportSource react */
import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

export function StepProject({ value, onSubmit }: {
  value: string;
  onSubmit: (description: string) => void;
}) {
  const [desc, setDesc] = React.useState(value);

  return (
    <Box flexDirection="column" padding={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>  Project Information (optional)</Text>
      </Box>
      <Box marginBottom={1}>
        <Text dimColor>  Describe your project. Written to AGENTS.md.</Text>
      </Box>
      <Box marginBottom={1}>
        <Text>  {">"} </Text>
        <TextInput value={desc} onChange={setDesc} onSubmit={() => onSubmit(desc.trim())} />
      </Box>
      <Box marginTop={1}>
        <Text dimColor>  Enter to continue, Esc to skip and leave empty</Text>
      </Box>
    </Box>
  );
}
