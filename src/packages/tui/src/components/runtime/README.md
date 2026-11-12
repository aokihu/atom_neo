# Runtime sidebar sections

`RuntimeSidebar.tsx` keeps the uptime timer and section composition. It
re-exports `derivePipelineSteps` plus `PipelineState` / `PipelineStep` types.

| File | Responsibility |
|---|---|
| `runtime-steps.ts` | pipeline step derivation and tool phase counts |
| `RuntimeSection.tsx` | shared section frame and pipeline state colors |
| `RuntimeSessionSection.tsx` | session activity, uptime and queue |
| `RuntimePipelineSection.tsx` | RECEIVE/THINK/TOOLS/RESPOND states |
| `RuntimeDecisionSection.tsx` | prediction and post-conversation decisions |
| `RuntimeStreamSection.tsx` | stream activity bars, token estimate and chunks |
| `RuntimeStatsSection.tsx` | message and tool outcome totals |
| `runtime-steps.test.ts` | step/phase derivation matrix |
