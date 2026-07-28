import type { ToolEntry, ToolGroupMessage } from "../types";
import { useTheme } from "./App";

function truncate(s: unknown, n: number): string {
  let t: string;
  try {
    t = typeof s === "string" ? s : JSON.stringify(s) ?? String(s);
  } catch {
    t = String(s);
  }
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

function entryState(entry: ToolEntry): "RUN" | "OK" | "ERR" {
  if (entry.phase === "preparing" || entry.phase === "executing") return "RUN";
  return entry.phase === "done" ? "OK" : "ERR";
}

export function summarizeToolGroups(groups: ToolGroupMessage[]) {
  return groups.reduce((summary, group) => {
    const total = group.summary?.total ?? group.entries.length;
    const success = group.summary?.success ?? group.entries.filter(entry => entry.phase === "done").length;
    const failed = group.summary?.failed ?? group.entries.filter(entry => entry.phase === "error").length;
    return {
      total: summary.total + total,
      success: summary.success + success,
      failed: summary.failed + failed,
    };
  }, { total: 0, success: 0, failed: 0 });
}

export function ToolSummaryTrigger({
  groups,
  inline = false,
  onOpen,
}: {
  groups: ToolGroupMessage[];
  inline?: boolean;
  onOpen?: (groups: ToolGroupMessage[]) => void;
}) {
  const { colors } = useTheme();
  const summary = summarizeToolGroups(groups);
  const open = () => onOpen?.(groups);

  return (
    <box
      flexDirection="row"
      marginLeft={inline ? 1 : 2}
      marginBottom={inline ? 0 : 1}
      focusable
      onMouseUp={open}
      onKeyDown={(event) => {
        if (event.name === "return" || event.name === "enter" || event.name === "space") open();
      }}
    >
      {inline && <text fg={colors.decoration.subtle}>│ </text>}
      <text fg={colors.text.muted}>TOOLS </text>
      <text fg={summary.failed > 0 ? colors.status.error : colors.text.muted}>
        {`${summary.success}/${summary.total} ▼`}
      </text>
    </box>
  );
}

export function ToolDetailsContent({ groups }: { groups: ToolGroupMessage[] }) {
  const { colors } = useTheme();
  const entries = groups.flatMap(group => group.entries);

  return (
    <scrollbox flexGrow={1} stickyStart="top">
      {entries.map(entry => {
        const state = entryState(entry);
        const stateColor = state === "RUN" ? colors.status.warning
          : state === "OK" ? colors.status.success
            : colors.status.error;
        return (
          <box key={entry.toolCallId} flexDirection="column" marginBottom={1}>
            <box flexDirection="row">
              <text width={5} fg={stateColor}>{state}</text>
              <text fg={colors.text.primary}>{entry.toolName}</text>
            </box>
            {entry.input !== undefined && (
              <text selectable fg={colors.text.muted}>{`INPUT  ${truncate(entry.input, 180)}`}</text>
            )}
            {entry.detail !== undefined && (
              <text selectable fg={state === "ERR" ? colors.status.error : colors.text.muted}>
                {`${state === "ERR" ? "ERROR" : "RESULT"} ${truncate(entry.detail, 240)}`}
              </text>
            )}
          </box>
        );
      })}
    </scrollbox>
  );
}

export function ToolMessageBox({
  message,
  onOpenDetails,
}: {
  message: ToolGroupMessage;
  onOpenDetails?: (groups: ToolGroupMessage[]) => void;
}) {
  const { colors } = useTheme();

  if (message.collapsed && message.summary) {
    return <ToolSummaryTrigger groups={[message]} onOpen={onOpenDetails} />;
  }

  return (
    <box
      marginLeft={2}
      marginRight={2}
      marginBottom={1}
      paddingLeft={1}
      paddingRight={1}
      paddingBottom={1}
      border
      borderColor={colors.decoration.subtle}
      borderStyle="single"
      backgroundColor={colors.bg.popup}
      flexDirection="column"
    >
      <text fg={colors.accent.brand}>TOOLS EXECUTION</text>
      {message.entries.map(e => {
        const state = entryState(e);
        const active = state === "RUN";
        const summary = e.detail ?? e.input;
        const stateColor = active ? colors.status.warning
          : e.phase === "done" ? colors.status.success
            : colors.status.error;
        return (
          <box key={e.toolCallId} flexDirection="row">
            <text width={5} fg={stateColor}>{state}</text>
            <text width={22} fg={colors.text.primary}>{e.toolName}</text>
            {summary !== undefined && (
              <text flexGrow={1} fg={colors.text.muted} selectable>{truncate(summary, 80)}</text>
            )}
          </box>
        );
      })}
    </box>
  );
}
