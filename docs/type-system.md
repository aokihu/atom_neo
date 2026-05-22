# Type System Conventions

> **Purpose**: Define the shared type contracts used across all packages.
> All types live in `src/src/packages/shared/src/types/`.

---

## 1. Type File Layout

```text
src/src/packages/shared/src/types/
├── index.ts          # Barrel exports
├── task.ts           # TaskItem, TaskState, TaskPayload, TaskPipeline
├── intent.ts         # IntentRequest, IntentRequestType
├── memory.ts         # MemoryNode, MemoryLink, MemoryScope
├── tool.ts           # ToolDefinition, ToolResult, PermissionLevel
├── pipeline.ts       # PipelineResult, PipelineEventMap, FlowState base types
├── session.ts        # SessionContext types
├── config.ts         # Configuration types
└── primitive.ts      # UUID, ISOTimeString, etc.
```

## 2. Task Types

```typescript
// src/src/packages/shared/src/types/task.ts

export enum TaskSource {
  EXTERNAL = "external",
  INTERNAL = "internal",
}

export type TaskItem = {
  readonly id: string;
  readonly chainId: string;
  readonly parentTaskId: string | null;
  readonly sessionId: string;
  readonly chatId: string;
  readonly source: TaskSource;
  readonly pipeline: string;
  readonly priority: number;
  readonly createdAt: number;
  readonly payload: TaskPayload[];
  state: TaskState;             // MUTABLE
  updatedAt: number;            // MUTABLE
};

export enum TaskState {
  WAITING = "waiting",
  PENDING = "pending",
  PROCESSING = "processing",
  COMPLETED = "completed",
  FAILED = "failed",
  FOLLOW_UP = "follow_up",
  DISPATCHED = "dispatched",
  SUSPEND = "suspend",
}

export type TaskPayload =
  | { type: "text"; data: string }
  | { type: "image"; data: string }
  | { type: "audio"; data: string }
  | { type: "tool_report"; data: TaskToolReport }
  | { type: "memory_search_request"; data: MemorySearchRequest };

export type TaskToolCall = {
  toolName: string;
  toolCallId: string;
  input: unknown;
};

export type TaskToolReport = {
  ok: boolean;
  summary: string;
  createdAt: number;
  facts: ToolReportFact[];
};

export type ToolReportFact = {
  key: string;
  toolName: string;
  toolCallId: string;
  target: string;
  summary: string;
  outputSummary: string;
  outputDetail: string;
  errorMessage: string;
  reusable: boolean;
  snapshotText: string;
};
```

## 3. Intent Types

```typescript
// src/src/packages/shared/src/types/intent.ts

export enum IntentRequestType {
  FOLLOW_UP = "follow_up",   // 仅 follow_up 走 IntentRequest 解析（隐蔽调度）
}

export enum IntentRequestSource {
  CONVERSATION = "conversation",
  PREDICTION = "prediction",
}

export type IntentRequest = {
  source: IntentRequestSource;
  request: IntentRequestType;
  intent: string;                     // Human-readable intent description
  params: Record<string, unknown>;   // Type-specific parameters
};

export type FollowUpIntentRequest = IntentRequest & {
  request: IntentRequestType.FOLLOW_UP;
  params: {
    summary: string;
    nextPrompt: string;
    avoidRepeat: string;
  };
};

// NOTE: SEARCH_MEMORY and EXECUTE_TOOL 走 AI SDK streamText tool calling 路径
// 不在 IntentRequest 中；仅 FOLLOW_UP 走尾部文本解析
```

## 4. Pipeline Types

```typescript
// src/src/packages/shared/src/types/pipeline.ts

export enum PipelineResultType {
  Complete = "complete",
  Enqueue = "enqueue",
  SuspendAndEnqueueChild = "suspend_and_enqueue_child",
  ResumeParentAndEnqueue = "resume_parent_and_enqueue",
}

export enum PipelineEnqueueTransition {
  FollowUp = "follow_up",
  Dispatch = "dispatch",
}

export type PipelineResult =
  | { type: typeof PipelineResultType.Complete; task: TaskItem }
  | { type: typeof PipelineResultType.Enqueue; transition: PipelineEnqueueTransition; task: TaskItem; nextTask: TaskItem }
  | { type: typeof PipelineResultType.SuspendAndEnqueueChild; task: TaskItem; childTask: TaskItem }
  | { type: typeof PipelineResultType.ResumeParentAndEnqueue; task: TaskItem; parentTaskId: string; nextTask: TaskItem };

// FlowState base constraint:
export type FlowState = { mode: string };
```

## 5. Pipeline Event Map

```typescript
import type { BaseElement } from "../pipeline/base-element";

export type PipelineEventMap = {
  "element.state-changed": {
    name: string;
    payload: { state: "READY" | "WORKING" | "DONE" | "FAILED" };
  };
  "pipeline.element.started": {
    pipelineName: string;
    elementName: string;
    elementKind: string;
  };
  "pipeline.element.finished": {
    pipelineName: string;
    elementName: string;
    elementKind: string;
    durationMs: number;
  };
  "pipeline.element.failed": {
    pipelineName: string;
    elementName: string;
    elementKind: string;
    durationMs: number;
    error: unknown;
  };
  // Elements can emit custom events via report():
  "element.data": {
    name: string;
    payload: Record<string, unknown>;
  };
};
```

## 6. Primitive Types

```typescript
// src/src/packages/shared/src/types/primitive.ts

export type UUID = string & { readonly __brand: "UUID" };
export type ISOTimeString = string & { readonly __brand: "ISOTimeString" };
```

## 7. Type Export Rules

```typescript
// Barrel exports (index.ts) — export ALL public types:
export type { TaskItem, TaskState, TaskPayload, ... } from "./task";
export type { IntentRequest, IntentRequestType, ... } from "./intent";
export { PipelineResultType, PipelineEnqueueTransition } from "./pipeline";  // Enum → value export
export type { PipelineResult, PipelineEventMap } from "./pipeline";           // Type → type export
```

## 8. Discriminated Union Pattern

```typescript
// ALL discriminated unions in this project follow this pattern:
// - The discriminant field is named: type (for result) or mode (for FlowState)
// - Enum values are used as discriminant literals
// - TypeScript narrows on discriminant comparison

// Pattern:
export type MyUnion =
  | { type: typeof MyEnum.VariantA; fieldA: string }
  | { type: typeof MyEnum.VariantB; fieldB: number };

// Usage:
function handle(input: MyUnion) {
  if (input.type === MyEnum.VariantA) {
    input.fieldA;  // narrowed
  }
}
```
