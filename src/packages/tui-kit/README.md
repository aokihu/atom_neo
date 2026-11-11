# @atom-neo/tui-kit

Shared OpenTUI primitives for `@atom-neo/tui` (chat) and `@atom-neo/config-tui` (wizard).
Depends only on `@atom-neo/shared`, OpenTUI, and React.

## Layout

| Path | Responsibility |
|------|----------------|
| `src/theme.tsx` | Single palette source (`THEMES`), `getTheme`, `ThemeProvider`, `useTheme` |
| `src/modal/Modal.tsx` | Modal layout, positioning, keyboard state |
| `src/modal/ModalActionBar.tsx` | Action button row |
| `src/modal/types.ts` | Shared Modal types (`ModalProps`, `ModalAction`, anchor types, `chrome`, `hint`) |
| `src/components/FieldInput.tsx` | Single-line modal form field |
| `src/components/SelectableRow.tsx` | `▸` + selected-background list row |

## Theme provider

`ThemeProvider` accepts either form:

```tsx
// config-tui: theme name
<ThemeProvider theme={wizard.theme}>

// tui: precomputed colors + syntax style
<ThemeProvider value={theme}>
```

`getTheme(name)` falls back to `DEFAULT_THEME` for unknown names.

## Modal keyboard map

Modes are selected by whether `listLength > 0`.

| Mode | Keys |
|------|------|
| Both | `Esc` closes |
| List | `Up`/`Down` navigate the list; `Enter` activates the list item |
| List | `Tab`/`Left`/`Right` focus the action bar without moving list selection |
| List, actions focused | `Left`/`Right`/`Tab` cycle actions; `Enter` triggers the action |
| Non-list | `Tab`/`Right` next action, `Left` previous action, `Enter` triggers |

`chrome="plain"` (default) is the chat TUI look; `chrome="bordered"` adds the config
wizard border. `hint` renders a muted helper line below the action bar.
