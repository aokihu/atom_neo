# Atom Neo Code Review Plan — S12 Giant Files / TUI Structure — 2026-11-12

> 配套文件：
> - [code-review-s12-2026-11-12.md](./code-review-s12-2026-11-12.md)
> - [code-review-s12-graph-2026-11-12.md](./code-review-s12-graph-2026-11-12.md)
> - [code-review-plan-2026-11-10.md](./code-review-plan-2026-11-10.md)
>
> **Branch**: `code-review/2026-11-10`
> **Baseline**: `e3b51f5` (v1.23.0, S11 complete)
> **Status**: **S12 已拆分，待实施**。97 个任务全部为 **简单（S）** 或 **中等（M）**，无高/极高复杂度任务。
> **Scope**: CR-STR-01..11、CR-ARCH-10/11/12、CR-DUP-11/12；CR-STR-02/11 已关闭，CR-STR-06 仅残余收尾

---

## 0. 决策记录

| 决策 | 结论 | 影响 |
|---|---|---|
| S12 是否一次完成 | **否**，拆为 S12-A..H | 每阶段独立提交、可验证、可回滚 |
| 是否允许行为变化 | **否** | 纯结构重构；DB/文件/事件/路由/契约不变 |
| 是否先写快照 | **是** | 每个 Core 巨型文件先做特征测试，再搬移 |
| `stream-llm` 拆法 | **按行为边界**：loop / step / tool / reporting / context / finalize | 不做 `utils.ts` 垃圾桶 |
| `memory-service` 拆法 | store / query / graph / types | 保留 `MemoryService` facade |
| `context-service` 拆法 | bucket-store / snapshot-manager / codec / types | 保留 `ContextService` facade |
| `persistence-service` 拆法 | checkpoint-store / history-store / format / durable IO | 保留 `PersistenceService` facade |
| `ProcessSupervisor` | **只搬命令/终止** | 状态机、重启、健康语义不动 |
| TUI chat store | **slices + compose** | `useChatStore` API 不变 |
| TUI panels | section 组件 + model hooks | 导出兼容测试 import |
| App Modal | `ModalSpec` 配置表 + `AppModal` | 不改布局/键盘 |
| Wizard | reducer + 判别联合 view | 不改 view 顺序/first-run/config |
| `WizardState.step` | **删除** | 只写不读；测试同步 |
| `commit()` async | **不做** | S1 已改同步原子写；改 async 会改 `onComplete` 时序 |
| 全仓库 ≤300 行 | **不承诺** | 只对 S12 目标文件；显式例外见问题文档第 5 节 |
| 版本 | 子阶段不单独发版 | S12-H 完成后统一决定（建议 1.24.0） |

### 估算口径

- 1 个工程师日 = 8 小时，仅含实现 + 自测，不含 Review 等待。
- 每个任务是**单个 commit**；估算含该任务的测试。
- 简单（S）≤2h；中等（M）2–4h；**超过 4h 必须再拆**。
- 估算基于 `e3b51f5`；若发现隐藏耦合，按任务备注增加 1–2h，但仍需保持 S/M。

---

## 1. 总体原则

1. **先快照，后搬移**：每个巨型文件阶段先加特征测试，锁定事件顺序、结果字段、DB/目录格式、TUI state 转换。
2. **一次只搬一个行为**：每个任务只移动一段职责；不重写算法，不改分支顺序。
3. **facade 保留**：`stream-llm.ts`、`memory-service.ts`、`context-service.ts`、`persistence-service.ts` 始终保留公共入口；新模块先被调用，旧代码最后删。
4. **一个任务一个 commit**：可单独 revert；删除旧路径（A16/B7/C9/D8/E18/F10/G25）单独 commit。
5. **不做大爆炸**：不一次改完 1240 行；不一次重写 TUI；不引入新依赖。
6. **行为快照优先**：事件 payload、请求 body、DB 行、JSONL manifest、目录软链、TUI state 转换都必须可断言。
7. **Core 与 TUI 并行**：A-E 与 F-G 无文件交集；`stream-llm` 是 Core 关键路径。
8. **禁区不动**：未实现 Element、follow-up、Replay、PipelineRunner/Manager、`server.ts`、`tui-kit` 主题/Modal 契约。

---

## 2. 子阶段总览

| 子阶段 | 主题 | 任务数 | S/M | 预估 | 依赖 | 主要 CR |
|---|---|---:|---:|---:|---|---|
| S12-A | `stream-llm` 行为快照 + 模块提取 | 16 | 7/9 | 45h (5.6d) | — | CR-STR-01, CR-ARCH-12, CR-DUP-11 |
| S12-B | `memory-service` 拆分 | 7 | 3/4 | 17.5h (2.2d) | — | CR-STR-03 |
| S12-C | `context-service` 拆分 | 9 | 6/3 | 21.5h (2.7d) | — | CR-STR-04 |
| S12-D | `persistence-service` 拆分 | 8 | 3/5 | 21.5h (2.7d) | — | CR-STR-05 |
| S12-E | Core 纯函数 / ProcessSupervisor 残余 / DUP | 18 | 12/6 | 38.5h (4.8d) | E17←A3 | CR-STR-06/07, CR-DUP-11/12 |
| S12-F | TUI chat store / useChat / ChatView | 10 | 6/4 | 23h (2.9d) | — | CR-STR-08 |
| S12-G | TUI panels / App Modal / Wizard | 25 | 14/11 | 59.5h (7.4d) | F1/F6 后 | CR-STR-09/10, CR-ARCH-10/11 |
| S12-H | 行数与行为验收 | 4 | 1/3 | 11h (1.4d) | A..G | 全部 |
| **合计** | | **97** | **52/45** | **237.5h (29.7d)** | | |

> 表中“预估”只含实现+自测。总计 237.5h；TUI 轨道 F+G 82.5h，Core 轨道 A+B+C+D+E 144h。

### 顺序原则

```text
S12-A（stream-llm）是 Core 关键路径，必须最先开始
S12-B / C / D 可分别交给不同人并行（不同目录）
S12-E 可并行；E17 依赖 A3 的 stringify 导出
S12-F → S12-G（TUI 先用 store 稳定 API，再拆 panels）
S12-H 在 A..G 全部完成后
```

- **不要先删旧代码**：A16/B7/C9/D8/E18/F10/G25 都是“清理 commit”，放在对应阶段末尾。
- **不要同时改 `stream-llm.doProcess`**：A9/A10/A14 串行；每次只切一段。
- **不要先做 TUI 面板**：F1/F6 先把 store API 稳定，再拆 G。
- **不要把持久化与 context 一起改**：D 的回滚依赖 C 的 `ContextService` 公共 API；C 先合并。

---

## 3. 任务格式与过渡约定

每个任务统一包含：复杂度、目标、文件、依赖、行为快照/测试、行为风险、回滚、DoD。复杂度只用 **简单（S）** 或 **中等（M）**。

> **路径约定**：为避免 `docs:check` 把“规划中的新文件”误判为断链，本文对**待新增**文件使用省略 `src/` 前缀的路径（例如 `packages/core/src/...`）；已存在文件仍使用完整 `src/` 前缀。

### 过渡包装规则

| 对象 | 过渡实现 | 删除任务 |
|---|---|---|
| `stream-llm` helpers | 旧文件 re-export 新模块 | A16 |
| `memory-service` 类型/方法 | facade re-export/委托 | B7 |
| `context-service` 方法 | facade 委托 bucket/snapshot | C9 |
| `persistence-service` 方法 | facade 委托 checkpoint/history | D8 |
| `check-follow-up` / `compress-finalize` | Element 仍保留 `#finish`/report；纯函数先被调用 | E4/E8 |
| TUI store | `chat.ts` 组合 slices，action 名不变 | F6 |
| TUI panels | 旧组件保留 re-export | G5/G9/G12/G15/G17/G25 |
| Wizard | `wizard-logic.ts` barrel | G22/G25 |

### 每个任务的 DoD（通用）

- [ ] 代码 + 测试同一 commit。
- [ ] 目标测试通过；不新增 skip/only。
- [ ] `bun run typecheck` 通过（相关包）。
- [ ] 行为快照/旧测试不变（纯搬移任务必须“旧断言不改也通过”）。
- [ ] 回滚方式写入 commit message。
- [ ] 不新增模块级可变状态；不修改禁区代码。
- [ ] 新目录有 README（若该任务创建目录）。

---

## 4. 详细任务

### S12-A — `stream-llm` 行为快照 + 模块提取（45h）

> 入口：先跑现有 `stream-llm.test.ts`、`stream-boundaries.test.ts`、`stream-cache.test.ts`、`tool-loop.test.ts`，记录通过数。A1 完成后才开始 A2。

#### S12-A1 — `stream-llm` 行为快照 harness

- **复杂度**: 简单（2h）
- **目标**: 建立可重复的事件/请求/结果快照，覆盖 plain、tool call、intent follow-up、abort 四个场景；归一化时间戳、duration、hash 等易变字段。
- **文件**:
  - 新增 `packages/core/src/pipelines/conversation/elements/stream-characterization.test.ts`
  - 复用 `src/packages/core/src/pipelines/conversation/elements/stream-boundaries.test.ts` 的 fake loopback 模式
- **依赖**: 无
- **行为快照/测试**:
  - 记录 `BusEvents.Element.Data` 的 `step` 顺序（不记录完整 payload 的时间字段）。
  - 记录 `Transport.Reason/Delta/ToolStarted/ToolFinished/ToolStepFinished/ToolGroupComplete` 的顺序与关键字段。
  - 记录请求 body 的 `messages` role/tool_calls/name 摘要，不记录 `created`/id。
  - 记录 `responseText/reasoningContent/tokenUsage/intents/finishReason/streamInterrupted/tokenOverflow` 等结果字段。
- **行为风险**: 低；只加测试，不改源码。
- **回滚**: revert 测试 commit；不影响生产。
- **DoD**: 4 个场景测试通过；快照字段列表写入测试注释；后续 A2-A15 每个任务都跑该测试。

#### S12-A2 — 提取纯模型输入/指标投影

- **复杂度**: 简单（2.5h）
- **目标**: 把 `resolveModelInput`、`resolveCacheMetrics`、`resolveTokenMetrics`、`summarizeToolEffects`、`shouldRecordToolResult`、`injectToolContext` 移到 `stream-model-input.ts`；`stream-llm.ts` 先 re-export。
- **文件**:
  - 新增 `packages/core/src/pipelines/conversation/elements/stream/stream-model-input.ts`
  - 新增 `packages/core/src/pipelines/conversation/elements/stream/README.md`
  - `src/packages/core/src/pipelines/conversation/elements/stream-llm.ts`
- **依赖**: A1
- **行为快照/测试**: A1 + 现有 `stream-llm.test.ts` 的模型输入/缓存/effect 断言；新增 model-input 单测（空 usage、reasoning 转换、effect 计数）。
- **行为风险**: 低；纯函数搬移，无状态。
- **回滚**: revert 单 commit；`stream-llm` re-export 恢复即可。
- **DoD**: 6 个函数只在 model-input 定义；`stream-llm` 无同名实现；README 列出 stream 目录文件职责。

#### S12-A3 — 统一 `stringifyToolOutput`

- **复杂度**: 简单（1.5h）
- **目标**: 只保留 `tool-loop.ts` 的 `stringifyToolOutput` 并导出；`stream-llm.ts` 改为 import；删除重复实现。
- **文件**:
  - `src/packages/core/src/pipelines/conversation/elements/tool-loop.ts`
  - `src/packages/core/src/pipelines/conversation/elements/stream-llm.ts`
  - `src/packages/core/src/pipelines/conversation/elements/tool-loop.test.ts`
- **依赖**: 无
- **行为快照/测试**: `tool-loop.test.ts` 增加 string/undefined/JSON/不可序列化四类输入；A1 快照不变。
- **行为风险**: 低；两处实现逐字相同。
- **回滚**: revert 单 commit；恢复 stream-llm 本地函数。
- **DoD**: `rg 'function stringifyToolOutput' src/packages/core/src` 只有 1 处；工具调用日志 `args` 截断行为不变。

#### S12-A4 — 提取工具执行状态与 MCP metadata

- **复杂度**: 简单（2h）
- **目标**: 把 `ToolExecutionStatus`、`pushToolExecutionStatus`、`takeToolExecutionStatus`、`resolveMCPToolMetadata`、`hasStructuredValue` 移到 `tool-result-status.ts`；引入显式 `ToolStatusCollector`（按 toolName 队列，语义不变）。
- **文件**:
  - 新增 `packages/core/src/pipelines/conversation/elements/stream/tool-result-status.ts`
  - `src/packages/core/src/pipelines/conversation/elements/stream-llm.ts`
  - `src/packages/core/src/pipelines/conversation/elements/stream-llm.test.ts`（import 改到新模块）
- **依赖**: A2
- **行为快照/测试**: `stream-llm.test.ts` 的 `resolveMCPToolMetadata`/wrap 成功失败断言；新增 collector 队列单测（同名多次、空队列）。
- **行为风险**: 低；队列语义逐字保留。
- **回滚**: revert 单 commit；恢复 Map/自由函数。
- **DoD**: `#toolResults` 字段改为 `ToolStatusCollector` 或保留为 collector 实例；`stream-llm` 无本地 `take/push` 实现。

#### S12-A5 — 提取治理原语 `begin/finishGovernedToolCall`

- **复杂度**: 简单（2h）
- **目标**: 把 `beginGovernedToolCall`、`finishGovernedToolCall` 移到 `tool-governance-runtime.ts`；保留事件字段与 `formatToolGovernanceBlock` 文案。
- **文件**:
  - 新增 `packages/core/src/pipelines/conversation/elements/stream/tool-governance-runtime.ts`
  - `src/packages/core/src/pipelines/conversation/elements/stream-llm.ts`
- **依赖**: A4
- **行为快照/测试**: A1 的 governance 事件；`tool-loop.test.ts` + `stream-llm.test.ts` 的 duplicate 阻断断言。
- **行为风险**: 低；纯搬移。
- **回滚**: revert 单 commit；恢复内联函数。
- **DoD**: `tool-governance-decision` / `tool-governance-result` payload 字段顺序不变；阻断输出仍为 `TOOL_GOVERNANCE_BLOCKED [reason]`。

#### S12-A6 — 提取内置工具运行时

