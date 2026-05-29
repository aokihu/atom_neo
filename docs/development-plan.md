# Development Plan

> **Purpose**: Track project progress by phase. Each phase must complete before the next begins.

---

## P0: Monorepo Scaffolding ✅

**状态**: completed

| 任务 | 状态 |
|------|------|
| Workspace root `package.json` (4 packages) | ✔ |
| Root `tsconfig.json` base config | ✔ |
| `packages/shared` package skeleton | ✔ |
| `packages/core` package skeleton | ✔ |
| `packages/gateway` package skeleton | ✔ |
| `packages/tui` package skeleton | ✔ |
| `.env.example` template | ✔ |
| Dependencies installed, typecheck passes | ✔ |

---

## P1: Foundation ✅

**预估**: 1 周 | **状态**: completed

| 任务 | 文件 | 说明 |
|------|------|------|
| Shared types | `src/src/packages/shared/src/types/*.ts` | TaskItem, TaskState, FlowState, ToolDefinition 等全部类型定义 |
| Pipeline core | `src/src/packages/shared/src/pipeline/*.ts` | BaseElement, PipelineRunner, PipelineEventBus, 类型常量 |
| Log system | `src/src/packages/shared/src/log/*.ts` | Hub-and-Sink log, stdout/file/pipe sinks |
| Utils | `src/src/packages/shared/src/utils/*.ts` | normalizeError, truncate, slugify, sleep, debounce |
| Protocol | `src/src/packages/shared/src/protocol.ts` | WebSocket 事件类型定义 |
| Tests | `src/src/packages/shared/src/**/*.test.ts` | 28 tests, 100% pass |

---

## P2: Core Engine ✅

**预估**: 1.5 周 | **状态**: completed

| 任务 | 文件 | 说明 |
|------|------|------|
| Config | `src/bootstrap/config.ts` | Zod schema, env/CLI loading |
| TaskEngine | `src/packages/core/src/task-engine.ts` | 事件驱动调度器，替代 runloop |
| TaskQueue | `src/packages/core/src/task-queue.ts` | Priority task queue |
| TaskFactory | `src/packages/core/src/task-factory.ts` | createTaskItem, createContinuationTask |
| SessionStore | `src/packages/core/src/session/store.ts` | Map-based in-memory session store |
| SessionContext | `src/packages/core/src/session/context.ts` | Per-session context |
| Tests | `src/packages/core/src/**/*.test.ts` | 21 tests, 100% pass |

---

## P3: Tools & Pipelines ✅

**预估**: 1 周 | **状态**: completed

| 任务 | 文件 | 说明 |
|------|------|------|
| ToolRegistry | `src/packages/core/src/tools/registry.ts` | 动态注册/卸载 Tool |
| ToolExecutor | `src/packages/core/src/tools/executor.ts` | Tool 执行，权限校验 |
| Permissions | `src/packages/core/src/tools/permissions.ts` | filterToolsByPermission |
| FS tools | `src/packages/core/src/tools/builtin/fs.ts` | read, write, ls, tree, grep, cp, mv |
| Bash tool | `src/packages/core/src/tools/builtin/bash.ts` | 受控 shell 执行 |
| Memory tools | `src/packages/core/src/tools/builtin/memory.ts` | search, save, traverse, link |
| Bootstrap | `src/packages/core/src/tools/bootstrap.ts` | registerBuiltinTools (12 tools) |
| Tests | `src/packages/core/src/tools/*.test.ts` | 10 tests, 100% pass |

---

## P4: Pipeline Builder ✅

**预估**: 1.5 周 | **状态**: completed

| 任务 | 文件 | 说明 |
|------|------|------|
| PipelineBuilder DSL | `src/packages/core/src/pipeline/builder.ts` | source/transform/boundary/sink/build |
| Element Registry | `src/packages/core/src/pipeline/registry.ts` | registerElement/resolveElement/clearRegistry |
| PipelineManager | `src/packages/core/src/pipeline/manager.ts` | register/get/reload (带缓存) |
| Conversation pipeline | `src/packages/core/src/pipelines/conversation/` | 5 Element + builder 定义 |
| Prediction pipeline | `src/packages/core/src/pipelines/prediction/` | stub |
| Follow-up pipeline | `src/packages/core/src/pipelines/follow-up/` | stub |
| Tests | `src/packages/core/src/pipeline/*.test.ts` | 16 tests, 100% pass |

---

## P5: Server & Protocol ✅

**预估**: 1 周 | **状态**: completed

| 任务 | 文件 | 说明 |
|------|------|------|
| HTTP server | `src/packages/core/src/server.ts` | Bun.serve HTTP + WebSocket |
| WebSocket handler | `src/packages/core/src/ws/handler.ts` | WS upgrade + message routing |
| Broadcast | `src/packages/core/src/ws/broadcaster.ts` | Fan-out to session clients |
| Replay system | `src/packages/core/src/replay/recorder.ts` | Pipeline 事件录制 |
| Replay player | `src/packages/core/src/replay/player.ts` | Pipeline 事件重放 |
| API routes | `src/packages/core/src/api/*.ts` | POST /api/tasks, health, metrics |
| Tests | `src/packages/core/src/{ws,api,replay}/*.test.ts` | 11 tests, 100% pass |

