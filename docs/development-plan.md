# Development Plan

> **Purpose**: Track project progress by phase. Each phase must complete before the next begins.

---

## P1: Foundation

**预估**: 1 周 | **状态**: pending

| 任务 | 文件 | 说明 |
|------|------|------|
| Shared types | `packages/shared/src/types/*.ts` | TaskItem, TaskState, FlowState, ToolDefinition 等全部类型定义 |
| Pipeline core | `packages/shared/src/pipeline/*.ts` | BaseElement, PipelineRunner, PipelineEventBus, 类型常量 |
| Log system | `packages/shared/src/log/*.ts` | Hub-and-Sink log, stdout/file/pipe sinks |

---

## P2: Core Engine

**预估**: 1.5 周 | **状态**: pending

| 任务 | 文件 | 说明 |
|------|------|------|
| TaskEngine | `packages/core/src/task-engine.ts` | 事件驱动调度器，替代 runloop |
| TaskQueue | `packages/core/src/task-queue.ts` | Priority task queue |
| TaskFactory | `packages/core/src/task-factory.ts` | createTaskItem, createContinuationTask |
| SessionStore | `packages/core/src/session/store.ts` | Map-based in-memory session store |
| SessionContext | `packages/core/src/session/context.ts` | Per-session context (messages, facts, tool/memory state) |

---

## P3: Tools & Pipelines

**预估**: 1 周 | **状态**: pending

| 任务 | 文件 | 说明 |
|------|------|------|
| ToolRegistry | `packages/core/src/tools/registry.ts` | 动态注册/卸载 Tool |
| ToolExecutor | `packages/core/src/tools/executor.ts` | Tool 执行，权限校验 |
| FS tools | `packages/core/src/tools/builtin/fs.ts` | read, write, ls, grep, tree, cp, mv |
| Bash tool | `packages/core/src/tools/builtin/bash.ts` | 受控 shell 执行 |
| Memory tools | `packages/core/src/tools/builtin/memory.ts` | search, save, traverse, link, recall |

---

## P4: Pipeline Builder

**预估**: 1.5 周 | **状态**: pending

| 任务 | 文件 | 说明 |
|------|------|------|
| PipelineBuilder DSL | `packages/core/src/pipeline/builder.ts` | source().transform().boundary().sink().build() |
| Element Registry | `packages/core/src/pipeline/registry.ts` | registerElement / resolveElement |
| Conversation pipeline | `packages/core/src/pipelines/conversation/` | 主对话管线 + 7 Element |
| Prediction pipeline | `packages/core/src/pipelines/prediction/` | 意图预测管线 |
| Follow-up pipeline | `packages/core/src/pipelines/follow-up/` | 追问管线 |

---

## P5: Server & Protocol

**预估**: 1 周 | **状态**: pending

| 任务 | 文件 | 说明 |
|------|------|------|
| HTTP server | `packages/core/src/server.ts` | Bun.serve HTTP + WebSocket |
| WebSocket handler | `packages/core/src/ws/handler.ts` | WebSocket upgrade + message routing |
| Broadcast | `packages/core/src/ws/broadcaster.ts` | Fan-out events to connected clients |
| Replay system | `packages/core/src/replay/*.ts` | Pipeline 录制与重放 |
| API routes | `packages/core/src/api/*.ts` | POST /api/tasks, GET /api/tasks/:id, health, metrics |

---

## P6: Gateway

**预估**: 0.5 周 | **状态**: pending

| 任务 | 文件 | 说明 |
|------|------|------|
| Gateway server | `packages/gateway/src/server.ts` | HTTP server (Bun.serve) |
| JWT auth | `packages/gateway/src/auth/jwt.ts` | JWT verification middleware |
| Permission | `packages/gateway/src/permission/checker.ts` | PermissionLevel evaluation |
| Rate limit | `packages/gateway/src/ratelimit/limiter.ts` | Token bucket rate limiter |
| Core proxy | `packages/gateway/src/proxy/core-proxy.ts` | HTTP proxy to Core |

---

## P7: TUI

**预估**: 1 周 | **状态**: pending

| 任务 | 文件 | 说明 |
|------|------|------|
| TUI app entry | `packages/tui/src/app.tsx` | TUI application bootstrap |
| WS client | `packages/tui/src/client/ws-client.ts` | WebSocket client (connects to Core) |
| Session manager | `packages/tui/src/session/manager.ts` | Session lifecycle management |
| Stream renderer | `packages/tui/src/renderer/stream.ts` | Streaming text renderer |
| Tool display | `packages/tui/src/renderer/tools.ts` | Tool call rendering |
| Chat view | `packages/tui/src/views/chat.tsx` | Main chat interface |

---

## P8: Integration

**预估**: 0.5 周 | **状态**: pending

| 任务 | 文件 | 说明 |
|------|------|------|
| E2E tests | `tests/e2e/` | Full pipeline end-to-end tests |
| Deployment | `deploy/` | Docker compose, systemd, env config |
| Documentation | `docs/*.md` | Complete documentation suite |

---

## Summary

| Phase | Name | Tasks | Status | Estimate |
|-------|------|-------|--------|----------|
| P1 | Foundation | 3 | pending | 1 week |
| P2 | Core Engine | 5 | pending | 1.5 weeks |
| P3 | Tools & Pipelines | 5 | pending | 1 week |
| P4 | Pipeline Builder | 5 | pending | 1.5 weeks |
| P5 | Server & Protocol | 5 | pending | 1 week |
| P6 | Gateway | 5 | pending | 0.5 weeks |
| P7 | TUI | 6 | pending | 1 week |
| P8 | Integration | 3 | pending | 0.5 weeks |

**Total: 37 tasks, ~8 weeks**