- **复杂度**: 中等（3h）
- **目标**: 把 `buildAllAiTools` 的包装逻辑移入 `tool-runtime.ts`；抽出 `executeGovernedTool()`，统一 governance start/finish、start/done/error 日志、status 写入、todowrite `setTodoState`。
- **文件**:
  - 新增 `packages/core/src/pipelines/conversation/elements/stream/tool-runtime.ts`
  - `src/packages/core/src/pipelines/conversation/elements/stream-llm.ts`
- **依赖**: A5
- **行为快照/测试**: A1；`stream-boundaries.test.ts` 的 intent/todowrite/治理；新增 builtin runtime 单测（成功、抛错、无 metadata、todowrite）。
- **行为风险**: 中（工具状态路径）；但只搬移，不改变分支。
- **回滚**: revert 单 commit；恢复 `buildAllAiTools` 内联。
- **DoD**: `tool-execute-start/done/error` 字段与截断长度不变；`Tool execution failed` / `Tool execution error: ...` 返回值不变。

#### S12-A7 — 提取 MCP 工具运行时

- **复杂度**: 中等（3h）
- **目标**: 把 `wrapMCPAiTools` 与 MCP metadata 归一移到 `tool-runtime-mcp.ts`；使用 A6 的 `executeGovernedTool()`。
- **文件**:
  - 新增 `packages/core/src/pipelines/conversation/elements/stream/tool-runtime-mcp.ts`
  - `src/packages/core/src/pipelines/conversation/elements/stream-llm.ts`
  - `src/packages/core/src/pipelines/conversation/elements/stream-llm.test.ts`
- **依赖**: A6
- **行为快照/测试**: `stream-llm.test.ts` 的 `wrapMCPAiTools` 成功/失败/治理阻断；A1。
- **行为风险**: 中（MCP 返回值/错误文案）。
- **回滚**: revert 单 commit；恢复 `wrapMCPAiTools` 内联与 re-export。
- **DoD**: `MCP tool error: ...`、`MCP tool returned isError`、structuredContent 判定不变；`stream-llm` 不直接 import MCP 细节。

#### S12-A8 — 统一内置/MCP 执行适配

- **复杂度**: 中等（3.5h）
- **目标**: `executeGovernedTool()` 接收 `invoke` 适配器与 `normalize` 回调；内置/MCP 只保留适配差异；`ToolStatusCollector` 显式传入，不再直接读写 `Map`。
- **文件**:
  - `packages/core/src/pipelines/conversation/elements/stream/tool-runtime.ts`
  - `packages/core/src/pipelines/conversation/elements/stream/tool-runtime-mcp.ts`
  - `src/packages/core/src/pipelines/conversation/elements/stream-llm.ts`
- **依赖**: A6/A7
- **行为快照/测试**: A1 + `stream-llm.test.ts` 全量；新增“内置与 MCP 同参数产生相同 governance 事件”断言。
- **行为风险**: 中；两种 adapter 返回值不同，必须保留。
- **回滚**: revert 单 commit；恢复两套独立实现。
- **DoD**: 两套 wrapper 都调用同一个 `executeGovernedTool`；`ToolStatusCollector` 只在 Element 创建、经参数传入；无重复 try/catch 模板。

#### S12-A9 — 提取 stream reporting

- **复杂度**: 中等（3h）
- **目标**: 把 `reportTransport`、trace、usage/cache 上报、stream error/abort 上报、`model-step-ended`/`stream-loop-ended` payload 组装移到 `stream-reporting.ts`。
- **文件**:
  - 新增 `packages/core/src/pipelines/conversation/elements/stream/stream-reporting.ts`
  - `src/packages/core/src/pipelines/conversation/elements/stream-llm.ts`
- **依赖**: A2
- **行为快照/测试**: A1 的事件顺序/payload；`stream-cache.test.ts` 的 usage 字段。
- **行为风险**: 中（事件 payload 是 WS/TUI 契约）。
- **回滚**: revert 单 commit；恢复内联 report 函数。
- **DoD**: A1 快照逐字一致；`stream-reporting.ts` 不决定循环/tool 分支。

#### S12-A10 — 提取 step context / snapshot 控制器

- **复杂度**: 中等（3.5h）
- **目标**: 把 `refreshStepContext`、`completeStep`、snapshot 创建/commit/release、tool context 注入、skill/todo 变化检测移到 `stream-context.ts`；Element 只调用 `refresh/commit/release/inject`。
- **文件**:
  - 新增 `packages/core/src/pipelines/conversation/elements/stream/stream-context.ts`
  - `src/packages/core/src/pipelines/conversation/elements/stream-llm.ts`
- **依赖**: A2/A9
- **行为快照/测试**: A1；`stream-cache.test.ts` 的 snapshot status/`step-snapshot-created`/budget；`stream-llm.test.ts` 的注入 scope/TTL。
- **行为风险**: 中（snapshot lease/commit 时机）。
- **回滚**: revert 单 commit；恢复 `refreshStepContext` 内联。
- **DoD**: `ContextService` 调用时机不变：每 step 开始 refresh、usage 后 commit、finally release；skill/todo 变化才创建新 snapshot。

#### S12-A11 — 定义 `StepOutcome` 与 chunk 消费纯函数

- **复杂度**: 简单（2h）
- **目标**: 在 `stream/types.ts` 定义 `StepOutcome`、`ToolExecutionResult`、`LoopExitReason`；把 chunk 分类（reasoning/text/tool-call/finish/error/abort）抽为纯函数 `consumeStreamChunk`。
- **文件**:
  - 新增 `packages/core/src/pipelines/conversation/elements/stream/types.ts`
  - 新增 `packages/core/src/pipelines/conversation/elements/stream/stream-step.ts`（仅 chunk 消费部分）
  - `src/packages/core/src/pipelines/conversation/elements/stream-llm.ts`
- **依赖**: A2
- **行为快照/测试**: 新增 `consumeStreamChunk` 单测（每种 part type、空 text、error status、abort）；A1。
- **行为风险**: 低；纯函数。
- **回滚**: revert 单 commit；恢复内联 chunk 分支。
- **DoD**: `StepOutcome` 字段覆盖 text/reasoning/calls/usage/finishReason/failed/errorCode；无业务分支在纯函数内。

#### S12-A12 — 提取单次模型 step

- **复杂度**: 中等（4h）
- **目标**: 把 `beforeCall` + `streamText` + chunk 消费 + usage timeout + finishReason 收敛到 `runModelStep()`；返回 `StepOutcome`，不执行工具。
- **文件**:
  - `packages/core/src/pipelines/conversation/elements/stream/stream-step.ts`
  - `src/packages/core/src/pipelines/conversation/elements/stream-llm.ts`
- **依赖**: A11
- **行为快照/测试**: A1；`stream-boundaries.test.ts` 的 beforeCall/cancel；`stream-cache.test.ts` 的 usage/cache。
- **行为风险**: 中（timeout/cancel 回归面广）。
- **回滚**: revert 单 commit；恢复 `streamText` 内联。
- **DoD**: `beforeCall` 暂停/恢复 timeout 的剩余时间计算不变；usage 30s race、错误码、abort 行为不变。

#### S12-A13 — 提取 tool batch 处理

- **复杂度**: 中等（4h）
- **目标**: 把 batch 校验、逐调用 intent 特判、executor 调用、status/record 追加、context injection、todowrite handoff、projectToolMessages 移到 `tool-batch.ts`。
- **文件**:
  - 新增 `packages/core/src/pipelines/conversation/elements/stream/tool-batch.ts`
  - `src/packages/core/src/pipelines/conversation/elements/stream-llm.ts`
- **依赖**: A8/A10
- **行为快照/测试**: A1；`stream-boundaries.test.ts` 的 intent/todo/reconcile；`stream-cache.test.ts` 的 tool record。
- **行为风险**: 中（工具循环核心）。
- **回滚**: revert 单 commit；恢复 for 循环内联。
- **DoD**: `tool-batch-blocked` 文案/事件、intent 的 `invalid`/retain 分支、todowrite handoff 条件、record group 创建/append 全不变。

#### S12-A14 — 提取 stream loop

- **复杂度**: 中等（4h）
- **目标**: 把 `while (!timedOut && ...)`、governance stop 检测、forceText、step 调用、batch 调用、退出原因、`completeStep` 移到 `stream-loop.ts`。
- **文件**:
  - 新增 `packages/core/src/pipelines/conversation/elements/stream/stream-loop.ts`
  - `src/packages/core/src/pipelines/conversation/elements/stream-llm.ts`
- **依赖**: A12/A13
- **行为快照/测试**: A1 全场景；`stream-boundaries.test.ts` 的 `stream-loop-ended` exitReason/goal fields。
- **行为风险**: 中（循环顺序/退出原因）。
- **回滚**: revert 单 commit；恢复 while 内联。
- **DoD**: 退出原因集合不变：`no_tool_calls`/`tools_forced_off`/`intent_follow_up`/`todo_handoff`/`reconciliation_updated`/`reconciliation_attempt_limit`/`model_step_limit`/`stream_error`/`timeout`/`cancelled`。

#### S12-A15 — 提取最终结果投影

- **复杂度**: 中等（3h）
- **目标**: 把 token overflow 判定、空文本 fallback、intents 转换、`ConversationFlowState` 结果字段、`done` 事件移到 `stream-finalize.ts`。
- **文件**:
  - 新增 `packages/core/src/pipelines/conversation/elements/stream/stream-finalize.ts`
  - `src/packages/core/src/pipelines/conversation/elements/stream-llm.ts`
- **依赖**: A14
- **行为快照/测试**: A1；`stream-llm.test.ts` 的 token overflow/usage/summary；`stream-boundaries.test.ts` 的 intents。
- **行为风险**: 中（返回字段是 Task/Pipeline 契约）。
- **回滚**: revert 单 commit；恢复结果投影内联。
- **DoD**: 返回对象的字段名、默认值、`responseText` fallback 文案（`工具循环执行失败。` / `未获得可用的工具证据...`）不变。

#### S12-A16 — 瘦身 Element 与清理旧路径

- **复杂度**: 简单（2h）
- **目标**: `stream-llm.ts` 只保留字段/构造/`doProcess` 编排（≤220 行，`doProcess` ≤100 行）；删除已迁移的私有函数与不必要的 re-export；测试 import 改到新模块。
- **文件**:
  - `src/packages/core/src/pipelines/conversation/elements/stream-llm.ts`
  - `src/packages/core/src/pipelines/conversation/elements/stream-llm.test.ts`
  - `src/packages/core/src/pipelines/conversation/elements/stream-boundaries.test.ts`
  - `src/packages/core/src/pipelines/conversation/elements/stream-cache.test.ts`
- **依赖**: A2..A15
- **行为快照/测试**: A1 全场景 + 全量 conversation 测试；`rg` 确认无重复实现。
- **行为风险**: 中（最后一刀，容易漏 re-export）。
- **回滚**: revert 单 commit；恢复 re-export/内联调用。
- **DoD**: `wc -l` ≤220；`doProcess` ≤100；`rg 'function (buildAllAiTools|wrapMCPAiTools|beginGovernedToolCall|finishGovernedToolCall|refreshStepContext)'` 只在 stream 目录；全量测试绿。

---

### S12-B — `memory-service` 拆分（17.5h）

> 入口：`memory-service.test.ts` 536 行已覆盖保存/搜索/图/生命周期；B1 只补 schema/排序/迁移的显式快照。

#### S12-B1 — Memory schema / 搜索顺序快照

- **复杂度**: 简单（2h）
- **目标**: 记录 `sqlite_master` 的 table/index/trigger、FTS5 列、搜索结果 id 顺序、traverse BFS 顺序；归一化时间戳。
- **文件**:
  - 新增 `packages/services/memory-characterization.test.ts`（实际位于 `src/services/`）
  - 复用 `src/services/memory-service.test.ts`
- **依赖**: 无
- **行为快照/测试**:
  - `SELECT type,name,sql FROM sqlite_master ORDER BY type,name` 快照（SQL 可格式化，但列/trigger 名/顺序不变）。
  - 固定内容/标签/关系，断言 `search` 返回 id 顺序与 `traverse` 的 source/relation/depth。
  - 迁移：旧 `.txt` 文件导入后 content/summary 与文件删除行为。
- **行为风险**: 低；只加测试。
- **回滚**: revert 测试 commit。
- **DoD**: 快照归一化 `createdAt/accessedAt/last*`；B3/B5/B6 每步都跑。

#### S12-B2 — 提取 `memory-types.ts`

- **复杂度**: 简单（1.5h）
- **目标**: 把 `MemoryNode`、`MemorySaveOptions`、`MemoryTraversalNode`、`MemoryKind` re-export 移到 `memory/memory-types.ts`；`memory-service.ts` 继续 re-export。
- **文件**:
  - 新增 `packages/services/memory/memory-types.ts`
  - 新增 `packages/services/memory/README.md`
  - `src/services/memory-service.ts`
- **依赖**: B1
- **行为快照/测试**: 现有 `memory-service.test.ts`；typecheck。
- **行为风险**: 低；纯类型。
- **回滚**: revert 单 commit。
- **DoD**: 外部 import 不变；README 列出 store/query/graph/types 职责。

#### S12-B3 — 提取 `memory-store.ts`（DB/迁移/行映射）

- **复杂度**: 中等（3.5h）
- **目标**: `MemoryStore` 负责 open/close、DDL、列迁移、FTS trigger、legacy 迁移、`loadNode`、事务、raw query 执行；SQL 逐字保留。
- **文件**:
  - 新增 `packages/services/memory/memory-store.ts`
  - `src/services/memory-service.ts`
- **依赖**: B2
- **行为快照/测试**: B1 schema dump；现有 memory 测试；新增 store 单测（open/close、重复 start、row 映射、FTS rebuild）。
- **行为风险**: 中（DDL/迁移）。
- **回滚**: revert 单 commit；恢复 `#initDb` 内联。
- **DoD**: 表/索引/trigger/FTS SQL 逐字一致；`MemoryStore` 不计算 relevance/score。

#### S12-B4 — MemoryService 委托 store

- **复杂度**: 中等（3h）
- **目标**: `MemoryService` 的 `onStart/onStop/#dbHandle/#initDb/#migrateLegacyContent/#loadNode` 改为 store 调用；公共 API 签名不变。
- **文件**:
  - `src/services/memory-service.ts`
  - `packages/services/memory/memory-store.ts`