---

## P6: Gateway ✅

**预估**: 0.5 周 | **状态**: completed

| 任务 | 文件 | 说明 |
|------|------|------|
| Gateway config | `src/packages/gateway/src/config.ts` | Zod schema, env loading |
| JWT auth | `src/packages/gateway/src/auth/jwt.ts` | HMAC-SHA256 sign/verify |
| Permission checker | `src/packages/gateway/src/permissions/checker.ts` | PermissionLevel evaluation |
| Rate limiter | `src/packages/gateway/src/ratelimit/limiter.ts` | Token bucket with burst |
| Core proxy | `src/packages/gateway/src/proxy/core-proxy.ts` | HTTP proxy to Core |
| Gateway server | `src/packages/gateway/src/server.ts` | Bun.serve with auth + rate limit |
| Tests | `src/packages/gateway/src/**/*.test.ts` | 9 tests, 100% pass |

---

## P7: TUI

**预估**: 1 周 | **状态**: pending

| 任务 | 文件 | 说明 |
|------|------|------|
| TUI app entry | `src/packages/tui/src/app.tsx` | TUI application bootstrap |
| WS client | `src/packages/tui/src/client/ws-client.ts` | WebSocket client (connects to Core) |
| Session manager | `src/packages/tui/src/session/manager.ts` | Session lifecycle management |
| Stream renderer | `src/packages/tui/src/renderer/stream.ts` | Streaming text renderer |
| Tool display | `src/packages/tui/src/renderer/tools.ts` | Tool call rendering |
| Chat view | `src/packages/tui/src/views/chat.tsx` | Main chat interface |

---

## P8: Integration ✅

**预估**: 0.5 周 | **状态**: completed

| 任务 | 文件 | 说明 |
|------|------|------|
| E2E tests | `tests/e2e/core.test.ts` | 6 tests: health, tasks, sessions, cancel |
| Documentation | `docs/*.md` | Complete documentation suite |
| Tests | 130 total, 100% pass |

---

## P9: Intent Prediction Pipeline

**预估**: 1 周 | **状态**: in_progress

| 任务 | 文件 | 说明 |
|------|------|------|
| parentTaskId 自引用 | `src/packages/core/src/task-factory.ts` | 默认值改为 taskId |
| TaskEngine 延迟构建 | `src/packages/core/src/task-engine.ts` | 加 pipelineBuilders 参数 |
| Predict-input element | `src/packages/core/src/pipelines/prediction/elements/predict-input.ts` | Source: 提取用户消息+上下文 |
| Predict-intent element | `src/packages/core/src/pipelines/prediction/elements/predict-intent.ts` | Transform: basic 模型分类 |
| Predict-finalize element | `src/packages/core/src/pipelines/prediction/elements/predict-finalize.ts` | Sink: 写 session + 建 task + 入队 |
| Pipeline DSL | `src/packages/core/src/pipelines/prediction/index.ts` | predictionPipeline(deps) builder |
| Server 注入 | `src/packages/core/src/server.ts` | pipelineBuilders + TaskCompleted +parentTaskId + visible |
| Session 消息控制 | `src/packages/shared/src/types/session.ts` + `src/packages/core/src/pipelines/conversation/elements/collect-prompts.ts` | SessionMessage 加 visible/pipeline；filter 不可见消息 |
| TUI 链路判断 | `src/packages/tui/src/client/ws-client.ts` | send() 按 parentTaskId 判断 |
| Spinner 数据驱动 | `src/packages/tui/src/hooks/useChat.ts` | 删 send() 中 spinner 移除 |
| Spinner 帧率 | `src/packages/tui/src/components/ChatView.tsx` | 80ms 刷新 |
| 单元测试 | `src/packages/core/src/pipelines/prediction/prediction.test.ts` | 预测 element 测试 |
| 集成测试 | `src/packages/core/src/pipelines/prediction/*.test.ts` | 完整流程 + 降级测试 |
| 文档 | `docs/milestones/P9-intent-prediction.md` + `PLAN.md` | 详细实施方案 |

---

## Summary

| Phase | Name | Tasks | Status | Estimate |
|-------|------|-------|--------|----------|
| P0 | Scaffolding | 8 | completed | - |
| P1 | Foundation | 6 | completed | 1 week |
| P2 | Core Engine | 7 | completed | 1.5 weeks |
| P3 | Tools & Pipelines | 8 | completed | 1 week |
| P4 | Pipeline Builder | 7 | completed | 1.5 weeks |
| P5 | Server & Protocol | 7 | completed | 1 week |
| P6 | Gateway | 6 | completed | 0.5 weeks |
| P7 | TUI | 6 | in_progress | 1 week |
| P8 | Integration | 3 | completed | 0.5 weeks |
| P9 | Intent Prediction | 9 | in_progress | 1 week |

**Total: 130 tests, ~9 weeks**
