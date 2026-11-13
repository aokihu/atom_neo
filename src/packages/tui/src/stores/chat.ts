import { create } from "zustand";
import { createMessageSlice } from "./chat/message-slice";
import { createStreamSlice } from "./chat/stream-slice";
import { createToolSlice } from "./chat/tool-slice";
import { createTelemetrySlice } from "./chat/telemetry-slice";
import type { ChatState } from "./chat/types";

export type { ChatState } from "./chat/types";

export const useChatStore = create<ChatState>()((...args) => ({
  ...createMessageSlice(...args),
  ...createStreamSlice(...args),
  ...createToolSlice(...args),
  ...createTelemetrySlice(...args),
}));
