export function fmtTime(ts: number): string {
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

export function formatDuration(seconds: number): string {
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m`;
  return `${seconds}s`;
}

export function formatUptime(totalSec: number): string {
  if (totalSec < 60) return `${totalSec}s`;
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return `${d > 0 ? `${d}d` : ""}${h > 0 ? `${h}h` : ""}${m}m`;
}

const STREAM_LEVELS = "▁▂▃▄▅▆▇█";

export function buildNormalizedStreamActivity(tokenBatches: number[], width = 8): string {
  const samples = tokenBatches.slice(-width).map(tokens => Math.max(0, tokens));
  const max = Math.max(0, ...samples);
  if (max === 0) return " ".repeat(width);
  const bars = samples.map(tokens => {
    const level = Math.max(1, Math.ceil((tokens / max) * STREAM_LEVELS.length));
    return STREAM_LEVELS[level - 1];
  });
  return bars.join("").padStart(width, " ");
}

export function estimateReceivedTokens(receivedChars: number): number {
  return receivedChars > 0 ? Math.ceil(receivedChars / 4) : 0;
}