- **依赖**: B3
- **行为快照/测试**: B1；`memory-service.test.ts` 全量；start/stop 幂等。
- **行为风险**: 中（生命周期）。
- **回滚**: revert 单 commit；恢复直接 `SqliteDatabase` 字段。
- **DoD**: `MemoryService` 不再 import `node:fs`/`SqliteDatabase` DDL；`onStart` 失败仍关闭 DB 并抛出。

#### S12-B5 — 提取 `memory-query.ts`（search + ranking）

- **复杂度**: 中等（3h）
- **目标**: 把 `search` 的 FTS/短词候选、过期/supersedes 过滤、覆盖率、rankOrder、final score、retrieval 记录移到 `memory-query.ts`。
- **文件**:
  - 新增 `packages/services/memory/memory-query.ts`
  - `src/services/memory-service.ts`
- **依赖**: B4
- **行为快照/测试**: B1 搜索顺序；现有 memory 测试；新增 query 单测（长词/短词/空/limit/kind 过滤）。
- **行为风险**: 中（排序/过滤）。
- **回滚**: revert 单 commit；恢复 `search` 内联。
- **DoD**: 候选 limit `max(limit*10,30)`、覆盖率 0.4、`calculateFinalMemoryScore` 参数不变；SQL 字符串不变。

#### S12-B6 — 提取 `memory-graph.ts`（traverse/link/edges）

- **复杂度**: 中等（2.5h）
- **目标**: 把 `traverse`、`link`、`countRelated`、neighbor 查询/质量排序移到 `memory-graph.ts`。
- **文件**:
  - 新增 `packages/services/memory/memory-graph.ts`
  - `src/services/memory-service.ts`
- **依赖**: B4
- **行为快照/测试**: B1 traverse 顺序；现有 memory 测试；新增 graph 单测（缺失 id、重复 link、countRelated 过期过滤）。
- **行为风险**: 中（BFS/排序）。
- **回滚**: revert 单 commit。
- **DoD**: 结果最多 5、每层 neighbor 最多 3、`visited`/`depth >= maxSteps` 规则不变；`link` 仍 `INSERT OR IGNORE`。

#### S12-B7 — 直接测试与清理

- **复杂度**: 简单（2h）
- **目标**: 为 `memory-store/query/graph` 增加直接单测；`memory-service.ts` 只保留 facade/公共 API；确认无重复 SQL。
- **文件**:
  - `src/services/memory-service.ts`
  - `packages/services/memory/*.test.ts`
  - `src/services/memory-service.test.ts`
- **依赖**: B3/B5/B6
- **行为快照/测试**: B1 + 全量 memory 测试；`rg '#initDb|#loadNode|#memoryQuality' src/services/memory-service.ts` 为空。
- **行为风险**: 低；纯清理/测试。
- **回滚**: revert 单 commit。
- **DoD**: `memory-service.ts` ≤180 行；store/query/graph 各自 ≤预算；schema/search/traverse 快照不变。

---

### S12-C — `context-service` 拆分（21.5h）

> 入口：`context-service.test.ts` 265 行 + `stream-cache.test.ts`。C1 固定 bucket/snapshot/persisted 结构。

#### S12-C1 — Context 行为快照

- **复杂度**: 简单（2h）
- **目标**: 记录 bucket id、snapshot state（refs/receipts/manifest/prefixHash）、`exportSessionState` JSON、lease/dispose 计数；归一化时间。
- **文件**:
  - 新增 `packages/core/src/context/context-characterization.test.ts`
  - 复用 `src/packages/core/src/context/context-service.test.ts`
- **依赖**: 无
- **行为快照/测试**: put/get/remove、create/commit/release、expire/sweep、export/restore、topic/task/session 事件。
- **行为风险**: 低；只加测试。
- **回滚**: revert 测试 commit。
- **DoD**: 快照覆盖所有公共方法；后续 C2-C9 必跑。

#### S12-C2 — 提取 `context-types.ts`

- **复杂度**: 简单（2h）
- **目标**: 把 `MutableBucket`、`SnapshotRecord`、`MutableSnapshotState`、`PersistedContextBucket/State`、`SCOPE_RETENTION`、`DEFAULT_EXPIRE_ON` 移到 types 文件。
- **文件**:
  - 新增 `packages/core/src/context/context-types.ts`
  - `src/packages/core/src/context/context-service.ts`
  - `src/packages/core/src/context/README.md`
- **依赖**: C1
- **行为快照/测试**: C1 + typecheck。
- **行为风险**: 低；纯类型/常量。
- **回滚**: revert 单 commit。
- **DoD**: `context-service.ts` 仍 re-export `PersistedContextState`（persistence 依赖）；README 更新文件表。

#### S12-C3 — 提取 `context-codec.ts`

- **复杂度**: 简单（2h）
- **目标**: 移动 `createBucketId`、`createContextId`、`ownerMatches`、`pickOwner`、`sameEntry`、`expireBucket`、`freezeContent`、`deepFreeze`；`ownerMatches` 改名 `filterMatchesOwner(filter, owner)` 并保留语义。
- **文件**:
  - 新增 `packages/core/src/context/context-codec.ts`
  - `src/packages/core/src/context/context-service.ts`
  - `src/packages/core/src/context/context-service.test.ts`
- **依赖**: C2
- **行为快照/测试**: C1；新增 codec 单测：bucketId 编码、owner 过滤双向、deepFreeze/structuredClone。
- **行为风险**: 低；纯函数。
- **回滚**: revert 单 commit。
- **DoD**: bucket/context id 字符串逐字一致；`filterMatchesOwner` 的两个调用方向都有测试；语义未变。

#### S12-C4 — 引入 `BucketStore`（CRUD）

- **复杂度**: 中等（3h）
- **目标**: `BucketStore` 持有 `#buckets`，提供 `put/remove/get/inspect/entries/activeBuckets`；`ContextService.put/remove/get` 委托。
- **文件**:
  - 新增 `packages/core/src/context/bucket-store.ts`
  - `src/packages/core/src/context/context-service.ts`
- **依赖**: C3
- **行为快照/测试**: C1；现有 context 测试；新增 store CRUD/entry revision 单测。
- **行为风险**: 中（entry revision/empty bucket expire）。
- **回滚**: revert 单 commit；恢复 `#buckets` 字段。
- **DoD**: bucket 创建/更新时间、lifecycle、revision 递增、空 bucket `entries.empty` 过期不变；`ContextService` 不再直接操作 Map。

#### S12-C5 — 移动 bucket 过期/清理到 `BucketStore`

- **复杂度**: 中等（3h）
- **目标**: `expireScope/#expireBuckets/sweepExpired 的 bucket 部分/disposeExpired` 移到 `BucketStore`；lease 检查通过回调/计数接口。
- **文件**:
  - `packages/core/src/context/bucket-store.ts`
  - `src/packages/core/src/context/context-service.ts`
- **依赖**: C4
- **行为快照/测试**: C1 的 expire/dispose/lease；现有 context 测试；新增 lease 阻止 dispose、expired→disposed 单测。
- **行为风险**: 中（生命周期）。
- **回滚**: revert 单 commit。
- **DoD**: `expireOn` 匹配、`expiredReason`、`updatedAt/expiredAt`、lease >0 不 dispose 全部不变。

#### S12-C6 — 引入 `SnapshotManager`（create/commit/release）

- **复杂度**: 中等（4h）
- **目标**: `SnapshotManager` 持有 `#snapshots`/`#bucketLeases`；实现 `create/commit/release/inspect/releaseByOwner`；`BucketStore` 提供 `removeConsumeOnCommit`/`lease/release`。
- **文件**:
  - 新增 `packages/core/src/context/snapshot-manager.ts`
  - `packages/core/src/context/bucket-store.ts`
  - `src/packages/core/src/context/context-service.ts`
- **依赖**: C5
- **行为快照/测试**: C1；`stream-cache.test.ts`；新增 snapshot 单测（lease 计数、revision mismatch、commit twice、release twice）。
- **行为风险**: 中（snapshot 时机）。
- **回滚**: revert 单 commit；恢复 `#snapshots`/`#bucketLeases` 内联。
- **DoD**: `createSnapshot` 的 fragments/manifest/records/refs 计算逐字不变；commit 只删 revision 匹配的 consumeOnCommit；release 幂等。

#### S12-C7 — 移动 snapshot TTL / sweep

- **复杂度**: 简单（2h）
- **目标**: 把 `sweepExpired` 的 snapshot TTL 部分移到 `SnapshotManager`；`ContextService.sweepExpired` 先 bucket 后 snapshot，再 `disposeExpired`。
- **文件**:
  - `packages/core/src/context/snapshot-manager.ts`
  - `src/packages/core/src/context/context-service.ts`
- **依赖**: C6
- **行为快照/测试**: C1 的 TTL；新增 active→release、released→delete 单测。
- **行为风险**: 低；顺序保持。
- **回滚**: revert 单 commit。
- **DoD**: 默认 60 分钟；`snapshotTtlMs` 选项生效；`inspectSnapshot` 不泄漏内部状态。

#### S12-C8 — Facade 收口 / `ownerMatches` 命名

- **复杂度**: 简单（2h）
- **目标**: `ContextService` 只保留生命周期、bus 订阅、export/restore、公共方法委托；删除重复私有方法；确认 no-op `#releaseSnapshots` 通过 manager。
- **文件**:
  - `src/packages/core/src/context/context-service.ts`
  - `packages/core/src/context/snapshot-manager.ts`
  - `packages/core/src/context/bucket-store.ts`
- **依赖**: C7
- **行为快照/测试**: C1 + context 全量；`rg '#buckets|#snapshots' context-service.ts` 为空。
- **行为风险**: 中（facade 漏委托）。
- **回滚**: revert 单 commit。
- **DoD**: `ContextService` ≤200 行；所有 public 方法签名不变；事件订阅顺序不变（SnapshotCommit/Release → CoreStopped → WorkspaceChanged/Closed → TopicChanged → StepCompleted → Session.Closed → Task.Completed/Failed）。

#### S12-C9 — 直接测试与清理

- **复杂度**: 简单（1.5h）
- **目标**: 新增 bucket/store/snapshot manager 直接单测；删除临时 re-export；确认 README 与行数。
- **文件**:
  - `packages/core/src/context/*.test.ts`
  - `src/packages/core/src/context/README.md`
  - `src/packages/core/src/context/context-service.ts`
- **依赖**: C4..C8
- **行为快照/测试**: C1 + 全量 context/stream 测试；`wc -l`。
- **行为风险**: 低。
- **回滚**: revert 单 commit。
- **DoD**: `context-service.ts` ≤200；bucket-store/snapshot-manager ≤预算；persisted JSON 快照不变。

---

### S12-D — `persistence-service` 拆分（21.5h）

> 入口：`persistence-service.test.ts` 214 行 + compress checkpoint 测试。D1 固定目录/JSONL 结构。

#### S12-D1 — Persistence 目录/JSONL 快照

- **复杂度**: 简单（2h）
- **目标**: 记录 session 目录树、`current` 软链目标、generation 名模式、session/context/message/tool-records 文件字段、archive 索引/搜索结果。
- **文件**:
  - 新增 `packages/core/src/session/persistence-characterization.test.ts`
  - 复用 `src/packages/core/src/session/persistence-service.test.ts`
- **依赖**: 无
- **行为快照/测试**: checkpoint 两次、restore、archive/search/read、remove；断言 generation 数量/文件名/manifest 字段。
- **行为风险**: 低；只加测试。
- **回滚**: revert 测试 commit。
- **DoD**: 归一化 `createdAt/revision/uuid`；D2-D7 必跑。

#### S12-D2 — 提取 `session-format.ts`

- **复杂度**: 中等（3h）
- **目标**: 移动 `MessageManifest`、`toJsonl`、`parseJsonl`、`toToolRecordsJsonl`、`parseToolRecordsJsonl`、`toSafeSessionId`、`toReceipt`、路径常量。
- **文件**:
  - 新增 `packages/core/src/session/session-format.ts`
  - `src/packages/core/src/session/persistence-service.ts`
  - `src/packages/core/src/session/README.md`
- **依赖**: D1
- **行为快照/测试**: D1 JSONL 快照；新增 format round-trip 单测（manifest+message、tool group、空行）。
- **行为风险**: 低；纯编解码。
- **回滚**: revert 单 commit。
- **DoD**: 字段名/行顺序/末尾换行不变；`toSafeSessionId` SHA-256 前 32 位不变。

#### S12-D3 — 提取 `durable-fs.ts`

- **复杂度**: 简单（2h）
- **目标**: 移动 `#writeDurable`、`#fsyncDirectory`、`#writeAtomic` 为独立函数；保留 fsync/rename/rm 临时文件语义。
- **文件**:
  - 新增 `packages/core/src/session/durable-fs.ts`
  - `src/packages/core/src/session/persistence-service.ts`
- **依赖**: D2
- **行为快照/测试**: D1 目录快照；新增单测（write/rename、目录 fsync 不抛、临时文件清理）。
- **行为风险**: 低；不改变调用顺序。
- **回滚**: revert 单 commit。
- **DoD**: 不替换成 `shared writeFileAtomic`（缺 directory fsync）；模式 0o600/0o700 不变。

#### S12-D4 — 提取 `checkpoint-store.ts`

- **复杂度**: 中等（4h）
- **目标**: `CheckpointStore` 负责 `writeGeneration/publishGeneration/resolveCurrentGeneration/cleanupGenerations/readSessionState`、`getSessionDirectory`；`SessionPersistenceService` 委托。
- **文件**:
  - 新增 `packages/core/src/session/checkpoint-store.ts`
  - `src/packages/core/src/session/persistence-service.ts`
- **依赖**: D3
- **行为快照/测试**: D1 目录/软链；现有 persistence 测试；新增单测（invalid pointer、missing generation、cleanup keep 2）。
- **行为风险**: 中（checkpoint 提交点）。
- **回滚**: revert 单 commit；恢复私有方法内联。
- **DoD**: generation 名、`.checkpoints`、`current` rename、compat symlink、cleanup 保留当前+前一版；错误文案不变。

#### S12-D5 — Facade 的 checkpoint/restore 委托

