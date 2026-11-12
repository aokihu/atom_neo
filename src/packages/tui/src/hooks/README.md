# TUI chat hooks

`useChat` owns the React lifecycle and send/cancel API; transport event routing lives in
`chat-connection`, and pure snapshot/message helpers live in `chat-messages`.

| File | Responsibility |
|---|---|
| `useChat.ts` | connection lifecycle, send/cancel/compact, message helpers |
| `chat-connection.ts` | `TuiClient` → chat store event bindings; connection facade |
| `chat-messages.ts` | snapshot projection, user-message submission and send error handling |
| `chat-errors.ts` | classify client errors (API key, connection, task) |
| `use-tui-focus.ts` | terminal/modal focus ownership: input ref, modal focus ref, terminal `useFocus` restore |
| `chat-connection.test.ts` | event order, cleanup, send/cancel and error paths |
| `useChat.test.ts` | hook lifecycle and fallback behavior |
| `use-tui-focus.test.tsx` | terminal activation, modal open/close and focus restoration |
