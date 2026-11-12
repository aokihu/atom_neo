import { useCallback, useEffect, useRef } from "react";

export function isDoubleEscape(lastPressTime: number, now: number, windowMs = 2000): boolean {
  return lastPressTime > 0 && now - lastPressTime < windowMs;
}

export function useDoubleEscape({
  busy,
  onCancelTask,
  onCancelHint,
}: {
  busy: boolean;
  onCancelTask?: () => void;
  onCancelHint?: (hint: string | null) => void;
}) {
  const lastCancelPressRef = useRef(0);
  const cancelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (busy) return;
    lastCancelPressRef.current = 0;
    if (cancelTimerRef.current) clearTimeout(cancelTimerRef.current);
    cancelTimerRef.current = null;
    onCancelHint?.(null);
  }, [busy, onCancelHint]);

  useEffect(() => () => {
    if (cancelTimerRef.current) clearTimeout(cancelTimerRef.current);
  }, []);

  const handleEscape = useCallback(() => {
    if (!busy) return;
    const now = Date.now();
    if (isDoubleEscape(lastCancelPressRef.current, now)) {
      lastCancelPressRef.current = 0;
      if (cancelTimerRef.current) clearTimeout(cancelTimerRef.current);
      cancelTimerRef.current = null;
      onCancelHint?.("Cancelling current task...");
      onCancelTask?.();
      return;
    }

    lastCancelPressRef.current = now;
    if (cancelTimerRef.current) clearTimeout(cancelTimerRef.current);
    cancelTimerRef.current = setTimeout(() => {
      lastCancelPressRef.current = 0;
      cancelTimerRef.current = null;
      onCancelHint?.(null);
    }, 2000);
    onCancelHint?.("Press ESC again within 2s to cancel current task");
  }, [busy, onCancelTask, onCancelHint]);

  return { handleEscape };
}