- **复杂度**: 中等（2.5h）
- **目标**: `checkpoint` 只组装 session/context/messages/tool-records 并调用 `CheckpointStore.commit`；`restore` 读取走 store，保持 revision 校验/restore checkpoint。
- **文件**:
  - `src/packages/core/src/session/persistence-service.ts`
  - `packages/core/src/session/checkpoint-store.ts`
- **依赖**: D4
- **行为快照/测试**: D1 restore/checkpoint；`compress.test.ts` 的 checkpoint 回滚。
- **行为风险**: 中（restore 写盘时机）。
- **回滚**: revert 单 commit。
- **DoD**: `checkpoint` 状态映射（restore/idle/capacity/shutdown/其他）不变；revision mismatch 错误文案不变；`restore` 仍只对 active 写 checkpoint。

#### S12-D6 — 提取 `history-store.ts`

- **复杂度**: 中等（3.5h）
- **目标**: 移动 `archiveMessages`、`getArchiveIndex`、`searchHistory`、`readHistory`、`getHistoryArchiveRevision`、archive id/segment 扫描/读取。
- **文件**:
  - 新增 `packages/core/src/session/history-store.ts`
  - `src/packages/core/src/session/persistence-service.ts`
- **依赖**: D2
- **行为快照/测试**: D1 archive/search；现有 persistence 测试；新增单测（invalid archiveId、from>to、重复 archive、verify 失败）。
- **行为风险**: 中（归档写入/搜索）。
- **回滚**: revert 单 commit。
- **DoD**: segment 命名 `message-%06d`、搜索 limit 20/read limit 51、visible/role 过滤、toSorted(seq) 不变。

#### S12-D7 — Facade 的 history 委托

- **复杂度**: 中等（2.5h）
- **目标**: `SessionPersistenceService` 的 history 方法委托 `HistoryStore`；`remove` 清理 tool records + session dir；`listTuiSessions` 保持。
- **文件**:
  - `src/packages/core/src/session/persistence-service.ts`
  - `packages/core/src/session/history-store.ts`
- **依赖**: D6
- **行为快照/测试**: D1；`tool-records` restore/remove 测试。
- **行为风险**: 中（remove/restore 交互）。
- **回滚**: revert 单 commit。
- **DoD**: `remove` 顺序不变（toolRecords → rm session dir）；`listTuiSessions` 只返回 initiator.type=tui 且 lastTuiUsedAt 默认 0。

#### S12-D8 — 直接测试与清理

- **复杂度**: 简单（2h）
- **目标**: 为 checkpoint/history/format 增加直接单测；`persistence-service.ts` ≤180；更新 README。
- **文件**:
  - `packages/core/src/session/*.test.ts`
  - `src/packages/core/src/session/README.md`
  - `src/packages/core/src/session/persistence-service.ts`
- **依赖**: D4/D6/D7
- **行为快照/测试**: D1 + 全量 persistence/compress 测试；`wc -l`。
- **行为风险**: 低。
- **回滚**: revert 单 commit。
- **DoD**: 目录/JSONL 快照逐字一致；无私有方法重复；README 文件表更新。

---

### S12-E — Core 纯函数 / ProcessSupervisor 残余 / DUP（38.5h）

#### S12-E1 — `check-follow-up` 决策快照

- **复杂度**: 简单（2h）
- **目标**: 用表驱动测试锁定 10 条规则分支与 LLM 仲裁结果/降级；记录事件顺序与 continuationDecision。
- **文件**:
  - 新增 `packages/core/src/pipelines/conversation/elements/check-follow-up.characterization.test.ts`
  - 复用 `src/packages/core/src/pipelines/conversation/elements/check-follow-up.test.ts`
- **依赖**: 无
- **行为快照/测试**: cancelled/abort/error/toolStop、tokenOverflow、reconcile（unchanged/active/terminal/current/lost）、length/interrupted、todo handoff/finish/explicit follow-up/pending plan、rules mode、LLM invalid/fallback。
- **行为风险**: 低；只加测试。
- **回滚**: revert 测试 commit。
- **DoD**: 每个分支断言 `chainAction`/`continuationDecision`/`suppressPostCheck`/`responseText` 与关键 data event。

#### S12-E2 — 提取 `continuation-rules.ts`

- **复杂度**: 中等（3h）
- **目标**: 把 E1 中不依赖 LLM 的早期规则抽为纯函数 `evaluateContinuationRules(input, ctx)`；返回 decision/stopReconciliation/null，规则顺序不变。
- **文件**:
  - 新增 `packages/core/src/pipelines/conversation/elements/continuation-rules.ts`
  - `src/packages/core/src/pipelines/conversation/elements/check-follow-up.ts`
- **依赖**: E1
- **行为快照/测试**: E1 全分支；新增 rules 纯函数单测（不构造 Element）。
- **行为风险**: 中（规则优先级）。
- **回滚**: revert 单 commit；恢复 `doProcess` 内联 if。
- **DoD**: 规则顺序：runtime stop → token overflow → reconcile → interrupt → handoff/finish/follow-up/pending → rules mode；每个 decision 的 reason/source/target 不变。

#### S12-E3 — 提取 `continuation-arbitration.ts`

- **复杂度**: 中等（3.5h）
- **目标**: 把 progress evidence 组装、history/goal 截取、repeatedOutput、`chooseDecision` race、无效转移校验、fallback 抽到 `arbitrateContinuation()`。
- **文件**:
  - 新增 `packages/core/src/pipelines/conversation/elements/continuation-arbitration.ts`
  - `src/packages/core/src/pipelines/conversation/elements/check-follow-up.ts`
- **依赖**: E2
- **行为快照/测试**: E1 的 LLM 分支；`check-follow-up.test.ts`；新增 arbitration 单测（timeout/abort/invalid transition/fallback）。
- **行为风险**: 中（LLM 仲裁）。
- **回滚**: revert 单 commit。
- **DoD**: `timeoutMs` 默认 10s、`maxTokens 512`、`maxRetries 0`、abort race、`invalid_progress_transition` 条件不变；`decision-request`/`arbitrated`/`arbitration-failed` payload 不变。

#### S12-E4 — 瘦身 `check-follow-up.ts`

- **复杂度**: 简单（2h）
- **目标**: Element 只保留构造、`doProcess` 编排、`#finish`/`#trace`/`#stopReconciliation`；≤150 行。
- **文件**:
  - `src/packages/core/src/pipelines/conversation/elements/check-follow-up.ts`
  - `src/packages/core/src/pipelines/conversation/elements/check-follow-up.test.ts`
- **依赖**: E2/E3
- **行为快照/测试**: E1 + 全量 conversation 测试；`wc -l`。
- **行为风险**: 低。
- **回滚**: revert 单 commit。
- **DoD**: `doProcess` ≤100；`reconciliation-result`/`done` 事件字段不变；旧测试不改通过。

#### S12-E5 — `compress-finalize` 结果快照

- **复杂度**: 简单（2h）
- **目标**: 记录 archive failed/nothing/summary failed/checkpoint failed/成功/resume 五类输出、context entries、checkpoint 调用与事件。
- **文件**:
  - 新增 `packages/core/src/pipelines/context-compress/elements/compress-finalize.characterization.test.ts`
  - 复用 `src/packages/core/src/pipelines/context-compress/compress.test.ts`
- **依赖**: 无
- **行为快照/测试**: 五类结果 + `resumeConversation`/`resumeTask`/`continuation`/`scheduleConversation` 分支。
- **行为风险**: 低；只加测试。
- **回滚**: revert 测试 commit。
- **DoD**: 每个分支断言 output/status/checkpoint/removed/context key。

#### S12-E6 — 提取 `compress-commit.ts`

- **复杂度**: 中等（3h）
- **目标**: 把 summary/archive-index context put、remaining messages、token estimate、checkpoint 失败回滚、removeMessages 抽为 `commitCompression()`。
- **文件**:
  - 新增 `packages/core/src/pipelines/context-compress/elements/compress-commit.ts`
  - `src/packages/core/src/pipelines/context-compress/elements/compress-finalize.ts`
- **依赖**: E5
- **行为快照/测试**: E5；`compress.test.ts` 的 checkpoint 回滚/context 恢复。
- **行为风险**: 中（回滚路径）。
- **回滚**: revert 单 commit。
- **DoD**: `conversation-summary`/`history-archive-index` 的 source/channel/trust/priority 不变；失败时恢复 previous entry/token/compressing。

#### S12-E7 — 提取 `compress-resume.ts`

- **复杂度**: 中等（2.5h）
- **目标**: 把 resume 决策（releaseTask/continuation token-overflow/scheduleContinuation/scheduleConversation）抽为 `resumeAfterCompress()`。
- **文件**:
  - 新增 `packages/core/src/pipelines/context-compress/elements/compress-resume.ts`
  - `src/packages/core/src/pipelines/context-compress/elements/compress-finalize.ts`
- **依赖**: E5
- **行为快照/测试**: E5；`compress.test.ts` 的 resume 分支；新增 resume 单测（4 种 request）。
- **行为风险**: 中（链调度）。
- **回滚**: revert 单 commit。
- **DoD**: `chainAction: "follow_up"` + `continuationDecision` 的 token-overflow 分支不变；schedule 参数顺序不变。

#### S12-E8 — 瘦身 `compress-finalize.ts`

- **复杂度**: 简单（2h）
- **目标**: Element 只保留 report/编排；≤150 行；`#restoreEntry`/`#estimateContextTokens` 移入 commit 模块。
- **文件**:
  - `src/packages/core/src/pipelines/context-compress/elements/compress-finalize.ts`
  - `packages/core/src/pipelines/context-compress/elements/compress-commit.ts`
- **依赖**: E6/E7
- **行为快照/测试**: E5 + 全量 compress 测试。
- **行为风险**: 低。
- **回滚**: revert 单 commit。
- **DoD**: `finalizing`/`completed`/`checkpoint committed`/`conversation resume scheduled` 事件字段不变；`wc -l` ≤150。

#### S12-E9 — ProcessSupervisor 命令/终止快照

- **复杂度**: 简单（1.5h）
- **目标**: 在现有 supervisor 测试上增加显式断言：命令数组、env/stdin/stdout/stderr/onExit、terminate 的 SIGTERM→等待→SIGKILL 顺序、日志调用。
- **文件**:
  - 新增 `packages/gateway/src/client-manager/process-supervisor.characterization.test.ts`
  - 复用 `src/packages/gateway/src/client-manager/process-supervisor.test.ts` + `test-helpers.ts`
- **依赖**: 无
- **行为快照/测试**: `buildClientArgs` 顺序/reserved、`#spawnOptions` 字段、grace/force 超时、`active` 清理。
- **行为风险**: 低；只加测试。
- **回滚**: revert 测试 commit。
- **DoD**: 命令/选项/终止顺序可断言；后续 E10-E13 必跑。

#### S12-E10 — 提取 `client-command.ts`

- **复杂度**: 简单（2h）
- **目标**: 移动 `RESERVED_ARGS`、`buildClientArgs`、`ActiveClient`、`buildClientCommand`、`buildSpawnOptions`；保留 `ProcessSupervisor` re-export `buildClientArgs`。
- **文件**:
  - 新增 `packages/gateway/src/client-manager/client-command.ts`
  - `src/packages/gateway/src/client-manager/process-supervisor.ts`
- **依赖**: E9
- **行为快照/测试**: E9；现有 supervisor 测试 `buildClientArgs` import 不变。
- **行为风险**: 低；纯搬移。
- **回滚**: revert 单 commit。
- **DoD**: 命令参数顺序、reserved 错误文案、`stdio` 默认 `inherit` 不变。

#### S12-E11 — Supervisor 使用 command 模块

- **复杂度**: 简单（1.5h）
- **目标**: `#startProcess` 使用 `buildClientCommand`/`buildSpawnOptions`；删除私有 `#command`/`#spawnOptions`。
- **文件**:
  - `src/packages/gateway/src/client-manager/process-supervisor.ts`
  - `packages/gateway/src/client-manager/client-command.ts`
- **依赖**: E10
- **行为快照/测试**: E9 + 现有 supervisor 全量。
- **行为风险**: 低。
- **回滚**: revert 单 commit。
- **DoD**: generation 闭包、`createChildProcessEnv`、onExit 传递不变。

#### S12-E12 — 提取 `process-termination.ts`

- **复杂度**: 中等（2.5h）
- **目标**: 把 `#terminateProcess`/`#waitForExit` 抽为 `terminateProcess(proc, deps)`；保留 grace 5s/force 3s、日志字段、错误文案。
- **文件**:
  - 新增 `packages/gateway/src/client-manager/process-termination.ts`
  - `src/packages/gateway/src/client-manager/process-supervisor.ts`
- **依赖**: E9
- **行为快照/测试**: E9；`process-supervisor.test.ts` 的 graceful/force/duplicate stop。
- **行为风险**: 中（进程终止）。
- **回滚**: revert 单 commit。
- **DoD**: `#proc/#active` 清理时机不变；`Failed to kill client ...` 文案不变；timer 清理无泄漏。

#### S12-E13 — Supervisor 使用终止模块 + 行数收尾

- **复杂度**: 简单（2h）
- **目标**: 删除旧私有终止方法；`process-supervisor.ts` ≤280；现有测试不改通过。
- **文件**:
  - `src/packages/gateway/src/client-manager/process-supervisor.ts`
  - `packages/gateway/src/client-manager/process-termination.ts`
- **依赖**: E12
- **行为快照/测试**: E9 + gateway 全量；`wc -l`。
- **行为风险**: 低。
- **回滚**: revert 单 commit。
- **DoD**: 状态机/restart/health 代码未动；`ClientManager` 106 行不变；Gateway 路由/测试绿。

#### S12-E14 — 新增纯消息投影 helpers

- **复杂度**: 中等（2.5h）
- **目标**: `session/message-projection.ts` 提供 `appendCurrentUserMessage`（返回新数组）、`projectPipelineMessage`（reasoning keep/drop）、`isPromptEligibleMessage` 复用；不改调用点。
- **文件**:
  - 新增 `packages/core/src/session/message-projection.ts`
  - 新增 `packages/core/src/session/message-projection.test.ts`
  - `src/packages/core/src/session/message-policy.ts`
