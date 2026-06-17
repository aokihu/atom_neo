import type { Message } from "../types";
import { useTheme } from "./App";

function truncate(s: unknown, n: number): string {
  const t = typeof s === "string" ? s : JSON.stringify(s);
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

export function ToolMessageBox({ message }: { message: Extract<Message, { role: "tool-group" }> }) {
  const { colors } = useTheme();

  if (message.collapsed && message.summary) {
    const { total, toolNames } = message.summary;
    return (
       <box paddingLeft={2} paddingRight={2}
            marginBottom={1}
            border={["left"]} borderColor={colors.text.muted} borderStyle="heavy">
         <text fg={colors.text.muted}>
           {total} tools ✓ — {toolNames.join(", ")}
         </text>
       </box>
    );
  }

  return (
      <box paddingLeft={2} paddingRight={2}
           marginBottom={1}
           border={["left"]} borderColor={colors.text.muted} borderStyle="heavy">
      {message.entries.map(e => {
        const active = e.phase === "preparing" || e.phase === "executing";
        return (
          <box key={e.toolCallId}>
            <box flexDirection="row" alignItems="center">
              {active && (
                <>
                  <spinner name="line" />
                  <text marginLeft={1} fg={colors.text.muted}>{e.toolName}</text>
                </>
              )}
              {e.phase === "done" && (
                <text fg={colors.status.success}>✓ {e.toolName}</text>
              )}
              {e.phase === "error" && (
                <text selectable fg={colors.status.error}>✕ {e.toolName}: {e.detail}</text>
              )}
            </box>
            {e.input !== undefined && (
              <text fg={colors.text.muted} selectable>  {'↳'} {truncate(e.input, 120)}</text>
            )}
            {e.phase === "done" && e.detail && (
              <text fg={colors.text.muted} selectable>  {'↳'} {truncate(e.detail, 200)}</text>
            )}
          </box>
        );
      })}
    </box>
  );
}
