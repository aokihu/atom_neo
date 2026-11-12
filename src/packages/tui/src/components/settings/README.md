# Settings modal internals

`SettingsModal.tsx` renders rows and wires the shared `Modal`. Configuration
model helpers are re-exported from `SettingsModal.tsx` for existing imports.

| File | Responsibility |
|---|---|
| `settings-model.ts` | options, values, runtime patch, server info, rows, headers |
| `use-settings-config.ts` | `/api/config` load, PATCH and DELETE state/error handling |
| `settings-model.test.ts` | pure row/value/patch behavior |
| `use-settings-config.test.tsx` | fake-fetch request, success and failure paths |
