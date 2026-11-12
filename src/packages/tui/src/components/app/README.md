# App modal

| File | Responsibility |
|---|---|
| `app-modal-config.tsx` | `ActiveModal` union + `MODAL_CONFIG` table (title/width/height/actions/default action/render/onAction) |
| `AppModal.tsx` | Renders the active non-settings modal through the shared `Modal` component |
| `modal-focus-context.tsx` | exposes whether a modal is open so background global shortcuts stay idle |
| `AppModal.test.tsx` | Behavior snapshot for the config table and modal interactions |

`settings` is rendered by `SettingsModal`; its entry only keeps the table exhaustive.
