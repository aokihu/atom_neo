import { useState, useEffect } from "react";
import { useTheme } from "./App";
import { useCopied } from "../stores/copied";

export function StatusBar() {
  const { colors } = useTheme();
  const { copied, setCopied } = useCopied();

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied, setCopied]);

  return (
    <box height={1} flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingRight={2}>
      <box flexDirection="row" gap={1}>
        <text fg={colors.accent.brand}><strong>atom</strong></text>
        <text fg={colors.text.secondary}>neo</text>
      </box>
      <text fg={copied ? colors.status.success : colors.text.muted}>{copied ? "● copied" : "● ready"}</text>
    </box>
  );
}