- **依赖**: 无
- **行为快照/测试**: 追加相同/不同 user 消息、空 content、reasoning keep/drop、visible 过滤；现有 message-policy 测试。
- **行为风险**: 低；新函数未接线。
- **回滚**: revert 单 commit。
- **DoD**: 纯函数不改输入数组；`isPromptEligibleMessage` 仍只在 message-policy 定义。

#### S12-E15 — 迁移 `appendCurrentUserMessage` 调用点

- **复杂度**: 简单（1.5h）
- **目标**: `record-context.ts`、`format-user-messages.ts` 改用纯函数返回值；`types.ts` 删除变异实现（或 re-export 纯函数）。
- **文件**:
  - `src/packages/core/src/pipelines/conversation/elements/record-context.ts`
  - `src/packages/core/src/pipelines/conversation/elements/format-user-messages.ts`
  - `src/packages/core/src/pipelines/conversation/elements/types.ts`
- **依赖**: E14
- **行为快照/测试**: `collect-prompts.test.ts`/conversation 测试；新增“输入数组未被修改”断言。
- **行为风险**: 低；两个调用点当前都忽略返回值且数组是新建的。
- **回滚**: revert 单 commit。
- **DoD**: `appendCurrentUserMessage` 无 `push`；`record-context` 的 `userMessages` 赋值正确；重复消息过滤规则不变。

#### S12-E16 — 统一 reasoning/消息映射

- **复杂度**: 简单（2h）
- **目标**: `collect-prompts.ts`、`record-context.ts` 的 `{ role, content, reasoning_content }` 映射改用 `projectPipelineMessage`；保持 `collect-prompts` 的 reasoning 保留行为。
- **文件**:
  - `src/packages/core/src/pipelines/conversation/elements/collect-prompts.ts`
  - `src/packages/core/src/pipelines/conversation/elements/record-context.ts`
  - `packages/core/src/session/message-projection.ts`
- **依赖**: E15
- **行为快照/测试**: collect/record 测试；A1 stream 请求快照（reasoning 内容）。
- **行为风险**: 低；纯映射。
- **回滚**: revert 单 commit。
- **DoD**: `reasoning_content` 仅在有值时出现；`prompts` 过滤 tool 的规则不变。

#### S12-E17 — 去重 stringify / 消息投影残留

- **复杂度**: 简单（1.5h）
- **目标**: 确认 `stream` 模块只用 `tool-loop.stringifyToolOutput`；删除未使用的 `Message`/投影副本；加静态 guard 禁止再引入本地实现。
- **文件**:
  - `packages/core/src/pipelines/conversation/elements/stream/tool-runtime.ts`
  - `packages/core/src/session/message-projection.ts`
  - 新增 `packages/core/src/session/message-projection.guard.test.ts`
- **依赖**: A3/E16
- **行为快照/测试**: A1 + conversation 全量；`rg` 断言。
- **行为风险**: 低。
- **回滚**: revert 单 commit。
- **DoD**: `rg 'function stringifyToolOutput' src/packages/core/src` 仅 1 处；`rg 'appendCurrentUserMessage.*push'` 为 0。

#### S12-E18 — Core 残余行数检查

- **复杂度**: 简单（1.5h）
- **目标**: 检查 E 阶段目标文件行数/函数长度；记录 residual（`session/context.ts` 309 等）到问题文档；不硬拆范围外文件。
- **文件**:
  - 不改源码；更新 `docs/code-review-2026-11-10/code-review-s12-2026-11-12.md`（实施阶段）
- **依赖**: E1..E17
- **行为快照/测试**: `wc -l` + `rg` + 全量 Core 测试。
- **行为风险**: 低。
- **回滚**: revert 文档 commit。
- **DoD**: E 目标文件 ≤预算；例外清单与问题文档一致。

---

### S12-F — TUI chat store / useChat / ChatView（23h）

> 入口：`chat.test.ts` 85 行 + `App.test.ts`。F1 先记录 state 转换。

#### S12-F1 — Chat store 行为快照

- **复杂度**: 简单（2h）
- **目标**: 记录 `useChatStore` 在 delta/reason/tool/step/complete/busy/prepare/MCP/decision/snapshot 下的 state 转换；归一化时间/id。
- **文件**:
  - `src/packages/tui/src/stores/chat.test.ts`
  - 新增 `packages/tui/src/stores/chat-characterization.test.ts`
- **依赖**: 无
- **行为快照/测试**: 初始 state、delta 新建/追加、reason、tool 创建/更新/完成、busy=false、prepareForSend、MCP status/connected、decision prediction/post。
- **行为风险**: 低；只加测试。
- **回滚**: revert 测试 commit。
- **DoD**: 转换表覆盖所有 action；F2-F6 必跑。

#### S12-F2 — 提取 message slice

- **复杂度**: 简单（2h）
- **目标**: `message-slice.ts` 提供 messages/generateId/add/transient/update/clear；`chat.ts` 组合。
- **文件**:
  - 新增 `packages/tui/src/stores/chat/message-slice.ts`
  - `src/packages/tui/src/stores/chat.ts`
- **依赖**: F1
- **行为快照/测试**: F1 + chat 测试；新增 slice 单测。
- **行为风险**: 低；纯状态搬移。
- **回滚**: revert 单 commit。
- **DoD**: `generateId` 格式 `msg-${Date.now()}-${counter}` 不变；transient 2s 删除逻辑不变。

#### S12-F3 — 提取 stream slice

- **复杂度**: 中等（2.5h）
- **目标**: `stream-slice.ts` 提供 stream counters、`handleDelta`、`handleReason`、`recordStreamChunk`、`showPreparing`、`activeAssistantId`。
- **文件**:
  - 新增 `packages/tui/src/stores/chat/stream-slice.ts`
  - `src/packages/tui/src/stores/chat.ts`
- **依赖**: F2
- **行为快照/测试**: F1 delta/reason/counter；`estimateReceivedTokens` 批次保留 8。
- **行为风险**: 中（streaming 渲染）。
- **回滚**: revert 单 commit。
- **DoD**: offset 截断 `substring(0, offset) + delta` 不变；新 assistant 的 timestamp/reasoning/thinkingDuration 字段不变。

#### S12-F4 — 提取 tool slice

- **复杂度**: 中等（3h）
- **目标**: `tool-slice.ts` 提供 toolGroupId、`handleToolEvent`、`handleToolStepFinish`、`handleToolGroupComplete`。
- **文件**:
  - 新增 `packages/tui/src/stores/chat/tool-slice.ts`
  - `src/packages/tui/src/stores/chat.ts`
- **依赖**: F2
- **行为快照/测试**: F1 tool 创建/更新/完成；`chat.test.ts`；新增同名 tool call/错误/detail 单测。
- **行为风险**: 中（工具组顺序）。
- **回滚**: revert 单 commit。
- **DoD**: 首次 tool 事件结束 streaming assistant；group collapse+summary 字段不变；toolGroupId 清空时机不变。

#### S12-F5 — 提取 telemetry slice

- **复杂度**: 简单（2h）
- **目标**: `telemetry-slice.ts` 提供 rounds/todo/context/toolInfos/MCP/decision 的 setter。
- **文件**:
  - 新增 `packages/tui/src/stores/chat/telemetry-slice.ts`
  - `src/packages/tui/src/stores/chat.ts`
- **依赖**: F2
- **行为快照/测试**: F1 telemetry/MCP/decision；`updateMCPStatus` 只更新已有 server。
- **行为风险**: 低。
- **回滚**: revert 单 commit。
- **DoD**: `updateMCPConnected` 过滤旧 mcp toolInfos、`setDecisionUpdate` 按 purpose 分流不变。

#### S12-F6 — 组合 store slices

- **复杂度**: 中等（2.5h）
- **目标**: `chat.ts` 用 `StateCreator` 组合四个 slice；保持 `ChatState` 类型、`useChatStore` 导出、action 名不变。
- **文件**:
  - `src/packages/tui/src/stores/chat.ts`
  - `packages/tui/src/stores/chat/*.ts`
- **依赖**: F2..F5
- **行为快照/测试**: F1 + 全量 TUI 测试；`useChatStore.getState()` 字段集合断言。
- **行为风险**: 中（store API）。
- **回滚**: revert 单 commit；恢复单文件。
- **DoD**: `chat.ts` ≤120；无 selector/action 重命名；`setState` 外部调用（useChat/App）仍可用。

#### S12-F7 — 提取 `chat-connection.ts`

- **复杂度**: 中等（3h）
- **目标**: 把 `TuiClient` 的 15 个回调绑定从 `useEffect` 移到 `connectChat(options)`；返回 cleanup；保持事件顺序。
- **文件**:
  - 新增 `packages/tui/src/hooks/chat-connection.ts`
  - `src/packages/tui/src/hooks/useChat.ts`
- **依赖**: F6
- **行为快照/测试**: `useChat.test.ts` + 新增 connection 单测（fake client 事件→store state）。
- **行为风险**: 中（事件顺序/清理）。
- **回滚**: revert 单 commit。
- **DoD**: snapshot/telemetry/disconnect/delta/reason/tool/busy/decision/MCP 绑定顺序不变；cleanup 关闭 client 并置 null。

#### S12-F8 — 瘦身 `useChat.ts`

- **复杂度**: 简单（2h）
- **目标**: `useChat` 只保留 refs、effect 调 `connectChat`、`send/clear/add/compact/cancel`；`resolveChatClientError` 移到 `chat-errors.ts`（re-export）。
- **文件**:
  - `src/packages/tui/src/hooks/useChat.ts`
  - 新增 `packages/tui/src/hooks/chat-errors.ts`
- **依赖**: F7
- **行为快照/测试**: `useChat.test.ts`；`resolveChatClientError` 单测（API key/其他/空）。
- **行为风险**: 低。
- **回滚**: revert 单 commit。
- **DoD**: `useChat.ts` ≤120；返回对象 `{ send, clearMessages, addMessage, compact, cancel }` 不变；取消/错误文案不变。

#### S12-F9 — 提取 `chat-view-model.ts`

- **复杂度**: 简单（2h）
- **目标**: 把 `placeCompletedToolGroups` 与空状态/消息列表派生移到 `chat-view-model.ts`；`ChatView.tsx` 只渲染。
- **文件**:
  - 新增 `packages/tui/src/components/chat-view-model.ts`
  - `src/packages/tui/src/components/ChatView.tsx`
  - `src/packages/tui/src/components/App.test.ts`（import 改）
- **依赖**: F6
- **行为快照/测试**: `App.test.ts` 的 placement 断言；`ChatView` ≤90。
- **行为风险**: 低。
- **回滚**: revert 单 commit。
- **DoD**: `placeCompletedToolGroups` re-export 或测试 import 更新；空状态/ThinkingSpinner 渲染不变。

#### S12-F10 — 拆分 `ws-client.ts` 协议部分 + 清理

- **复杂度**: 简单（2h）
- **目标**: 把 `parseServerEvent`、`TuiTaskError`、事件 payload 类型移到 `ws-client-protocol.ts`；`ws-client.ts` ≤280；测试 import 兼容。
- **文件**:
  - 新增 `packages/tui/src/client/ws-client-protocol.ts`
  - `src/packages/tui/src/client/ws-client.ts`
  - `src/packages/tui/src/client/ws-client.test.ts`
- **依赖**: 无
- **行为快照/测试**: `ws-client.test.ts` 全量；新增 protocol parse 单测（非法 type/空 payload）。
- **行为风险**: 低。
- **回滚**: revert 单 commit。
- **DoD**: 错误名 `TaskCancelledError`/`ApiKeyInvalidError` 不变；路由表/事件处理不变；`ws-client.ts` ≤280。

---

### S12-G — TUI panels / App Modal / Wizard（59.5h）

> 入口：`App.test.ts`、`Sidebar.test.tsx`、`SettingsModal.test.ts`、`InputBar.test.ts`、`WizardApp.test.tsx`。

#### S12-G1 — Panel 行为快照

- **复杂度**: 简单（2h）
- **目标**: 记录现有纯函数/派生（gauge、layout、pipeline steps、tool placement、settings patch、wizard view）的输入输出；后续 G 阶段不改断言。
- **文件**:
  - `src/packages/tui/src/components/App.test.ts`
  - `src/packages/tui/src/components/Sidebar.test.tsx`
  - `src/packages/tui/src/components/SettingsModal.test.ts`
  - `src/packages/tui/src/components/InputBar.test.ts`
  - `src/packages/config-tui/src/components/WizardApp.test.tsx`
- **依赖**: 无
- **行为快照/测试**: 现有断言 + 新增派生函数矩阵。
- **行为风险**: 低；只加测试。
- **回滚**: revert 测试 commit。
- **DoD**: G2-G25 必跑；任何断言变更需在 commit message 说明“结构重组，语义相同”。

#### S12-G2 — 提取 `TelemetrySection` + `RoundsSection`

- **复杂度**: 简单（2h）
- **目标**: 把 `TelemetrySection`、`RoundsSection` 移到 `sidebar/`；`Sidebar.tsx` re-export `TelemetrySection`。
- **文件**:
  - 新增 `packages/tui/src/components/sidebar/TelemetrySection.tsx`
  - 新增 `packages/tui/src/components/sidebar/RoundsSection.tsx`
  - `src/packages/tui/src/components/Sidebar.tsx`
- **依赖**: G1
- **行为快照/测试**: `Sidebar.test.tsx`；G1。
- **行为风险**: 低。
- **回滚**: revert 单 commit。
- **DoD**: ROUNDS gauge/status/pause 文案不变；`TelemetrySection` props 不变。

#### S12-G3 — 提取 `TodoSection`

- **复杂度**: 中等（2.5h）
- **目标**: 把 TodoSection 的滚动跟随、键盘滚动、counts、active index 移到独立文件。
- **文件**:
  - 新增 `packages/tui/src/components/sidebar/TodoSection.tsx`
  - `src/packages/tui/src/components/Sidebar.tsx`
- **依赖**: G2
- **行为快照/测试**: `Sidebar.test.tsx`；新增 todo rows/count/scroll 派生单测。
- **行为风险**: 中（键盘/scroll）。
- **回滚**: revert 单 commit。
- **DoD**: Meta `▶ n / total`/`≡ total`、5 行阈值、active scrollIntoView 不变。

#### S12-G4 — 提取 Tools / Network sections

