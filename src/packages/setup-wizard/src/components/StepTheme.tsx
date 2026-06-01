/** @jsxImportSource react */
import React from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";

export function StepTheme({ value, themes, onSubmit }: {
  value: string;
  themes: string[];
  onSubmit: (theme: string) => void;
}) {
  const items = themes.map(t => ({ label: t, value: t }));

  return (
    <Box flexDirection="column" padding={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>  Theme Selection</Text>
      </Box>
      <Box marginBottom={1}>
        <Text dimColor>  Choose your terminal UI theme:</Text>
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
