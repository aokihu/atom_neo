# Sidebar sections

`Sidebar.tsx` only composes the telemetry sections. Public helpers
(`SIDEBAR_WIDTH`, `SIDEBAR_CONTENT_WIDTH`, `buildGauge`, `TelemetrySection`,
`RoundsSection`, `TodoSection`) are re-exported from `Sidebar.tsx`.

| File | Responsibility |
|---|---|
| `sidebar-metrics.ts` | width constants, gauge/percent formatting, tool/network summaries |
| `TelemetrySection.tsx` | shared titled section frame |
| `ContextSection.tsx` | context gauge and token counts |
| `RoundsSection.tsx` | round allowance, window usage, pause state |
| `TodoSection.tsx` | todo counts, rows, follow-scroll and keyboard scrolling |
| `ToolsSection.tsx` | recent tool calls and running count |
| `McpSection.tsx` | MCP server online state |
| `NetworkSection.tsx` | webfetch totals |
| `sidebar-metrics.test.ts` | derived telemetry values |