- **复杂度**: 简单（2h）
- **目标**: 把 TOOLS/MCP/NETWORK 段落移到 `ToolsSection.tsx`/`NetworkSection.tsx`。
- **文件**:
  - 新增 `packages/tui/src/components/sidebar/ToolsSection.tsx`
  - 新增 `packages/tui/src/components/sidebar/NetworkSection.tsx`
  - `src/packages/tui/src/components/Sidebar.tsx`
- **依赖**: G2
- **行为快照/测试**: `Sidebar.test.tsx`；tool state/run/ok/err 派生。
- **行为风险**: 低。
- **回滚**: revert 单 commit。
- **DoD**: entries.slice(-3)、MCP slice(0,4)、webfetch 统计不变。

#### S12-G5 — Sidebar 组合

- **复杂度**: 简单（1.5h）
- **目标**: `Sidebar.tsx` 只保留布局 + section 组合；re-export `SIDEBAR_WIDTH`/`buildGauge`；≤120。
- **文件**:
  - `src/packages/tui/src/components/Sidebar.tsx`
  - `packages/tui/src/components/sidebar/*.tsx`
- **依赖**: G2..G4
- **行为快照/测试**: `Sidebar.test.tsx` + G1；`wc -l`。
- **行为风险**: 低。
- **回滚**: revert 单 commit。
- **DoD**: 旧 import 全部可用；布局 border/width/background 不变。

#### S12-G6 — 提取 `runtime-steps.ts`

- **复杂度**: 简单（2h）
- **目标**: 把 `currentTurn`、`derivePipelineSteps`、`phaseCount`、`PipelineStep` 移到 `runtime/runtime-steps.ts`；`RuntimeSidebar.tsx` re-export `derivePipelineSteps`。
- **文件**:
  - 新增 `packages/tui/src/components/runtime/runtime-steps.ts`
  - `src/packages/tui/src/components/RuntimeSidebar.tsx`
- **依赖**: G1
- **行为快照/测试**: `App.test.ts` 的 derivePipelineSteps 矩阵。
- **行为风险**: 低。
- **回滚**: revert 单 commit。
- **DoD**: 4 个 step 的状态推导不变；`PipelineStep` 类型导出兼容。

#### S12-G7 — 提取 Session / Pipeline sections

- **复杂度**: 简单（2h）
- **目标**: 把 SESSION/UPTIME/QUEUE 与 PIPELINE 段落移到 `RuntimeSessionSection.tsx`/`RuntimePipelineSection.tsx`。
- **文件**:
  - 新增 `packages/tui/src/components/runtime/RuntimeSessionSection.tsx`
  - 新增 `packages/tui/src/components/runtime/RuntimePipelineSection.tsx`
  - `src/packages/tui/src/components/RuntimeSidebar.tsx`
- **依赖**: G6
- **行为快照/测试**: `App.test.ts`；新增 section 派生单测。
- **行为风险**: 低。
- **回滚**: revert 单 commit。
- **DoD**: ACTIVE/IDLE、uptime、`1 ACTIVE`/EmptyState、step 颜色不变。

#### S12-G8 — 提取 Decision / Stream / Stats sections

- **复杂度**: 中等（2.5h）
- **目标**: 把 DECISION/STREAM/STATS 段落移到 3 个 section；保留 decision state/source 颜色映射。
- **文件**:
  - 新增 `packages/tui/src/components/runtime/RuntimeDecisionSection.tsx`
  - 新增 `packages/tui/src/components/runtime/RuntimeStreamSection.tsx`
  - 新增 `packages/tui/src/components/runtime/RuntimeStatsSection.tsx`
  - `src/packages/tui/src/components/RuntimeSidebar.tsx`
- **依赖**: G6
- **行为快照/测试**: `App.test.ts` + G1。
- **行为风险**: 中（decision 显示）。
- **回滚**: revert 单 commit。
- **DoD**: PREDICT/POST CHECK、INTENT/MODEL/TOPIC/STATUS、stream activity/token/chunk、messages/tools ok/err 不变。

#### S12-G9 — RuntimeSidebar 组合

- **复杂度**: 简单（1.5h）
- **目标**: `RuntimeSidebar.tsx` 只保留 uptime timer + 组合；≤120。
- **文件**:
  - `src/packages/tui/src/components/RuntimeSidebar.tsx`
  - `packages/tui/src/components/runtime/*`
- **依赖**: G6..G8
- **行为快照/测试**: `App.test.ts` + G1；`wc -l`。
- **行为风险**: 低。
- **回滚**: revert 单 commit。
- **DoD**: 布局 width 26/border right 不变；timer cleanup 不变。

#### S12-G10 — 提取 `settings-model.ts`

- **复杂度**: 简单（2h）
- **目标**: 把 `PROFILE_LEVELS`、`THINKING_OPTIONS`、`MAX_TOKEN_OPTIONS`、`modelOptions`、`serverInfoFromConfig`、`buildRuntimePatch`、`headers` 移到 `settings/settings-model.ts`；`SettingsModal` re-export。
- **文件**:
  - 新增 `packages/tui/src/components/settings/settings-model.ts`
  - `src/packages/tui/src/components/SettingsModal.tsx`
- **依赖**: G1
- **行为快照/测试**: `SettingsModal.test.ts`。
- **行为风险**: 低。
- **回滚**: revert 单 commit。
- **DoD**: patch 字段（profiles/tui/providers/transport）与默认值不变；model 排序去重不变。

#### S12-G11 — 提取 `use-settings-config`

- **复杂度**: 中等（3h）
- **目标**: 把 load/patch/reset 的 fetch 与 state（config/values/error）抽到 hook；SettingsModal 只渲染。
- **文件**:
  - 新增 `packages/tui/src/components/settings/use-settings-config.ts`
  - `src/packages/tui/src/components/SettingsModal.tsx`
- **依赖**: G10
- **行为快照/测试**: `SettingsModal.test.ts`；新增 hook 的 fake fetch 单测（GET/PATCH/DELETE 错误）。
- **行为风险**: 中（网络/错误显示）。
- **回滚**: revert 单 commit。
- **DoD**: `/api/config`、`/api/config/runtime` 路径/headers/body 不变；onSaved/onClose 调用时机不变。

#### S12-G12 — SettingsModal 渲染收口

- **复杂度**: 简单（2h）
- **目标**: SettingsModal 只保留 rows 渲染、selectedIndex、cycleRow、Modal action；≤130。
- **文件**:
  - `src/packages/tui/src/components/SettingsModal.tsx`
  - `packages/tui/src/components/settings/*`
- **依赖**: G11
- **行为快照/测试**: `SettingsModal.test.ts` + G1。
- **行为风险**: 低。
- **回滚**: revert 单 commit。
- **DoD**: Modal 宽 66/高 16、actions/defaultAction、选中背景/颜色不变。

#### S12-G13 — 提取双击 ESC / cancel hint hook

- **复杂度**: 中等（2.5h）
- **目标**: 把 `isDoubleEscape`、lastPress/timer、`onCancelHint`/`onCancelTask` 逻辑移到 `input/use-double-escape.ts`。
- **文件**:
  - 新增 `packages/tui/src/components/input/use-double-escape.ts`
  - `src/packages/tui/src/components/InputBar.tsx`
- **依赖**: G1
- **行为快照/测试**: `InputBar.test.ts`；新增 hook 时序单测（2s 内/外、busy 清空）。
- **行为风险**: 中（键盘时序）。
- **回滚**: revert 单 commit。
- **DoD**: 2s 窗口、hint 文案、busy=false 时清理不变。

#### S12-G14 — 提取命令菜单 / 历史导航

- **复杂度**: 中等（3h）
- **目标**: 把 filter/matchCommands/menu navigation、history navigateUp/Down、fillFlag/navigatingRef 移到 `input/use-command-menu.ts`。
- **文件**:
  - 新增 `packages/tui/src/components/input/use-command-menu.ts`
  - `src/packages/tui/src/components/InputBar.tsx`
- **依赖**: G1
- **行为快照/测试**: `InputBar.test.ts` 的 Tab/Up/Down/Esc/菜单；新增 command dispatch 单测。
- **行为风险**: 中（输入行为）。
- **回滚**: revert 单 commit。
- **DoD**: `/quit`/`/help`/`/clear`/`/compact`/`/settings` dispatch 不变；Tab/上下选择/填充文本不变。

#### S12-G15 — InputBar 组合

- **复杂度**: 简单（1.5h）
- **目标**: InputBar 只保留 textarea、render、props 接线；≤170。
- **文件**:
  - `src/packages/tui/src/components/InputBar.tsx`
  - `packages/tui/src/components/input/*`
- **依赖**: G13/G14
- **行为快照/测试**: `InputBar.test.ts` + G1；`wc -l`。
- **行为风险**: 低。
- **回滚**: revert 单 commit。
- **DoD**: keyBindings、placeholder、borderColor、menu 定位不变。

#### S12-G16 — 新增 `AppModal` + `ModalSpec`

- **复杂度**: 中等（3.5h）
- **目标**: 定义 `ActiveModal` 判别联合与 `MODAL_CONFIG` 表：`title/width/height/actions/defaultActionKey/render/onAction`；新增 `AppModal.tsx`；不在 App 接线。
- **文件**:
  - 新增 `packages/tui/src/components/app/AppModal.tsx`
  - 新增 `packages/tui/src/components/app/app-modal-config.ts`
  - 新增 `packages/tui/src/components/app/AppModal.test.ts`
- **依赖**: G1
- **行为快照/测试**: 五类 modal（confirm-clear/confirm-quit/error/tool-details/settings）的 title/width/height/actions/defaultKey；action 回调。
- **行为风险**: 中（Modal 交互）。
- **回滚**: revert 单 commit；未接线。
- **DoD**: 配置表覆盖所有 kind；未新增 kind；`Modal` 组件不改。

#### S12-G17 — App 使用 AppModal

- **复杂度**: 简单（2h）
- **目标**: 删除 App.tsx 的 7 个三元表达式；改用 `AppModal`；布局/useChat/键盘不变；≤160。
- **文件**:
  - `src/packages/tui/src/components/App.tsx`
  - `packages/tui/src/components/app/AppModal.tsx`
- **依赖**: G16
- **行为快照/测试**: `App.test.ts` + G1；手工 Modal smoke。
- **行为风险**: 中（App 交互）。
- **回滚**: revert 单 commit；恢复内联 Modal。
- **DoD**: confirm clear/quit、error、tool details、settings 的 open/action/close 全部一致；无行为分支丢失。

#### S12-G18 — Wizard view 迁移快照

- **复杂度**: 简单（2h）
- **目标**: 记录 first-run/config 每个 action 的 view 迁移、quitConfirm 优先、providersFromDecisions 返回路径。
- **文件**:
  - `src/packages/config-tui/src/components/WizardApp.test.tsx`
  - 新增 `packages/config-tui/src/wizard/wizard-view.test.ts`（纯迁移表）
- **依赖**: 无
- **行为快照/测试**: menu→providers/profiles/decisions/theme/gateway/confirm；first-run providers→apikey→models→profiles→decisions→theme→project→confirm；back/cancel/quit。
- **行为风险**: 低；只加测试。
- **回滚**: revert 测试 commit。
- **DoD**: 迁移表覆盖 10 个 view；G19-G25 必跑。

#### S12-G19 — 提取 `wizard-state.ts`

- **复杂度**: 中等（3.5h）
- **目标**: 把 `WizardMode/WizardState/ProviderEdit`、`initialState`、`readJsonFile/readEnvKeys/buildInitialState`、`CONVERSATION_LEVELS` 移到 `wizard/wizard-state.ts`。
- **文件**:
  - 新增 `packages/config-tui/src/wizard/wizard-state.ts`
  - `src/packages/config-tui/src/wizard-logic.ts`
- **依赖**: G18
- **行为快照/测试**: `wizard-logic.test.ts` 614 行全量；G18。
- **行为风险**: 中（prefill）。
- **回滚**: revert 单 commit；恢复内联。
- **DoD**: 默认 provider/models/profiles/theme/port 不变；config 读取/decisionMode 过滤不变。

#### S12-G20 — 提取 `wizard-edit.ts`

- **复杂度**: 中等（3h）
- **目标**: 把 `PendingEdit/cloneEdit/emptyEdit/viewOf/beginEdit/beginNewProvider/updatePendingApiKey/finalizeEdit/collectModelIds` 移到 `wizard/wizard-edit.ts`。
- **文件**:
  - 新增 `packages/config-tui/src/wizard/wizard-edit.ts`
  - `src/packages/config-tui/src/wizard-logic.ts`
- **依赖**: G19
- **行为快照/测试**: `wizard-logic.test.ts` 的编辑/回滚/模型/profile 调整。
- **行为风险**: 中（pending edit 原子性）。
- **回滚**: revert 单 commit。
- **DoD**: 无 models / jev 非 endpoint 返回 null；config 模式 `step=1`；profile 自动替换规则不变。

#### S12-G21 — 提取 `wizard-commit.ts`

- **复杂度**: 中等（3h）
- **目标**: 把 `writeEnvKeys/buildProviderEntry/commit` 移到 `wizard/wizard-commit.ts`；保持同步原子写。
- **文件**:
  - 新增 `packages/config-tui/src/wizard/wizard-commit.ts`
  - `src/packages/config-tui/src/wizard-logic.ts`
- **依赖**: G19
- **行为快照/测试**: `wizard-logic.test.ts` 的 commit round-trip/unknown fields/AGENTS.md/installed。
- **行为风险**: 中（写盘）。
- **回滚**: revert 单 commit。
- **DoD**: `merged.tui = { ...(existing.tui ?? {}), theme }`；provider 深合并；first-run 文件内容不变。

#### S12-G22 — `wizard-logic.ts` 改为 barrel

- **复杂度**: 简单（1.5h）
- **目标**: `wizard-logic.ts` 只 re-export state/edit/commit 的公共符号；≤50 行；所有旧 import 不变。
- **文件**:
  - `src/packages/config-tui/src/wizard-logic.ts`
  - `packages/config-tui/src/wizard/*`
- **依赖**: G19..G21
- **行为快照/测试**: `wizard-logic.test.ts` + typecheck。
- **行为风险**: 低。
- **回滚**: revert 单 commit。
- **DoD**: 旧导出 `initialState/buildInitialState/beginEdit/.../commit/parsePort` 全部可用。

