# Input bar hooks

`InputBar.tsx` keeps the textarea, command dispatch and prop wiring.
`isDoubleEscape` is re-exported from `InputBar.tsx`.

| File | Responsibility |
|---|---|
| `use-command-menu.ts` | slash filter, command matches, menu selection/fill |
| `commands.ts` | `resolveCommand`, `dispatchCommand` and command handler contract |
| `use-history-navigation.ts` | Up/Down history browsing and draft restore |
| `use-input-keydown.ts` | Escape/menu/busy key routing for `InputBar` |
| `use-double-escape.ts` | 2s double-escape cancel state, hints and timer cleanup |
| `use-command-menu.test.tsx` | menu selection, command dispatch and history tests |
| `use-double-escape.test.tsx` | timing, cancel and idle-reset tests |
