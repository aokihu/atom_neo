# protocol

Wire-protocol types for the WebSocket contract between the Core and clients.
`../protocol.ts` is the public barrel; these modules are the implementation.

| File | Contents |
|---|---|
| `client-events.ts` | `ClientEvent` union and `ClientEventType` (Client → Core). |
| `server-events.ts` | `ServerEvent` union, `ServerEventType`, and `ServerEventPayload` (Core → Client). |
| `payloads.ts` | Every client/server event payload type, including transport payloads. |
| `guards.ts` | `CLIENT_EVENT_TYPES` / `SERVER_EVENT_TYPES` catalogs and the `isClientEventType` / `isServerEventType` guards. |

The canonical wire strings remain in `../constants/events.ts`; this directory
only derives types and guards from them.