#### S12-G23 — 新增 `wizard-reducer.ts`

- **复杂度**: 中等（4h）
- **目标**: 定义 `WizardView` 判别联合、`WizardUiState`（wizard/pending/view/quitConfirm/providersFromDecisions）、`WizardAction`、`wizardReducer`、`resolveView`；纯函数。
- **文件**:
  - 新增 `packages/config-tui/src/wizard/wizard-reducer.ts`
  - 新增 `packages/config-tui/src/wizard/wizard-reducer.test.ts`
- **依赖**: G18
- **行为快照/测试**: G18 迁移表逐项；reducer 单测覆盖所有 action/guard。
- **行为风险**: 中（view 顺序）。
- **回滚**: revert 单 commit；未接线。
- **DoD**: `quitConfirm` 时 `resolveView` 返回 null；first-run/config 的 next/back 表一致；无只写不读字段。

#### S12-G24 — WizardApp 使用 reducer

- **复杂度**: 中等（3h）
- **目标**: `WizardApp.tsx` 用 `useReducer(wizardReducer)`；删除 10 处 `!quitConfirm &&`；render 按 `resolveView` 分发；≤180。
- **文件**:
  - `src/packages/config-tui/src/components/WizardApp.tsx`
  - `packages/config-tui/src/wizard/wizard-reducer.ts`
- **依赖**: G23
- **行为快照/测试**: `WizardApp.test.tsx` 全量；G18。
- **行为风险**: 中（用户流程）。
- **回滚**: revert 单 commit；恢复 useState。
- **DoD**: 所有 view/back/cancel/quit 行为不变；Modal 层级/ThemeProvider 不变。

#### S12-G25 — 删除只写 `step` + 提取 overlay

- **复杂度**: 简单（2h）
- **目标**: 从 `WizardState` 删除 `step`（及所有写入）；把 `Background`/`QuitConfirm` 移到 `wizard/wizard-overlays.tsx`；更新测试。
- **文件**:
  - `packages/config-tui/src/wizard/wizard-state.ts`
  - `packages/config-tui/src/wizard/wizard-edit.ts`
  - `packages/config-tui/src/wizard/wizard-overlays.tsx`
  - `src/packages/config-tui/src/components/WizardApp.tsx`
  - `src/packages/config-tui/src/wizard-logic.test.ts`
- **依赖**: G24
- **行为快照/测试**: `rg '\.step' src/packages/config-tui/src` 只剩无关字段；WizardApp/wizard-logic 测试。
- **行为风险**: 低；该字段无读取。
- **回滚**: revert 单 commit。
- **DoD**: `WizardState` 无 `step`；`WizardApp.tsx` ≤180；QuitConfirm 文案/actions 不变。

---

### S12-H — 行数与行为验收（11h）

#### S12-H1 — 新增 `scripts/check-code-size.ts`

- **复杂度**: 中等（3h）
- **目标**: 用 TypeScript AST 检查 S12 目标文件行数与函数体行数；允许显式例外清单；CI/本地可跑。
- **文件**:
  - 新增 `scripts/check-code-size.ts`
  - 新增 `scripts/check-code-size.test.ts`
  - 不改源码；实施时可在 `package.json` 增加 `check:size`（本规划不改）
- **依赖**: A..G
- **行为快照/测试**: 对 fixture 文件断言 >300 行/>100 行函数失败；对当前目标文件通过；例外清单只含问题文档第 5 节文件。
- **行为风险**: 低；只加工具。
- **回滚**: revert 单 commit；删除脚本。
- **DoD**: 支持 `--json` 输出；失败信息包含文件/函数/行号；S12 目标文件全部通过。

#### S12-H2 — 全量行为矩阵

- **复杂度**: 中等（3h）
- **目标**: 跑所有行为快照 + 目标测试 + 全量测试，记录基线/最终数字；对失败项定位到具体任务，不允许 skip。
- **文件**:
  - 不改源码；更新 [S12 实施计划](./code-review-s12-plan-2026-11-12.md) 的最终数字
- **依赖**: A..G
- **行为快照/测试**:
  - `stream-characterization`、memory schema/search、context snapshot、persistence dir/JSONL、chat store、wizard view。
  - `bun test src/packages/core/src/pipelines/conversation`
  - `bun test src/services/memory-service.test.ts`
  - `bun test src/packages/core/src/context src/packages/core/src/session`
  - `bun test src/packages/gateway/src/client-manager`
  - `bun test src/packages/tui/src src/packages/config-tui/src`
- **行为风险**: 中；可能暴露隐藏耦合。
- **回滚**: 无源码改动；失败回到对应任务修复。
- **DoD**: 所有目标测试 0 fail；失败项有任务 ID 与修复 commit。

#### S12-H3 — 文档 / README / CR 关闭

- **复杂度**: 中等（3h）
- **目标**: 更新 S12 三份文档、主计划 S12 段、`docs/index.md`、各目录 README、project-structure/architecture/tui-interface/memory/context/session 文档；记录 CR 关闭/残余。
- **文件**:
  - `docs/code-review-2026-11-10/code-review-s12-2026-11-12.md`
  - `docs/code-review-2026-11-10/code-review-s12-graph-2026-11-12.md`
  - `docs/code-review-2026-11-10/code-review-s12-plan-2026-11-12.md`
  - `docs/code-review-2026-11-10/code-review-plan-2026-11-10.md`
  - `docs/index.md`
  - `docs/overview/project-structure.md`
  - `docs/overview/architecture.md`
  - `docs/tui-interface.md`
  - `docs/subsystems/memory-service.md`
  - `docs/context-management.md`
  - `docs/core/session.md`
  - 各新目录 `README.md`
- **依赖**: H2
- **行为快照/测试**: `docs:check` / `docs:typecheck`；链接/`src/` 路径检查。
- **行为风险**: 低。
- **回滚**: revert 文档 commit。
- **DoD**: CR-STR-01/03/04/05/06/07/08/09/10、CR-ARCH-10/11/12、CR-DUP-11/12 状态明确；残余例外有说明；索引无断链。

#### S12-H4 — 最终验收数字

- **复杂度**: 简单（2h）
- **目标**: 跑 `typecheck`、`typecheck:node`、`bun test`（source/full）、`build`、Node smoke、package smoke、docs；记录最终数字与版本建议。
- **文件**:
  - 不改源码；更新 S12 计划/问题文档的“最终数字”
- **依赖**: H1..H3
- **行为快照/测试**:
  - `bun run typecheck`
  - `bun run typecheck:node`
  - `bun test --path-ignore-patterns='**/dist/**'`
  - `bun test`
  - `bun run build`
  - `bun run smoke:node`
  - `bun run smoke:node:package`
  - `bun run docs:check` / `bun run docs:typecheck`
  - `bun run scripts/check-code-size.ts`
- **行为风险**: 中；Node/build 可能暴露 import 边界。
- **回滚**: 无源码改动；失败回到对应任务。
- **DoD**: 全部通过；记录 pass/skip/fail、构建体积、目标文件行数；版本建议写入文档。

---

## 5. 任务规模表（S/M）

> S = 简单（≤2h），M = 中等（2–4h）。合计 **97 任务 / 237.5h**。

| ID | 任务 | 规模 | 工时 | 依赖 |
|---|---|---|---:|---|
| A1 | stream 行为快照 | S | 2 | — |
| A2 | model-input 提取 | S | 2.5 | A1 |
| A3 | stringify 统一 | S | 1.5 | — |
| A4 | tool status/metadata | S | 2 | A2 |
| A5 | governance runtime | S | 2 | A4 |
| A6 | builtin runtime | M | 3 | A5 |
| A7 | MCP runtime | M | 3 | A6 |
| A8 | 统一 execution adapter | M | 3.5 | A6/A7 |
| A9 | stream reporting | M | 3 | A2 |
| A10 | step context | M | 3.5 | A2/A9 |
| A11 | StepOutcome + chunk | S | 2 | A2 |
| A12 | stream step | M | 4 | A11 |
| A13 | tool batch | M | 4 | A8/A10 |
| A14 | stream loop | M | 4 | A12/A13 |
| A15 | finalize | M | 3 | A14 |
| A16 | slim + cleanup | S | 2 | A2-A15 |
| B1 | memory 快照 | S | 2 | — |
| B2 | memory types | S | 1.5 | B1 |
| B3 | memory store | M | 3.5 | B2 |
| B4 | service 委托 store | M | 3 | B3 |
| B5 | memory query | M | 3 | B4 |
| B6 | memory graph | M | 2.5 | B4 |
| B7 | tests/cleanup | S | 2 | B3/B5/B6 |
| C1 | context 快照 | S | 2 | — |
| C2 | context types | S | 2 | C1 |
| C3 | context codec | S | 2 | C2 |
| C4 | BucketStore CRUD | M | 3 | C3 |
| C5 | BucketStore 生命周期 | M | 3 | C4 |
| C6 | SnapshotManager | M | 4 | C5 |
| C7 | snapshot TTL | S | 2 | C6 |
| C8 | facade 收口 | S | 2 | C7 |
| C9 | tests/cleanup | S | 1.5 | C4-C8 |
| D1 | persistence 快照 | S | 2 | — |
| D2 | session format | M | 3 | D1 |
| D3 | durable fs | S | 2 | D2 |
| D4 | checkpoint store | M | 4 | D3 |
| D5 | facade checkpoint/restore | M | 2.5 | D4 |
| D6 | history store | M | 3.5 | D2 |
| D7 | facade history | M | 2.5 | D6 |
| D8 | tests/cleanup | S | 2 | D4/D6/D7 |
| E1 | check-follow-up 快照 | S | 2 | — |
| E2 | continuation rules | M | 3 | E1 |
| E3 | continuation arbitration | M | 3.5 | E2 |
| E4 | slim check-follow-up | S | 2 | E2/E3 |
| E5 | compress 快照 | S | 2 | — |
| E6 | compress commit | M | 3 | E5 |
| E7 | compress resume | M | 2.5 | E5 |
| E8 | slim compress-finalize | S | 2 | E6/E7 |
| E9 | supervisor 快照 | S | 1.5 | — |
| E10 | client command | S | 2 | E9 |
| E11 | supervisor 使用 command | S | 1.5 | E10 |
| E12 | process termination | M | 2.5 | E9 |
| E13 | supervisor 使用 termination | S | 2 | E12 |
| E14 | message projection | M | 2.5 | — |
| E15 | append 调用点 | S | 1.5 | E14 |
| E16 | reasoning 映射 | S | 2 | E15 |
| E17 | stringify/projection 残留 | S | 1.5 | A3/E16 |
| E18 | core 行数检查 | S | 1.5 | E1-E17 |
| F1 | chat store 快照 | S | 2 | — |
| F2 | message slice | S | 2 | F1 |
| F3 | stream slice | M | 2.5 | F2 |
| F4 | tool slice | M | 3 | F2 |
| F5 | telemetry slice | S | 2 | F2 |
| F6 | compose store | M | 2.5 | F2-F5 |
| F7 | chat connection | M | 3 | F6 |
| F8 | slim useChat | S | 2 | F7 |
| F9 | chat view model | S | 2 | F6 |
| F10 | ws-client protocol | S | 2 | — |
| G1 | panel 快照 | S | 2 | — |
| G2 | Telemetry/Rounds | S | 2 | G1 |
| G3 | TodoSection | M | 2.5 | G2 |
| G4 | Tools/Network | S | 2 | G2 |
| G5 | Sidebar 组合 | S | 1.5 | G2-G4 |
| G6 | runtime steps | S | 2 | G1 |
| G7 | session/pipeline sections | S | 2 | G6 |
| G8 | decision/stream/stats | M | 2.5 | G6 |
| G9 | RuntimeSidebar 组合 | S | 1.5 | G6-G8 |
| G10 | settings model | S | 2 | G1 |
| G11 | use-settings-config | M | 3 | G10 |
| G12 | SettingsModal 渲染 | S | 2 | G11 |
| G13 | double escape hook | M | 2.5 | G1 |
| G14 | command menu hook | M | 3 | G1 |
| G15 | InputBar 组合 | S | 1.5 | G13/G14 |
| G16 | AppModal + spec | M | 3.5 | G1 |
| G17 | App 使用 AppModal | S | 2 | G16 |
| G18 | wizard view 快照 | S | 2 | — |
| G19 | wizard state | M | 3.5 | G18 |
| G20 | wizard edit | M | 3 | G19 |
| G21 | wizard commit | M | 3 | G19 |
| G22 | wizard-logic barrel | S | 1.5 | G19-G21 |
| G23 | wizard reducer | M | 4 | G18 |
| G24 | WizardApp 使用 reducer | M | 3 | G23 |
| G25 | 删除 step + overlays | S | 2 | G24 |
| H1 | code-size guard | M | 3 | A-G |
| H2 | 全量行为矩阵 | M | 3 | A-G |
| H3 | 文档/README/CR | M | 3 | H2 |
| H4 | 最终验收数字 | S | 2 | H1-H3 |
| **合计** | **97 个任务** | **52 S / 45 M** | **237.5h** | |

### 按阶段汇总

| 阶段 | S | M | 工时 | 占比 |
|---|---:|---:|---:|---:|
| A | 7 | 9 | 45h | 19.1% |
| B | 3 | 4 | 17.5h | 7.4% |
| C | 6 | 3 | 21.5h | 9.1% |
| D | 3 | 5 | 21.5h | 9.1% |
| E | 12 | 6 | 38.5h | 16.3% |
| F | 6 | 4 | 23h | 9.7% |
| G | 14 | 11 | 59.5h | 25.3% |
| H | 1 | 3 | 11h | 4.7% |
| **合计** | **52** | **45** | **237.5h** | **100%** |

---

## 6. 测试矩阵

### 6.1 基线（`e3b51f5`）

| 项 | 基线 |
|---|---|
| `bun run typecheck` | 6/6 |
| `bun run typecheck:node` | 0 error |
| `bun test --path-ignore-patterns='**/dist/**'` | 1095 pass / 21 skip / 0 fail |
| `bun test` | 1968 pass / 21 skip / 0 fail |
| `bun run build` | 6/6 |
| `bun run smoke:node` | build check 5/5 + platform 15/15 + release 9/9 + conversation 11/11 |
| `bun run smoke:node:package` | 11/11 |
| `docs:check` / `docs:typecheck` | 通过 |

