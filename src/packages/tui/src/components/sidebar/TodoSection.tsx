import { useEffect, useRef } from "react";
import { useKeyboard } from "@opentui/react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { useChatStore } from "../../stores/chat";
import { useTheme } from "@atom-neo/tui-kit";
import { EmptyState } from "../EmptyState";
import { TelemetrySection } from "./TelemetrySection";
import { useModalOpen } from "../app/modal-focus-context";

const TODO_ICON: Record<string, string> = {
  pending: "○",
  in_progress: "◐",
  completed: "✓",
  cancelled: "✕",
};

export function TodoSection() {
  const { colors } = useTheme();
  const modalOpen = useModalOpen();
  const items = useChatStore(state => state.todoItems);
  const online = useChatStore(state => state.telemetryOnline);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const active = items.findIndex(item => item.status === "in_progress");
  const activeKey = active < 0 ? undefined : `${active}:${items[active].content}`;
  const followPending = useRef(false);
  const scrolling = items.length > 5;
  useEffect(() => {
    followPending.current = true;
    scrollRef.current?.requestRender();
  }, [activeKey, scrolling]);
  useKeyboard(key => {
    if (modalOpen) return;
    if (!(key.meta || key.option) || key.ctrl || !scrolling) return;
    if (key.name === "up" || key.name === "down") scrollRef.current?.scrollBy(key.name === "up" ? -3 : 3);
  });
  const rows = items.map((item, index) => {
    const iconColor = item.status === "in_progress" ? colors.status.warning
      : item.status === "completed" ? colors.status.success
        : item.status === "cancelled" ? colors.status.error : colors.text.muted;
    return <box key={index} id={`todo-row-${index}`} flexDirection="row" gap={1} flexShrink={0}>
      <text fg={iconColor} flexShrink={0}>{TODO_ICON[item.status] ?? "?"}</text>
      <text flexGrow={1} flexShrink={1} fg={item.status === "in_progress" ? colors.text.secondary : colors.text.muted}>{item.content}</text>
    </box>;
  });
  return <TelemetrySection title="TODO" meta={active >= 0 ? `▶ ${active + 1} / ${items.length}` : `≡ ${items.length}`}>
    {!online ? <text fg={colors.text.muted}>OFFLINE</text> : items.length === 0 ? <EmptyState /> : <>
      <box flexDirection="row" gap={1}>
        <text fg={colors.status.success}>{`✅${items.filter(item => item.status === "completed").length}`}</text>
        <text fg={colors.text.muted}>{`⌛${items.filter(item => item.status === "pending").length}`}</text>
        <text fg={colors.status.warning}>{`▶${items.filter(item => item.status === "in_progress").length}`}</text>
        <text fg={colors.text.muted}>{`✕${items.filter(item => item.status === "cancelled").length}`}</text>
      </box>
      {scrolling ? <scrollbox id="todo-scroll" ref={scrollRef} height={15} flexShrink={0} scrollX={false}
        onSizeChange={() => { followPending.current = true; }}
        renderAfter={() => {
          if (!followPending.current) return;
          followPending.current = false;
          if (active >= 0) scrollRef.current?.scrollChildIntoView(`todo-row-${active}`);
        }}>
        {rows}
      </scrollbox> : rows}
    </>}
  </TelemetrySection>;
}
