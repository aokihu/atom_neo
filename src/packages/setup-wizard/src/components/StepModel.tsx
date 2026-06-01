/** @jsxImportSource react */
import React from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";

const LEVELS = ["advanced", "balanced", "basic"] as const;

const LEVEL_LABELS: Record<string, string> = {
  advanced: "Advanced (complex tasks)",
  balanced: "Balanced (daily use)",
  basic: "Basic (quick tasks)",
};

export function StepModel({ provider, models, profiles, onSubmit }: {
  provider: string;
  models: string[];
  profiles: { advanced: string; balanced: string; basic: string };
  onSubmit: (profiles: { advanced: string; balanced: string; basic: string }) => void;
}) {
  const [activeIdx, setActiveIdx] = React.useState(0);
  const currentProfile = React.useRef({ ...profiles });

  const getModelFromProfile = (profile: string) => {
    const idx = profile.lastIndexOf("/");
    return idx >= 0 ? profile.slice(idx + 1) : profile;
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>  Model Configuration</Text>
      </Box>
      {LEVELS.map((level, i) => {
        const isActive = i === activeIdx;
        const model = getModelFromProfile(currentProfile.current[level]);
        return (
          <Box key={level} flexDirection="column" marginBottom={1}>
            <Text bold={isActive} color={isActive ? "cyan" : undefined}>
              {`  ${LEVEL_LABELS[level]}: ${model}`}
            </Text>
            {isActive && (
              <SelectInput
                items={models.map(m => ({ label: m, value: m }))}
                initialIndex={models.findIndex(m => m === model)}
                onSelect={(item) => {
                  currentProfile.current[level] = `${provider}/${item.value}`;
                  if (activeIdx === LEVELS.length - 1) {
                    onSubmit(currentProfile.current);
                  } else {
                    setActiveIdx((activeIdx + 1) % LEVELS.length);
                  }
                }}
              />
            )}
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text dimColor>  ↑/↓ to select model, Enter to confirm and go to next</Text>
      </Box>
    </Box>
  );
}