> S12 每个任务至少跑目标测试；H2 跑全量并记录最终数字。

### 6.2 场景矩阵

| 场景 | 阶段 | 测试文件 | 断言 |
|---|---|---|---|
| stream 四场景 | A1/A16 | `stream-characterization.test.ts` | 事件顺序、请求摘要、结果字段 |
| stream 边界 | A12-A14 | `stream-boundaries.test.ts` | intent/todo/reconcile/cancel/beforeCall |
| stream 缓存/上下文 | A10/A13 | `stream-cache.test.ts` | snapshot status、usage、cache、skill/todo |
| tool 循环 | A6-A8/A13 | `tool-loop.test.ts` + stream 测试 | batch/治理/记录/投影 |
| memory schema | B1/B3 | `memory-characterization.test.ts` | table/index/trigger/FTS SQL |
| memory 搜索/图 | B5/B6 | `memory-service.test.ts` + 新单测 | 顺序/过滤/limit/BFS |
| context bucket/snapshot | C1-C8 | `context-service.test.ts` + character | bucket id/lease/commit/dispose |
| persistence checkpoint | D1-D5 | `persistence-service.test.ts` + character | 目录/软链/JSONL/revision |
| persistence history | D1/D6/D7 | `persistence-service.test.ts` + 新单测 | archive/search/read/verify |
| check-follow-up 规则 | E1-E4 | `check-follow-up.test.ts` + character | 规则顺序/decision/事件 |
| compress 提交/恢复 | E5-E8 | `compress.test.ts` + character | 回滚/resume/context entries |
| supervisor 命令/终止 | E9-E13 | `process-supervisor.test.ts` + character | 命令/选项/信号/日志 |
| message projection | E14-E17 | `message-projection.test.ts` + conversation | 纯函数/reasoning/过滤 |
| chat store | F1-F6 | `chat.test.ts` + character | state 转换/action/API |
| chat connection | F7/F8 | `useChat.test.ts` + connection 单测 | 事件顺序/cleanup/send/cancel |
| ChatView | F9 | `App.test.ts` | tool placement/空状态 |
| ws-client | F10 | `ws-client.test.ts` | parse/error/route |
| Sidebar/Runtime | G1-G9 | `Sidebar.test.tsx` + `App.test.ts` | gauge/steps/todo/scroll |
| Settings | G1/G10-G12 | `SettingsModal.test.ts` | model/patch/load/reset |
| InputBar | G1/G13-G15 | `InputBar.test.ts` | Enter/Esc/Tab/Up/Down |
| App Modal | G16/G17 | `App.test.ts` + AppModal 单测 | title/actions/close |
| Wizard view/reducer | G18-G25 | `WizardApp.test.tsx` + reducer 单测 | 迁移表/guard/commit |
| 行数/函数 | H1 | `scripts/check-code-size.ts` | 目标文件 ≤300/函数 ≤100 |
| Bun 全量 | H2 | `bun test` | 0 fail；记录 pass/skip |
| Node 构建/入口 | H4 | `typecheck:node` / `smoke:node` | 0 error；全 PASS |
| Node 发布包 | H4 | `smoke:node:package` | tarball 安装/CLI/Core health |
| 文档 | H3/H4 | `docs:check` / `docs:typecheck` | 链接/类型通过 |

### 6.3 行为快照归一化规则

- 时间：`createdAt/accessedAt/startedAt/durationMs/timestamp/uptime` 置为固定占位或只断言类型。
- ID：`uuid/sessionId/taskId/toolCallId/msg-*` 归一化（`<id>`）。
- hash：`toolDefinitionsHash/staticPrefixHash/prefixHash` 只断言长度/存在，不断言具体值（除非输入固定且稳定）。
- DB：`sqlite_master.sql` 保留表/索引/trigger 名称与列顺序，允许空白差异。
- 目录：generation uuid 归一化；`current` 只断言目标模式。
- TUI：`Date.now` 用 `setSystemTime` 或归一化；`msg-*` id 归一化。

---

## 7. 回滚矩阵

| 阶段 | 主要风险 | 回滚方式 | 回滚点 |
|---|---|---|---|
| A | stream 循环/工具/事件顺序 | 恢复单文件 `stream-llm.ts`；A2-A15 re-export 可保留 | A9/A10/A14/A15/A16 单 commit |
| B | DB/迁移/排序 | 恢复 `memory-service` 内联；store/query/graph 不参与编译 | B3/B4/B5/B6 单 commit |
| C | snapshot lease/commit | 恢复 `#buckets/#snapshots` 内联 | C4/C6/C8 单 commit |
| D | checkpoint 写入/格式 | 恢复 `persistence-service` 内联；格式/目录不变 | D4/D6/D8 单 commit |
| E | 规则/仲裁/supervisor 终止 | 恢复 `check-follow-up`/`compress-finalize`/supervisor 内联 | E2/E3/E6/E7/E12/E14 单 commit |
| F | TUI store 事件顺序 | 恢复 `chat.ts`/`useChat.ts` 单文件 | F6/F7/F8 单 commit |
| G | 面板/输入/Modal/Wizard 流程 | 恢复对应组件单文件；旧导出仍在 | G5/G9/G12/G15/G17/G24/G25 单 commit |
| H | 测试/文档/guard | 只回退测试/文档/脚本 | H1-H4 |

### 回滚原则

- 每个任务一个 commit；回滚从后往前，不依赖后续任务。
- A2-A15 的 re-export 是行为回滚点；A16 删除 re-export 后，回滚需先恢复 A15。
- B/C/D 的 facade 是行为回滚点；内部文件回滚不影响公共 API。
- E 的纯函数先接线、后删内联；删除 commit 单独回滚。
- F/G 的旧组件导出保持到清理 commit；组件测试是主要防线。
- H 不回退生产代码；H 失败回到对应阶段修复，不添加白名单。

---

## 8. Definition of Done

### 每个任务

- [ ] 实现 + 测试同 commit。
- [ ] 目标测试通过；无新增 skip/only。
- [ ] `bun run typecheck` 通过（相关包）。
- [ ] 行为快照/旧测试不变（纯搬移任务）。
- [ ] 行为风险已写入 commit message（低/中，不写“高”）。
- [ ] 回滚命令明确（revert commit / 恢复字段）。
- [ ] 不新增模块级可变状态。
- [ ] 不修改禁区代码。

### S12 整体

- [ ] CR-STR-01/03/04/05/06/07/08/09/10、CR-ARCH-10/11/12、CR-DUP-11/12 全部关闭或有明确残余说明。
- [ ] CR-STR-02/11 不重新引入；`server.ts`/`tui-kit` 契约不变。
- [ ] 第 5 节目标文件全部 ≤300 行；`stream-llm.ts` ≤220；`process-supervisor.ts` ≤280。
- [ ] 目标文件导出/成员函数 ≤100 行；`stream-llm.doProcess` ≤100。
- [ ] `bun run typecheck` 6/6、`typecheck:node` 0 error。
- [ ] `bun test --path-ignore-patterns='**/dist/**'` 0 fail。
- [ ] `bun test` 0 fail（允许既有 dist 副本）。
- [ ] `bun run build` 6/6。
- [ ] `bun run smoke:node`、`smoke:node:package` 通过。
- [ ] `docs:check` / `docs:typecheck` 通过。
- [ ] 每个 Core/新目录有 README；项目结构文档同步。
- [ ] 显式例外（`protocol.ts`、`session/context.ts`）未被伪装成达标。

---

## 9. 估算与关键路径

### 总量

- **97 个任务**：52 个简单 + 45 个中等。
- **基线估算 237.5h ≈ 29.7 工程师日**。
- **Core 轨道（A-E）144h**；**TUI 轨道（F-G）82.5h**；H 11h。
- **单开发者关键路径**：237.5h ≈ 29.7 工程师日；加 15% 缓冲 ≈ **34 工程师日 / 7 周**。
- **两人（Core + TUI）**：max(151h, 86.5h) ≈ 151h；加 15% ≈ **22 工程师日 / 4 周**。
- **三人（Core-Stream / Core-Data+Misc / TUI）**：max(45h, 99h, 82.5h) ≈ 99h；加 15% ≈ **15 工程师日 / 3 周**。
- **四人（Core-Stream / Core-Data / Core-Misc / TUI）**：max(45h, 60.5h, 38.5h, 82.5h) ≈ 82.5h；加 15% ≈ **12 工程师日 / 2.5 周**。

### 为什么不是 8–12 天

原计划 8–12 天（64–96h）大致只覆盖：

- A 的主路径（45h）。
- B/C 的一部分（39h）。

合计 84h，尚未包含：

- D persistence（21.5h）。
- E helpers/supervisor/DUP（38.5h）。
- F/G TUI（82.5h）。
- H 验收（11h）。

因此 8–12 天只能得到“A+B+C 能编译的中间态”，无法满足 DoD。建议按 **3–4 人、12–15 个工作日**排期；单人需 6–7 周。

### 关键路径

```text
A1 → A2 → A4 → A5 → A6 → A7 → A8 → A13 → A14 → A15 → A16
  → H2 → H4
```

约 **51h**（A 45h + H2/H4 6h）。TUI 轨道 F+G 82.5h，是四人配置下的最长轨道。

### 并行轨道

```text
Core-Stream: A1..A16（关键路径）
Core-Data:   B1..B7 / C1..C9 / D1..D8（可再分两人）
Core-Misc:   E1..E18（E17 等 A3）
TUI:         F1..F10 → G1..G25
Acceptance:  H1..H4
```

### 建议 PR 拆分

| PR | 内容 | 预估 |
|---|---|---:|
| PR-S12-1 | A1-A5（快照 + 纯函数/治理） | 13.5h |
| PR-S12-2 | A6-A10（工具运行时/reporting/context） | 17h |
| PR-S12-3 | A11-A16（step/batch/loop/finalize/slim） | 14.5h |
| PR-S12-4 | B1-B7（memory） | 17.5h |
| PR-S12-5 | C1-C9（context） | 21.5h |
| PR-S12-6 | D1-D8（persistence） | 21.5h |
| PR-S12-7 | E1-E8（check-follow-up + compress） | 20h |
| PR-S12-8 | E9-E18（supervisor + projection + residual） | 18.5h |
| PR-S12-9 | F1-F10（TUI chat） | 23h |
| PR-S12-10 | G1-G15（Sidebar/Runtime/Settings/Input） | 32h |
| PR-S12-11 | G16-G25（App Modal + Wizard） | 27.5h |
| PR-S12-12 | H1-H4（验收/文档） | 11h |

> 每个 PR 内仍按任务单 commit；PR 只用于评审分组，不作为回滚单位。

---

## 10. 实施顺序与提交建议

### 第 1 周（Core 关键路径 + 并行启动）

```text
A1..A5   快照 + 纯函数 + 治理
A6..A10  工具运行时 / reporting / context
B1..B7   memory（第二人）
F1..F6   TUI chat store（第三人）
```

### 第 2 周（Core 循环 + 数据服务）

```text
A11..A16  step/batch/loop/finalize/slim
C1..C9    context（第二人）
D1..D8    persistence（第二人）
E1..E8    helpers（第四人/第三人）
F7..F10   useChat/ChatView/ws-client
```

### 第 3 周（TUI 面板 + 验收）

```text
E9..E18   supervisor / projection / residual
G1..G15   Sidebar/Runtime/Settings/Input
G16..G25  App Modal + Wizard
H1..H4    行数/全量/文档
```

### Commit message 建议

```text
test(core): add stream-llm behavior snapshots (S12-A1)
refactor(core): extract stream model input projections (S12-A2)
refactor(core): unify tool stringify helper (S12-A3)
refactor(core): add tool status collector (S12-A4)
refactor(core): extract governed tool runtime (S12-A6)
refactor(core): unify builtin and MCP adapters (S12-A8)
refactor(core): extract stream step and loop (S12-A12/A14)
refactor(core): slim StreamLLMElement (S12-A16)
refactor(memory): split store/query/graph (S12-B3/B5/B6)
refactor(context): split bucket store and snapshot manager (S12-C4/C6)
refactor(session): split checkpoint and history stores (S12-D4/D6)
refactor(core): extract continuation rules/arbitration (S12-E2/E3)
refactor(core): extract compress commit/resume (S12-E6/E7)
refactor(gateway): split supervisor command and termination (S12-E10/E12)
refactor(tui): split chat store slices (S12-F2..F6)
refactor(tui): add chat connection adapter (S12-F7)
refactor(tui): split sidebar/runtime sections (S12-G2..G9)
refactor(tui): add AppModal spec table (S12-G16)
refactor(config-tui): add wizard reducer (S12-G23)
test(core): add code size guard (S12-H1)
docs: close S12 (S12-H4)
```

---

## 11. 验收命令汇总

```bash
# 类型
bun run typecheck
bun run typecheck:node

# 源码测试
bun test --path-ignore-patterns='**/dist/**'

# 全量测试
bun test

# 构建
bun run build

# Node smoke
bun run smoke:node
bun run smoke:node:package

# 文档
bun run docs:check
bun run docs:typecheck

# 行数/函数（H1 后）
bun run scripts/check-code-size.ts

# 目标测试（示例）
bun test src/packages/core/src/pipelines/conversation
bun test src/services/memory-service.test.ts
bun test src/packages/core/src/context src/packages/core/src/session
bun test src/packages/gateway/src/client-manager
bun test src/packages/tui/src src/packages/config-tui/src

# 残留检查（S12 完成后）
rg -n 'function stringifyToolOutput' src/packages/core/src
# 期望：1

rg -n 'appendCurrentUserMessage.*push' src/packages/core/src
# 期望：0

rg -n '#toolResults\s*=\s*new Map' src/packages/core/src/pipelines/conversation/elements
# 期望：0（改为 ToolStatusCollector）

rg -n '!quitConfirm && view ===' src/packages/config-tui/src/components/WizardApp.tsx
# 期望：0

rg -n 'activeModal\.kind ===' src/packages/tui/src/components/App.tsx
# 期望：0（ModalSpec/AppModal）
```

---

## 12. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-11-12 | 初始 S12 实施计划：97 个任务（52 简单 / 45 中等），基线 237.5h；给出 A-H 子阶段、行为快照、测试矩阵、回滚矩阵、DoD、关键路径与 PR 拆分；仅文档，未改源码 |
