/** @jsxImportSource react */
import React from "react";
import { Box, Text } from "ink";
import { useInput } from "ink";
import type { WizardState } from "../types";
import { mkdirSync, existsSync, readFileSync } from "node:fs";

export function StepConfirm({ state, sandboxPath, onConfirm, onBack }: {
  state: WizardState;
  sandboxPath: string;
  onConfirm: () => void;
  onBack: () => void;
}) {
  useInput((_, input) => {
    if (input.escape) onBack();
    if (input.return) {
      commit(state, sandboxPath);
      onConfirm();
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>  Configuration Summary</Text>
      </Box>
      <Box marginBottom={1}>
        <Text>  Provider:    </Text>
        <Text color="cyan">{state.provider}</Text>
      </Box>
      <Box marginBottom={1}>
        <Text>{`  API Key:     ${"*".repeat(Math.min(state.apiKey.length, 16))}`}</Text>
      </Box>
      {state.customBaseUrl && (
        <Box marginBottom={1}>
          <Text>{`  Base URL:    ${state.customBaseUrl}`}</Text>
        </Box>
      )}
      <Box marginBottom={1}>
        <Text>  Advanced:    </Text>
        <Text color="cyan">{state.profiles.advanced}</Text>
      </Box>
      <Box marginBottom={1}>
        <Text>  Balanced:    </Text>
        <Text color="cyan">{state.profiles.balanced}</Text>
      </Box>
      <Box marginBottom={1}>
        <Text>  Basic:       </Text>
        <Text color="cyan">{state.profiles.basic}</Text>
      </Box>
      <Box marginBottom={1}>
        <Text>  Theme:       </Text>
        <Text color="cyan">{state.theme}</Text>
      </Box>
      {state.projectDescription ? (
        <Box marginBottom={1}>
          <Text>{`  Project:     ${state.projectDescription.slice(0, 50)}${state.projectDescription.length > 50 ? "..." : ""}`}</Text>
        </Box>
      ) : (
        <Box marginBottom={1}>
          <Text dimColor>  Project:     (skipped)</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text bold color="green">  [ Confirm & Save ]</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>  Enter to confirm, Esc to go back</Text>
      </Box>
    </Box>
  );
}

function commit(state: WizardState, sandboxPath: string): void {
  mkdirSync(sandboxPath, { recursive: true });

  const config: Record<string, unknown> = {
    version: 2,
  };

  if (existsSync(`${sandboxPath}/config.json`)) {
    try {
      Object.assign(config, JSON.parse(readFileSync(`${sandboxPath}/config.json`, "utf-8")));
    } catch {}
  }

  Object.assign(config, {
    providerProfiles: state.profiles,
    providers: {
      [state.provider]: {
        apiKeyEnv: state.apiKeyEnv,
        models: state.models,
        ...(state.customBaseUrl ? { baseUrl: state.customBaseUrl } : {}),
        thinking: "disabled" as const,
      },
    },
    tui: { theme: state.theme },
  });

  Bun.write(`${sandboxPath}/config.json`, JSON.stringify(config, null, 2) + "\n");

  const envPath = `${sandboxPath}/.env`;
  let envContent = "";
  if (existsSync(envPath)) {
    envContent = readFileSync(envPath, "utf-8");
  }
  const envLine = `${state.apiKeyEnv}=${state.apiKey}`;
  if (!envContent.includes(`${state.apiKeyEnv}=`)) {
    envContent += (envContent.endsWith("\n") ? "" : "\n") + envLine + "\n";
  } else {
    envContent = envContent.replace(
      new RegExp(`^${state.apiKeyEnv}=.*`, "m"),
      envLine,
    );
  }
  Bun.write(envPath, envContent);

  if (state.projectDescription) {
    const template = [
      "# 项目开发指引",
      "",
      "## 代码规范",
      "- 遵循 \"Less code, more power\" 原则，代码精简干练",
      "- 避免重复创建相似功能，复用已有代码",
      "- 先思考后编写，禁止盲目编写",
      "",
      "## 项目信息",
      state.projectDescription,
      "",
    ].join("\n");
    Bun.write(`${sandboxPath}/AGENTS.md`, template);
  }

  mkdirSync(`${sandboxPath}/.atom`, { recursive: true });
  Bun.write(`${sandboxPath}/.atom/installed`, "");
}
