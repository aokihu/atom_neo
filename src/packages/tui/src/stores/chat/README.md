# Chat store slices

`useChatStore` is composed from four `StateCreator` slices. The public
`ChatState` type and `useChatStore` export live in `../chat.ts`; action names,
state fields, and direct `useChatStore.setState` calls are unchanged.

| File | Responsibility |
|---|---|
| `types.ts` | `ChatState` / slice action types, `ToolEventParams` |
| `message-slice.ts` | messages, id generation, transient message removal |
| `stream-slice.ts` | delta/reason ingestion, stream counters, busy/prepare flags |
| `tool-slice.ts` | tool group creation, entry updates, step/group completion |
| `telemetry-slice.ts` | context tokens, todos, rounds, tool/MCP metadata, decisions |

Slices may call actions from other slices through `get()` (for example the tool
slice calls `generateId`); all cross-slice access is typed through `ChatState`.
