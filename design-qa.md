# TUI Design QA

## Evidence

- Source visual truth:
  `/Users/aokihu/.codex/generated_images/019f7806-702e-70c1-92fd-1b149128f989/call_OUYmMAjddnbPyJin497mMB6d.png`
- Implementation screenshot: `/tmp/atom-neo-tui-implementation.png`
- Combined comparison: `/tmp/atom-neo-design-qa-comparison.png`
- Viewport: `160 x 48` terminal cells.
- Source pixels: `1619 x 971`.
- Implementation pixels: `1600 x 960`, rendered at `10 x 20` pixels per terminal cell.
- Density normalization: both full views were placed in one `1600 x 960` comparison
  viewport and scaled to `788 x 472` for composition review. The Tool execution
  region was also compared at native pixel density in the same input.
- State: active Session, Tool execution in progress, populated Context / MCP / TODO /
  Network telemetry, busy Command input.

## Findings

No actionable P0, P1, or P2 visual differences remain.

- Fonts and typography: both source and implementation use a single monospaced
  hierarchy. The implementation uses the terminal's configured monospace fallback;
  label weight, status color, wrapping, and truncation remain legible.
- Spacing and layout rhythm: the implementation preserves the three-column desktop
  structure, expands Conversation, narrows both sidebars, and keeps the input and
  footer persistent without overflow.
- Colors and visual tokens: the `edex` palette preserves the near-black base, slightly
  brighter central surface, dim sidebars, cyan focus, green success, amber active,
  and red error semantics. Passive telemetry is visibly subordinate.
- Image quality and asset fidelity: the TUI contains no raster assets, icons, gradients,
  shadows, or web-only effects. All visible treatments are OpenTUI character-cell
  primitives.
- Copy and content: visible data comes from current Store state. Tool rows expose
  `state / name / summary` without leaking raw protocol markup.

Accepted implementation constraints:

- Runtime uses four observable stages instead of inventing a separate `PLAN` event.
- Activity and statistics reflect current Store data rather than the illustrative
  history values in the source mock.
- Busy Command state uses the warning semantic color while the source shows a neutral
  focus state.

## Comparison History

### Pass 1 — blocked

- [P2] Top status spacing placed `THINKING` too far to the right.
- [P2] Tool input and detail used separate rows, making Tool execution visually
  heavier than the source.

Fixes:

- Replaced the flexible model segment with fixed model / thinking widths and moved
  remaining space before the version.
- Compressed each Tool invocation into one `state / name / summary` row.

### Pass 2 — passed

Post-fix evidence:

- Full-view comparison confirms the central Conversation is the only high-contrast
  plane and both sidebars recede.
- Focused comparison confirms Tool execution uses a single thin border and compact
  rows.
- `120 x 40` renders Conversation + Telemetry without horizontal overflow.
- `80 x 24` hides both sidebars and retains the Command input and footer.
- Browser-rendered comparison reported no console errors.

### Pass 3 — CONTEXT gauge width

Source:

- `/var/folders/3_/28hb0c0n6vz47lphq3w0s15r0000gn/T/codex-clipboard-4d9ca3f3-2872-4467-b2b5-598ca163a82a.png`

Finding:

- [P2] The Context gauge used a fixed character width and left unused horizontal
  space inside the Telemetry sidebar.

Fix:

- Derived the gauge width from the 30-column sidebar width after subtracting its
  left border and horizontal padding.
- Added a regression test requiring the rendered gauge to occupy all 27 available
  terminal cells.

Post-fix evidence:

- `/tmp/atom-neo-context-gauge-implementation.png`
- The zero-percent state renders 27 dim cells and reaches the right content edge
  while preserving the percentage and token-count alignment.

### Pass 4 — STREAM activity truthfulness

Finding:

- [P2] Runtime Activity used a fixed busy / idle waveform that looked like live
  telemetry without representing received stream data.

Fix:

- Replaced the fixed waveform with the latest 8 Reason / Text Delta batches.
- Each batch is converted to an estimated Token count and normalized against the
  largest batch in the visible window before mapping to the 8 terminal bar levels.
- Empty positions remain blank; the cumulative estimate uses `≈` and the exact
  received chunk count remains visible.

Post-fix evidence:

- Unit coverage verifies window trimming, maximum-based normalization, empty state,
  cumulative estimation, and reset before a new task.

### Pass 5 — completed Tool disclosure

Source:

- `/var/folders/3_/28hb0c0n6vz47lphq3w0s15r0000gn/T/codex-clipboard-1cc9cb7a-3e3b-4f59-9ebe-c963e22c212b.png`
- `/var/folders/3_/28hb0c0n6vz47lphq3w0s15r0000gn/T/codex-clipboard-4bbf7d2c-86e1-40db-8ef2-65fe23ce561f.png`

Finding:

- [P2] Completed Tool Groups remained as full-width bordered blocks and consumed
  Conversation height after their progress was no longer actionable.

Fix:

- Kept the existing progress Block only while a Tool Group is running.
- Aggregated completed Tool Groups by User Turn and attached them to the latest
  available Thought row as `THOUGHT 5s ▸ │ TOOLS 5/5 ▼`.
- Added a click / Enter disclosure that opens the existing Modal surface with Tool
  state, name, input, and result summaries.

Post-fix evidence:

- Compact implementation: `/tmp/atom-neo-tool-summary-implementation.png`
- Tool details Modal: `/tmp/atom-neo-tool-modal-full.png`
- Reference comparison: `/tmp/atom-neo-tool-summary-comparison.png`
- OpenTUI mouse simulation opened the Modal from the inline Tool summary.
- The completed Tool Block is absent from the Conversation frame; running Tool
  Groups remain covered by Store and placement tests.

## Follow-up Polish

- [P3] A future runtime event may justify a real `PLAN` stage; do not add it until
  Core exposes an observable state.

## Final Result

final result: passed
