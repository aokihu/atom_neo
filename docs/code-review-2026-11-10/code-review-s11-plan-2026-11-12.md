# Atom Neo Code Review Plan — S11 Global State / DI — 2026-11-12

> 配套文件：
> - [code-review-s11-2026-11-12.md](./code-review-s11-2026-11-12.md)
> - [code-review-s11-graph-2026-11-12.md](./code-review-s11-graph-2026-11-12.md)
> - [code-review-plan-2026-11-10.md](./code-review-plan-2026-11-10.md)
>
> **Branch**: `code-review/2026-11-10`
> **Baseline**: `ef7ff15` (v1.22.12, S10 complete)
> **Status**: S11-A1–A11（CoreServices + Prompt DI）、S11-B/C（ElementRegistry + PipelineInstanceStore）、S11-E（ProcessSupervisor）与 S11-F（Theme import guard）已实施；D/G/H 待实施
> **Scope**: CR-ARCH-01..09；CR-ARCH-04/05 已关闭，仅防回归

---

## 0. 决策记录

| 决策 | 结论 | 影响 |
|---|---|---|
| S11 是否一次完成 | **否**，拆为 S11-A..H | 每段独立提交、可验证、可回滚 |
| 是否引入 DI 容器 | **否** | 只用构造器注入 + 显式对象/工厂 |
| `startCore` 是否保留 `sm` | 过渡期保留，S11-A5 删除 | 删除后 `CoreServices` 必填 |
| Prompt 单例 | **删除** | 每 Core 实例一个 `PromptRegistry` |
| Element registry | **实例化** | 每 Core 实例一个 `ElementRegistry` |
| `pipelineMap` | **删除** | 由 `PipelineInstanceStore` 注入 TaskEngine |
| TaskEngine | **单循环 + 唤醒 Promise** | 不改 `TaskQueue` 优先级规则 |
| FlowState | **不可变** | 每次传给 Element 新对象 |
| ClientManager | **拆 ProcessSupervisor** | 外部签名不变；健康失败新增重启 |
| TUI ThemeContext | **已由 S5 迁移** | S11 只加 import 图防回归 |
| `any` 清理 | **仅 Element 边界** | 不做全量 140 处；S12 继续 |
| 版本 | 子阶段不单独发版 | S11-H 完成后统一 bump（建议 1.23.0） |

### 估算口径

- 1 个工程师日 = 8 小时，仅含实现 + 自测，不含 Code Review 等待。
- 每个任务是**单个 commit**；估算含该任务的测试。
- “简单”通常 ≤2h，“中等”通常 2–4h；超过 4h 必须再拆。
- 估算基于当前仓库状态（`ef7ff15`）；若发现隐藏全局，按任务备注增加 2–4h。

---

## 1. 总体原则

1. **先契约，后迁移**：先加类型/实例/测试，再切调用点，最后删旧路径。
2. **行为不变**：HTTP/WS/Task/Event/pipeline 顺序、预算、检查点、关闭顺序不变；Gateway 健康重启是唯一内部行为变化。
3. **一个任务一个 commit**：每个任务可单独 revert；高风险任务先写失败测试。
4. **不做大爆炸**：不一次改完 48 处 `any`，不一次重写 `ClientManager`。
5. **过渡包装必须可删除**：legacy registry / `resolvePrompt` / `api/tasks` 旧函数都要有明确删除任务。
6. **双实例优先**：任何“全局”改动都必须用两个实例验证，而不是只跑单实例测试。
7. **Bun/Node 双支持**：新代码不用 Bun 专有 API；每个阶段末尾跑 `typecheck` + 目标测试。
8. **禁区不动**：未实现 Element、Replay、PipelineRunner/Manager、TUI 布局不改。

---

## 2. 子阶段总览

| 子阶段 | 主题 | 任务数 | S/M | 预估 | 依赖 | 主要 CR |
|---|---|---:|---:|---:|---|---|
| S11-A | 类型化 Services + PromptRegistry DI | 11 | 5/6 | 25.5h (3.2d) | — | CR-ARCH-03/06 |
| S11-B | ElementRegistry 实例化 | 7 | 3/4 | 15h (1.9d) | A5 | CR-ARCH-01 |
| S11-C | PipelineInstanceStore | 3 | 3/0 | 4h (0.5d) | B7 | CR-ARCH-02 |
| S11-D | TaskEngine 单循环 / 不可变 FlowState | 7 | 3/4 | 15h (1.9d) | C3 | CR-ARCH-08 |
| S11-E | ClientManager → ProcessSupervisor | 7 | 1/6 | 20h (2.5d) | 可与 A/B 并行 | CR-ARCH-09 |
| S11-F | TUI ThemeContext 防回归 | 1 | 1/0 | 1h (0.1d) | — | CR-ARCH-05（已关闭） |
| S11-G | Element 边界窄接口 | 6 | 2/4 | 14h (1.8d) | A11/B7/D4 | CR-ARCH-07（范围收窄） |
| S11-H | 双实例验收 / 清理 / 文档 | 7 | 2/5 | 15.5h (1.9d) | A..G | 全部 |
| **合计** | | **49** | **20/29** | **110h (13.75d)** | | |

### 顺序原则

```text
S11-A（Services → Prompt）
  ↓
S11-B（ElementRegistry）
  ↓
S11-C（PipelineInstanceStore）
  ↓
S11-D（TaskEngine）
  ↓
S11-G（Element 窄接口）
  ↓
S11-H（双实例验收 / 清理）

S11-E（Gateway ProcessSupervisor）可从头并行
S11-F（Theme guard）随时可做
```

- **不要先做 TaskEngine**：它依赖 C 的 store 和 B 的 registry；先改会把两处风险叠加。
- **不要先做窄接口**：G 与 A 的 Prompt 注入改同一批 Element 文件，按 A → G 顺序避免冲突。
- **E 独立**：Gateway 包不依赖 Core registry/prompt，可分配给第二个开发者。
- **H1 双实例是出口条件**：必须在 H6 全量回归前通过。

---

## 3. 任务格式与过渡约定

每个任务统一包含：目标、文件、依赖、测试、行为风险、回滚、DoD。复杂度只用 **简单（S）** 或 **中等（M）**。

> **路径约定**：为避免 `docs:check` 把“规划中的新文件”误判为断链，本文件对**待新增**文件使用省略 `src/` 前缀的路径（例如 `packages/core/src/core-services.ts`，实际位于仓库 `src/` 下的对应路径）；已存在文件仍使用完整 `src/` 前缀。

### 过渡包装规则

| 对象 | 过渡实现 | 删除任务 |
|---|---|---|
| registry | `legacyRegistry` + 旧自由函数 | B7 |
| prompt | 旧 `resolvePrompt` / `getRegistry` | A11 |
| pipelineMap | `api/tasks.ts` 委托临时实例 | C3 |
| `sm` | `resolveCoreServices({ services, sm })` | A5 |
| TaskEngine | 保留旧 `#processNext` 到 D2 通过 | D2 |
| ClientManager | 外部签名不变，内部委托 supervisor | E7 |

### 每个任务的 DoD（通用）

- [ ] 代码 + 测试同一 commit。
- [ ] 目标测试通过；不新增失败用例。
- [ ] `bun run typecheck` 通过（涉及 core/gateway 包）。
- [ ] 行为风险已验证（见任务）。
- [ ] 回滚方式已写入 commit message。
- [ ] 不新增模块级可变状态。
- [ ] 不修改禁区代码。

---

## 4. 详细任务

### S11-A — 类型化 Services + PromptRegistry DI（25.5h）

#### S11-A1 — 定义 `CoreServices` 契约

- **复杂度**: 简单（2h）
- **目标**: 用显式对象替代字符串服务定位；定义 `MemoryServiceLike`、`CoreServices`、`assertCoreServices`。
- **文件**:
  - 新增 `packages/core/src/core-services.ts`
  - 复用 `src/packages/core/src/skills/types.ts` 的 `SkillServiceLike`
  - 复用 `src/packages/shared/src/types/network.ts` 的 `NetworkServiceLike`
- **依赖**: 无
- **测试**: 新增 `core-services.test.ts`：必填 `memory/network` 缺失抛错；`skill/compiler` 可缺省。
- **行为风险**: 低；纯类型 + 校验函数，未接线。
- **回滚**: revert 单 commit；无调用点变化。
- **DoD**: `CoreServices` 可从 core 包内导入；错误信息包含缺失字段名。

#### S11-A2 — 增加 `resolveCoreServices` 过渡解析

- **复杂度**: 简单（2h）
- **目标**: 从 `{ services?, sm? }` 解析出 `CoreServices`，为 A3/A4 提供过渡；缺失必填服务立即抛错。
- **文件**:
  - `packages/core/src/core-services.ts`
  - `packages/core/src/core-services.test.ts`
- **依赖**: A1
- **测试**: 仅 `services`、仅 `sm`、两者都有（`services` 优先）、缺 `memory`、缺 `network`、`skill/compiler` 缺省。
- **行为风险**: 低；尚未接入 bootstrap。
- **回滚**: revert 单 commit。
- **DoD**: 解析函数纯函数化（不读全局、不构造服务）；测试覆盖 6 种输入。

#### S11-A3 — bootstrap 改用 `CoreServices`

- **复杂度**: 中等（3h）
- **目标**: `createCoreBootstrap` 从 `options.services` 取依赖，删除 `sm.get`；过渡期允许 `sm` 回退。
- **文件**:
  - `src/packages/core/src/bootstrap.ts`
  - `src/packages/core/src/server.ts`（`CoreDeps` 增加 `services?`）
  - `src/packages/core/src/server-continuation.test.ts`（fake services）
- **依赖**: A2
- **测试**: 现有 server-continuation 通过；新增缺失 `memory/network` 启动即失败测试。
- **行为风险**: 中；构造顺序变化。保持 `getCompiledPrompt` 空 prompt 回退。
- **回滚**: 恢复 `sm.get` 四行；A2 helper 可保留。
- **DoD**: `bootstrap.ts` 不再出现 `sm.get`；`CoreServices` 可选时仍兼容旧测试。

#### S11-A4 — `startCore` / `main.ts` 显式传 services

- **复杂度**: 中等（3h）
- **目标**: `main.ts` 构造 `CoreServices` 并传给 `startCore`；`ServiceManager` 只负责启停。
- **文件**:
  - `src/main.ts`
  - `src/packages/core/src/server.ts`
  - `src/packages/core/src/index.ts`（导出 `CoreServices`）
  - `src/packages/core/src/server-continuation.test.ts`
- **依赖**: A3
- **测试**: `main.ts` typecheck；`startCore` 单测用 fake services；两个服务实例可同时启动。
- **行为风险**: 中；`main.ts` 是唯一组合根，错传会导致工具缺失。保持 `memory/network` 同一实例。
- **回滚**: revert 单 commit；`sm` 回退仍在 A3。
- **DoD**: `startCore` 接收 `services`；`main.ts` 不再把 `sm` 传入 core。

#### S11-A5 — 删除 `sm` 与字符串定位

- **复杂度**: 简单（2h）
- **目标**: 从 `CoreDeps`/`CoreBootstrapOptions` 删除 `sm`；删除 `ServiceProvider` 与过渡解析的 `sm` 分支。
- **文件**:
  - `src/packages/core/src/bootstrap.ts`
  - `packages/core/src/core-services.ts`
  - `src/packages/core/src/server.ts`
  - `src/packages/core/src/index.ts`
- **依赖**: A4
- **测试**: 全量 core 测试；`rg 'sm.get' src/packages/core/src` 为 0。
- **行为风险**: 中；任何遗漏的调用点会编译失败（预期）。
- **回滚**: revert 单 commit；恢复 `sm?` 字段与 helper 分支。
- **DoD**: `CoreDeps` 只接受 `services`；缺失必填服务 fail-fast。

> **实施状态（A1–A5）**: 已完成（2026-11-12）。`CoreServices` / `resolveCoreServices` / `assertCoreServices` 已落地；`createCoreBootstrap` 与 `startCore` 只接收 `services`，`sm`/`ServiceProvider` 已从 Core 删除；`main.ts` 构造同一批 Memory/Network/Skill/Compiler 实例并注入；Node smoke、e2e、server-continuation 与 `budget-live-validation` 调用点已迁移。缺失 `memory/network` 在创建 HTTP server 前 fail-fast。验证：typecheck 6/6、typecheck:node 0 error、目标测试通过、全量测试通过。

#### S11-A6 — 增加 `createPromptRegistry` 工厂

- **复杂度**: 简单（1.5h）
- **目标**: 一次性注册语言/模型变体，返回独立 `PromptRegistry`；导出类值。
- **文件**:
  - `src/packages/shared/src/prompts/index.ts`
  - `src/packages/shared/src/index.ts`
  - `src/packages/shared/src/prompts/prompts.test.ts`
- **依赖**: 无
- **测试**: 两个 registry 独立；注册顺序/输出与 `initPromptRegistry` 一致；缓存命中。
- **行为风险**: 低；旧 `initPromptRegistry` 暂保留。
- **回滚**: revert 单 commit。
- **DoD**: `createPromptRegistry()` 可用；同一 key/provider/model 输出逐字一致。

#### S11-A7 — 增加 `PromptResolver` 契约

- **复杂度**: 简单（1.5h）
- **目标**: 窄函数 `(key, providerModel?) => string`；默认 provider/model 保持 `openai/gpt-4o`。
- **文件**:
  - `src/packages/shared/src/prompts/index.ts`
  - `src/packages/shared/src/prompts/prompts.test.ts`
- **依赖**: A6
- **测试**: 默认值、显式 provider/model、空字符串、未知 provider fallback `en`。
- **行为风险**: 低；未接线。
- **回滚**: revert 单 commit。
- **DoD**: `createPromptResolver(registry)` 不持有全局；两个 resolver 互不影响。

#### S11-A8 — Conversation pipeline 注入 resolver

- **复杂度**: 中等（3h）
- **目标**: `load-system-prompt` / `record-context` / `apply-source-context` 使用注入 resolver；pipeline factory 透传。
- **文件**:
  - `src/packages/core/src/pipelines/conversation/index.ts`
  - `.../elements/load-system-prompt.ts`
  - `.../elements/record-context.ts`
  - `.../elements/apply-source-context.ts`
  - `src/packages/core/src/pipeline-factory.ts`
  - `src/packages/core/src/bootstrap.ts`
- **依赖**: A7
- **测试**: conversation pipeline 现有测试；prompt 输出快照（迁移前后一致）；三个 Element 的单测。
- **行为风险**: 中；构造参数变化。保持 `providerModel` 默认值与 prompt key 不变。
- **回滚**: revert 单 commit；旧 `resolvePrompt` 仍可用。
- **DoD**: 三个 Element 不再 import `resolvePrompt` 自由函数；pipeline deps 显式含 `promptResolver`。

#### S11-A9 — Prediction / decision 注入 resolver

- **复杂度**: 中等（2.5h）
- **目标**: `predict-intent`、`check-follow-up` 与 `chooseDecision` 使用注入 resolver。
- **文件**:
  - `src/packages/core/src/pipelines/prediction/elements/predict-intent.ts`
  - `src/packages/core/src/pipelines/prediction/index.ts`
  - `src/packages/core/src/pipelines/conversation/elements/check-follow-up.ts`
  - `src/packages/core/src/decision/choose.ts`
  - `src/packages/core/src/pipeline-factory.ts`
- **依赖**: A7
- **测试**: prediction / check-follow-up 测试；`chooseDecision` 的 simulate/LLM 路径；prompt 参数传递。
- **行为风险**: 中；`chooseDecision` 是共享函数，需保持默认参数兼容。
- **回滚**: revert 单 commit；旧 `resolvePrompt` 仍可用。
- **DoD**: 三处不再 import 自由函数；所有调用点传 resolver。

#### S11-A10 — Evaluator / post / shared LLM 注入 resolver

- **复杂度**: 中等（2.5h）
- **目标**: `evaluator-analyze`、`post-conversation/finalize`、`shared/llm` 使用注入 resolver。
- **文件**:
  - `src/packages/core/src/pipelines/follow-up-evaluator/elements/evaluator-analyze.ts`
  - `src/packages/core/src/pipelines/follow-up-evaluator/index.ts`
  - `src/packages/core/src/pipelines/post-conversation/elements/finalize.ts`
  - `src/packages/core/src/pipelines/post-conversation/index.ts`
  - `src/packages/core/src/pipelines/shared/llm.ts`
- **依赖**: A7
- **测试**: evaluator/post 单测；`callLLM` 的 prompt 参数；prompt 快照。
- **行为风险**: 中；`callLLM` 被多个 pipeline 使用，保持默认参数。
- **回滚**: revert 单 commit。
- **DoD**: 生产代码无 `resolvePrompt` 自由函数调用（除旧导出定义）。

#### S11-A11 — 删除 Prompt 单例与旧导出

- **复杂度**: 中等（2.5h）
- **目标**: 删除 `_instance` / `getRegistry` / `initPromptRegistry` / 自由 `resolvePrompt`；更新测试与 barrel。
- **文件**:
  - `src/packages/shared/src/prompts/index.ts`
  - `src/packages/shared/src/index.ts`
  - `src/packages/shared/src/prompts/prompts.test.ts`
  - `src/packages/core/src/pipelines/follow-up-evaluator/evaluator.test.ts`
  - `src/packages/core/src/pipelines/post-conversation/elements/finalize.test.ts`
  - 所有残留 import
- **依赖**: A8/A9/A10
- **测试**: `rg` 残留检查；全量 shared/core 测试。
- **行为风险**: 中；测试需显式创建 registry。任何遗漏会在编译期暴露。
- **回滚**: revert 单 commit；恢复旧导出与 `_instance`。
- **DoD**: `rg 'getRegistry\\(|initPromptRegistry\\(' src` 为 0；prompt 测试全部用 `createPromptRegistry`。

> **实施状态**: 已完成（2026-11-12）。`createPromptRegistry()` / `createPromptResolver()` 已落地；`_instance`、`getRegistry()`、`initPromptRegistry()`、自由 `resolvePrompt()` 与旧 barrel 导出已删除。`createCoreBootstrap` 每个 Core 实例创建一个 registry + resolver，经 `createPipelineFactory` 注入 conversation / prediction / follow-up-evaluator / context-compress / post-conversation；`chooseDecision`、`callLLM`、JEV 模拟路径均要求显式 resolver。Prompt 文本、语言 fallback、模型 refinement 顺序与缓存语义保持不变；`prompts.test.ts` 增加两个 registry 独立与逐字一致测试。
>
> - [x] `rg 'resolvePrompt|initPromptRegistry|getRegistry\(|_instance' src` 为 0。
> - [x] 同一 key/provider/model 在 factory 与手工注册（原 `initPromptRegistry` 顺序）之间逐字一致。
> - [x] 两个 registry 的后续注册、缓存与 resolver 互不影响。
> - [x] 目标测试：shared + core 663 pass / 0 fail；全量 1874 pass / 21 skip / 0 fail。

---

### S11-B — ElementRegistry 实例化（15h）

#### S11-B1 — 新增 `ElementRegistry` 类

- **复杂度**: 简单（2h）
- **目标**: 提供 `register/resolve/names/clear`，保持错误文案。
- **文件**:
  - `src/packages/core/src/pipeline/registry.ts`
  - `src/packages/core/src/pipeline/registry.test.ts`
- **依赖**: 无
- **测试**: 注册/解析/重复/缺失/names 顺序/clear。
- **行为风险**: 低；新类暂不接线。
- **回滚**: revert 单 commit。
- **DoD**: 类可独立测试；不依赖模块级 Map。

#### S11-B2 — 保留 legacy 自由函数过渡

- **复杂度**: 简单（1h）
- **目标**: `registerElement/resolveElement/getRegisteredNames/clearRegistry` 委托到 `legacyRegistry`，标记 deprecated。
- **文件**:
  - `src/packages/core/src/pipeline/registry.ts`
  - `src/packages/core/src/pipeline/registry.test.ts`
- **依赖**: B1
- **测试**: 现有 `registry.test.ts` / `builder.test.ts` / `manager.test.ts` 不改也通过。
- **行为风险**: 低；行为完全一致。
- **回滚**: revert 单 commit。
- **DoD**: 旧测试全绿；legacy 实例只此一处。

#### S11-B3 — Conversation / shared 注册函数接收 registry

- **复杂度**: 中等（2.5h）
- **目标**: `registerConversationElements(registry?)` / `registerSharedElements(registry?)` 默认 legacy，保持现有调用不变。
- **文件**:
  - `src/packages/core/src/pipelines/conversation/index.ts`
  - `src/packages/core/src/pipelines/shared/index.ts`
  - `src/packages/core/src/pipelines/shared/index.test.ts`
- **依赖**: B2
- **测试**: 传入新 registry 时只注册到新实例；不传时仍注册 legacy。
- **行为风险**: 低；默认参数保持兼容。
- **回滚**: revert 单 commit。
- **DoD**: 两个注册函数可在实例上工作；现有 bootstrap 调用不变。

#### S11-B4 — 其余注册函数接收 registry

- **复杂度**: 简单（2h）
- **目标**: prediction/follow-up/follow-up-evaluator/context-compress/post-conversation 五个注册函数增加可选 registry。
- **文件**:
  - `src/packages/core/src/pipelines/prediction/index.ts`
  - `src/packages/core/src/pipelines/follow-up/index.ts`
  - `src/packages/core/src/pipelines/follow-up-evaluator/index.ts`
  - `src/packages/core/src/pipelines/context-compress/index.ts`
  - `src/packages/core/src/pipelines/post-conversation/index.ts`
- **依赖**: B2
- **测试**: 每个 pipeline 现有测试；传入新 registry 的隔离测试（可合并到 B3 测试）。
- **行为风险**: 低；默认参数。
- **回滚**: revert 单 commit。
- **DoD**: 7 个注册函数全部支持实例参数。

#### S11-B5 — PipelineBuilder 接收 registry

- **复杂度**: 中等（2.5h）
- **目标**: `new PipelineBuilder(name, registry?)` 与 `pipeline(name, registry?)`；默认 legacy。
- **文件**:
  - `src/packages/core/src/pipeline/builder.ts`
  - `src/packages/core/src/pipeline/builder.test.ts`
  - `src/packages/core/src/pipeline/manager.test.ts`
- **依赖**: B2
- **测试**: 默认行为不变；传入 registry 时解析该实例；缺失仍抛错。
- **行为风险**: 低；默认参数。
- **回滚**: revert 单 commit。
- **DoD**: Builder 不再直接依赖全局 `resolveElement`；默认路径兼容。

#### S11-B6 — 将 registry 穿透 pipeline factory 与 6 条 pipeline

- **复杂度**: 中等（3h）
- **目标**: bootstrap 创建 registry，传给注册函数与 `createPipelineFactory`；6 条 pipeline 函数把 registry 传给 `pipeline()`。
- **文件**:
  - `src/packages/core/src/bootstrap.ts`
  - `src/packages/core/src/pipeline-factory.ts`
  - `src/packages/core/src/pipelines/conversation/index.ts`
  - `src/packages/core/src/pipelines/prediction/index.ts`
  - `src/packages/core/src/pipelines/follow-up/index.ts`
  - `src/packages/core/src/pipelines/follow-up-evaluator/index.ts`
  - `src/packages/core/src/pipelines/context-compress/index.ts`
  - `src/packages/core/src/pipelines/post-conversation/index.ts`
- **依赖**: B5
- **测试**: 5 条 pipeline 构造测试；两个 bootstrap 的 registry 隔离；元素顺序快照。
- **行为风险**: 中；所有 pipeline deps 增加 `elementRegistry`，遗漏会编译失败。
- **回滚**: revert 单 commit；恢复默认 legacy。
- **DoD**: 生产路径只用实例 registry；`pipeline()` 调用均传 registry。

#### S11-B7 — 删除 legacy 全局 registry

- **复杂度**: 中等（2h）
- **目标**: 删除 `legacyRegistry`、旧自由函数、core barrel 旧导出；测试改用 `createElementRegistry`。
- **文件**:
  - `src/packages/core/src/pipeline/registry.ts`
  - `src/packages/core/src/index.ts`
  - `src/packages/core/src/pipeline/*.test.ts`
  - `src/packages/core/src/server-continuation.test.ts`
  - `src/packages/core/src/pipelines/**/*.test.ts`
- **依赖**: B6
- **测试**: `rg 'clearRegistry|registerElement\\(|resolveElement\\(' src --glob '!**/*.test.*'` 为 0；全量 core 测试。
- **行为风险**: 中；测试需要显式 registry。
- **回滚**: revert 单 commit；恢复 B2 包装。
- **DoD**: 模块级 registry 完全删除；`clearRegistry` 仅测试 helper 可不存在。

> **实施状态（B1–B7）**: 已完成（2026-11-12）。新增 `ElementRegistry` 类与 `createElementRegistry()`（`register/resolve/names/clear`，重复与缺失错误文案不变）；7 个 `register*Elements`、`PipelineBuilder` 与 `pipeline()` 均要求显式 registry；`createPipelineFactory` 与 `createCoreBootstrap` 每个 Core 创建并透传独立实例；模块级 registry 与旧自由函数已删除。测试覆盖注册/重复/缺失/顺序/clear、双 registry 同名隔离、Builder 仅解析注入实例；`server-continuation` 不再保存/恢复全局表。
>
> - [x] `rg 'registerElement\(|resolveElement\(|getRegisteredNames\(|clearRegistry' src --glob '!**/dist/**'` 为 0。
> - [x] 两个 registry 可注册同名元素，`names/clear` 互不影响；两个 bootstrap 的 registry/store 相互独立。
> - [x] 6 条 pipeline 构造测试与 `server-continuation` 全绿；元素顺序、缺失错误文案不变。
> - [x] 目标测试：pipeline/shared/prediction/compress + TaskEngine + bootstrap isolation 202 pass / 0 fail；`server-continuation` 8 pass / 0 fail。

---

### S11-C — PipelineInstanceStore（4h）

#### S11-C1 — 新增 `PipelineInstanceStore`

- **复杂度**: 简单（1.5h）
- **目标**: `get/set/delete/size/clear`，无全局状态。
- **文件**:
  - 新增 `packages/core/src/pipeline/instance-store.ts`
  - 新增 `packages/core/src/pipeline/instance-store.test.ts`
- **依赖**: 无
- **测试**: CRUD、覆盖写、未命中、两个实例隔离。
- **行为风险**: 低；未接线。
- **回滚**: revert 单 commit。
- **DoD**: 类可独立测试；无 TTL/容量逻辑。

#### S11-C2 — TaskEngine 注入 store

- **复杂度**: 简单（1.5h）
- **目标**: 删除 `task-engine.ts` 对 `api/tasks` 的 import；构造参数接收 store；bootstrap 创建并传入。
- **文件**:
  - `src/packages/core/src/task-engine.ts`
  - `src/packages/core/src/bootstrap.ts`
  - `src/packages/core/src/task-engine.test.ts`
- **依赖**: C1, B7
- **测试**: 成功/失败/取消/drain 后 `store.size === 0`；两个 engine 两个 store 隔离。
- **行为风险**: 中；finally 清理路径必须完整。
- **回滚**: revert 单 commit；恢复 `api/tasks` import。
- **DoD**: `rg 'getPipeline\\(|setPipeline\\(|removePipeline\\(' src/packages/core/src/task-engine.ts` 为 0。

#### S11-C3 — 删除 `api/tasks.ts` 的 pipelineMap

- **复杂度**: 简单（1h）
- **目标**: 删除 `pipelineMap` 与三个导出；更新 barrel/测试（如有）。
- **文件**:
  - `src/packages/core/src/api/tasks.ts`
  - `src/packages/core/src/api/tasks.test.ts`
  - `src/packages/core/src/index.ts`
- **依赖**: C2
- **测试**: `rg 'pipelineMap' src` 为 0；api/tasks 测试通过。
- **行为风险**: 低；无其他调用点。
- **回滚**: revert 单 commit。
- **DoD**: `api/tasks.ts` 只保留 HTTP handler。

> **实施状态（C1–C3）**: 已完成（2026-11-12）。新增 `PipelineInstanceStore`（`get/set/delete/size/clear`，无 TTL/容量逻辑）；`TaskEngine` 构造注入 store，删除对 `api/tasks` 的 import；bootstrap 每个 Core 创建一个 store；`api/tasks.ts` 仅保留 HTTP handler，`pipelineMap` 与三个自由函数已删除。成功/失败/取消/drain 均由 `finally` 清理，双 engine/store 隔离测试覆盖。
>
> - [x] `rg 'pipelineMap|getPipeline\(|setPipeline\(|removePipeline\(' src --glob '!**/dist/**'` 为 0。
> - [x] TaskEngine 成功/失败/取消/drain 后 `store.size === 0`。
> - [x] 两个 TaskEngine + 两个 store 使用相同 taskId 时不共享 pipeline 实例。
> - [x] 目标测试：TaskEngine + instance-store 等 202 pass / 0 fail；全量结果见 H6。

---

### S11-D — TaskEngine 单循环 / 不可变 FlowState（15h）

#### S11-D1 — 新增 `Wakeup` 原语

- **复杂度**: 简单（1.5h）
- **目标**: 支持“先 notify 后 wait”不丢唤醒；`notify` 可重复、幂等。
- **文件**:
  - 新增 `packages/core/src/task/wakeup.ts`
  - 新增 `packages/core/src/task/wakeup.test.ts`
- **依赖**: 无
- **测试**: 先 wait 后 notify；先 notify 后 wait；多次 notify；等待中被唤醒。
- **行为风险**: 低；独立工具。
- **回滚**: revert 单 commit。
- **DoD**: 无 timer、无轮询；单测覆盖 4 种时序。

#### S11-D2 — TaskEngine 改为单循环

- **复杂度**: 中等（3h）
- **目标**: `start()` 启动一个 `#runLoop`；`Task.Enqueued` 仅 `wake.notify()`；删除递归 `#onTaskEnqueued`。
- **文件**:
  - `src/packages/core/src/task-engine.ts`
  - `src/packages/core/src/task-engine.test.ts`
- **依赖**: D1, C2
- **测试**: 顺序、串行、并发 enqueue、drain、start 幂等、stop 唤醒。
- **行为风险**: 高；调度核心。保持 `TaskQueue.dequeue` 规则与事件顺序。
- **回滚**: revert 单 commit；恢复旧 reentry。
- **DoD**: `maxProcessing === 1`；`#processing` 不再存在；现有 5 个 TaskEngine 测试全绿。

#### S11-D3 — 提取单任务执行器

- **复杂度**: 中等（3h）
- **目标**: 把 `#executeTask` 的 pipeline 解析/逐元素执行抽到可单测函数；TaskEngine 只负责调度与事件。
- **文件**:
  - 新增 `packages/core/src/task/task-runner.ts`
  - 新增 `packages/core/src/task/task-runner.test.ts`
  - `src/packages/core/src/task-engine.ts`
- **依赖**: D2
- **测试**: 无 pipeline 返回 complete；pipeline 逐元素；元素抛错；取消 signal。
- **行为风险**: 中；提取时保持 `{ mode: "initial", task }` 与返回值剥离 `abortSignal`。
- **回滚**: revert 单 commit；执行逻辑回内联。
- **DoD**: `task-runner.ts` 不依赖 TaskQueue/TaskEngine；TaskEngine 行数下降。

#### S11-D4 — FlowState 不可变

- **复杂度**: 简单（1h）
- **目标**: `element.process({ ...current, abortSignal })`；不修改上游对象。
- **文件**:
  - `packages/core/src/task/task-runner.ts`
  - `packages/core/src/task/task-runner.test.ts`
- **依赖**: D3
- **测试**: Element 收到新对象；原对象无 `abortSignal`；连续元素不共享引用。
- **行为风险**: 中；若有 Element 依赖对象身份/字段引用会暴露，测试兜底。
- **回滚**: revert 单 commit；恢复赋值。
- **DoD**: 输入对象在调用前后 `abortSignal` 均为 `undefined`；全量 pipeline 测试通过。

#### S11-D5 — 取消语义收敛

- **复杂度**: 中等（2.5h）
- **目标**: 取消 queued/processing 的逻辑集中到 helper；保持 `TaskCancelledError`、失败事件、store 清理。
- **文件**:
  - `src/packages/core/src/task-engine.ts`
  - `src/packages/core/src/task-engine.test.ts`
- **依赖**: D2
- **测试**: 同 session 同 chain 取消；跨 session 拒绝；queued 取消；processing 取消；unrelated 继续。
- **行为风险**: 中；取消路径涉及预算/链丢弃回调。
- **回滚**: revert 单 commit。
- **DoD**: 现有 4 个取消测试 + 新增跨 session 测试全绿；`discardChain` 调用次数不变。

#### S11-D6 — 生命周期/事件/ drain 对齐

- **复杂度**: 中等（3h）
- **目标**: 补齐 `start`/`stop`/`drain` 边界：重复 start、stop 后 drain、空队列、取消后 drain、loop 退出。
- **文件**:
  - `src/packages/core/src/task-engine.ts`
  - `src/packages/core/src/task-engine.test.ts`
- **依赖**: D2
- **测试**: Activated/Completed/Failed 顺序；`Pipeline.Result` 只在成功；drain 超时；stop 不 abort 当前任务。
- **行为风险**: 高；事件顺序是 WS/TUI 契约。先写失败测试。
- **回滚**: revert 单 commit。
- **DoD**: 事件序列快照与基线一致；`drain` 在 30s 超时返回 false 并停止。

#### S11-D7 — 删除旧重入代码与死字段

- **复杂度**: 简单（1h）
- **目标**: 删除 `#processing` / 旧 `#processNext` 残骸 / 未使用字段（保留 `#timeoutMs` 或单独记录）。
- **文件**:
  - `src/packages/core/src/task-engine.ts`
- **依赖**: D2..D6
- **测试**: 全量 TaskEngine 测试；`rg '#processing'` 为 0。
- **行为风险**: 低；纯清理。
- **回滚**: revert 单 commit。
- **DoD**: 单循环是唯一调度源；无递归调用。

---

### S11-E — ClientManager → ProcessSupervisor（20h）

> **实施状态**: 已完成（2026-11-12）。`ClientManager` 仅保留 facade；`ProcessSupervisor`、状态机、RestartPolicy、HealthProbe、runtime 注入与 fake 测试均已落地。健康失败现在与异常退出共用重启入口（发布说明需标注）。Gateway 路由/鉴权/状态码、公开 API、端口/secret、重启上限与退避保持不变。

#### S11-E1 — ClientManager 依赖可注入

- **复杂度**: 中等（2.5h）
- **目标**: 注入 `spawnProcess`、`fetch`、`now`、timer API；默认实现保持生产行为。
- **文件**:
  - `src/packages/gateway/src/client-manager/index.ts`
  - 新增 `packages/gateway/src/client-manager/runtime.ts`
  - 新增 `packages/gateway/src/client-manager/test-helpers.ts`
- **依赖**: 无
- **测试**: 默认路径 smoke（不启动真实进程）；fake runtime 下 start/stop 可控。
- **行为风险**: 中；构造签名变化，`server.ts` 调用需兼容。
- **回滚**: revert 单 commit；恢复直接 import。
- **DoD**: 生产默认值在 `runtime.ts` 一处；测试不依赖真实子进程。

#### S11-E2 — 纯进程状态机

- **复杂度**: 中等（3h）
- **目标**: 定义 `ProcessState`/`ProcessEvent` 与 `nextProcessState`；非法转移抛错或保持。
- **文件**:
  - 新增 `packages/gateway/src/client-manager/process-state.ts`
  - 新增 `packages/gateway/src/client-manager/process-state.test.ts`
- **依赖**: 无
- **测试**: idle→starting→running→stopping→idle；running→failed→starting；stop 后禁止 start；give_up。
- **行为风险**: 低；纯函数，未接线。
- **回滚**: revert 单 commit。
- **DoD**: 状态转移表完整；无 timer/IO。

#### S11-E3 — 提取 RestartPolicy

- **复杂度**: 简单（1.5h）
- **目标**: 集中最大次数/退避/重置；默认 5 次、1s*2^n、cap 30s。
- **文件**:
  - 新增 `packages/gateway/src/client-manager/restart-policy.ts`
  - 新增 `packages/gateway/src/client-manager/restart-policy.test.ts`
- **依赖**: 无
- **测试**: 第 1..5 次延迟；第 6 次 give_up；reset 后重新计数。
- **行为风险**: 低；纯函数。
- **回滚**: revert 单 commit。
- **DoD**: 常量只在 policy 内；现有 `MAX_RESTART_*` 可删除或引用。

#### S11-E4 — 提取 HealthProbe

- **复杂度**: 中等（2h）
- **目标**: 封装 `fetch(url, { signal: timeout })` 与结果归一；超时/非 2xx/网络错误均返回 unhealthy。
- **文件**:
  - 新增 `packages/gateway/src/client-manager/health-probe.ts`
  - 新增 `packages/gateway/src/client-manager/health-probe.test.ts`
- **依赖**: E1
- **测试**: 200 healthy；500 unhealthy；超时 unhealthy；网络错误 unhealthy。
- **行为风险**: 低；纯 helper。
- **回滚**: revert 单 commit。
- **DoD**: probe 不直接打日志/重启；只返回结果。

#### S11-E5 — ProcessSupervisor 核心（spawn/stop/readiness）

- **复杂度**: 中等（4h）
- **目标**: 每个 client 一个 supervisor；管理 spawn、secret/port 注册、readiness 轮询（100ms/10s）、优雅停止/SIGKILL、状态机。
- **文件**:
  - 新增 `packages/gateway/src/client-manager/process-supervisor.ts`
  - `src/packages/gateway/src/client-manager/index.ts`（内部委托）
  - `packages/gateway/src/client-manager/process-supervisor.test.ts`
- **依赖**: E1/E2/E3/E4
- **测试**: start→ready；spawn 失败；readiness 超时；stop 优雅；stop 强杀；重复 stop。
- **行为风险**: 高；进程生命周期。保持 `ProcessHandle` 语义、secret 注册时机、端口分配。
- **回滚**: revert 单 commit；ClientManager 仍可直接 spawn。
- **DoD**: supervisor 覆盖 `idle/starting/running/stopping/failed`；退出码/信号日志字段不变。

#### S11-E6 — 统一 restart 与健康检查

- **复杂度**: 中等（3.5h）
- **目标**: exit / health_failed / timer 都走 supervisor 的 `failed → starting`；删除 `#restarts` 分散逻辑。
- **文件**:
  - `packages/gateway/src/client-manager/process-supervisor.ts`
  - `src/packages/gateway/src/client-manager/index.ts`
  - `packages/gateway/src/client-manager/process-supervisor.test.ts`
- **依赖**: E5
- **测试**: 意外 exit 重启；健康失败重启；手动 stop 不重启；达到上限 give_up；stopAll 清 timer。
- **行为风险**: 高；新增健康重启。保持上限/退避/日志；只在 `desired && !stopping` 时重启。
- **回滚**: revert 单 commit；恢复健康只告警、exit 重启。
- **DoD**: 同一 client 任意时刻最多一个 timer/操作；`stopAll` 后无 spawn。

#### S11-E7 — ClientManager facade 与并发测试

- **复杂度**: 中等（3.5h）
- **目标**: `ClientManager` 只保留 `startAll/stopAll/start/stop/list/getBySecret/getById`；删除旧 Map/serialize；补并发测试。
- **文件**:
  - `src/packages/gateway/src/client-manager/index.ts`
  - `packages/gateway/src/client-manager/client-manager.test.ts`
  - `src/packages/gateway/src/server.ts`（如需适配构造）
- **依赖**: E6
- **测试**: start/stop 并发；stopAll 期间 exit；重复 start；unknown id；AggregateError。
- **行为风险**: 高；facade 签名必须不变。
- **回滚**: revert 单 commit；恢复旧 facade。
- **DoD**: 现有 Gateway 测试 + 新 ClientManager 测试全绿；`index.ts` 行数明显下降。

---

### S11-F — TUI ThemeContext 防回归（1h）

#### S11-F1 — Theme import 图 guard

- **复杂度**: 简单（1h）
- **目标**: 静态测试确保 `tui/src` 不从 `App` 导入 `useTheme`，`ThemeContext` 只在 `tui-kit`。
- **文件**:
  - 新增 `packages/tui/src/components/theme-imports.test.ts`
  - `src/packages/tui/src/components/App.tsx`（仅当发现残留时修）
- **依赖**: 无
- **测试**: 扫描 `src/packages/tui/src/**/*.{ts,tsx}`：非测试文件不得 `from "./App"` / `"../App"`；`useTheme` import 必须来自 `@atom-neo/tui-kit`。
- **行为风险**: 低；S5 已完成迁移，预期仅加测试。
- **回滚**: revert 单 commit。
- **DoD**: 测试通过；若失败，最小修复为把残留 `ThemeContext`/`useTheme` 移回 `tui-kit`，不扩大 TUI 重构。

> **实施状态（F1）**: 已完成（2026-11-12）。新增 `src/packages/tui/src/components/theme-imports.test.ts`，静态扫描 `tui/src` 非测试文件与 `tui-kit/src`，未发现残留 `useTheme`/`ThemeContext` 违规，因此未改动 TUI 实现。
>
> - [x] 非测试 TUI 文件不从 `App`（含任意相对路径）导入 `useTheme`/`ThemeContext`/`ThemeProvider`。
> - [x] `useTheme` import 只来自 `@atom-neo/tui-kit`，且每个 `useTheme()` 调用所在文件均有该 import。
> - [x] 17 个已知组件（AssistantMessage…UserMessage）的正向清单与扫描结果一致。
> - [x] `ThemeContext` 只在 `tui-kit/src/theme.tsx` 定义；`tui/src` 无引用。
> - [x] `tui-kit` 的 `package.json` 与源码均不依赖 `tui`。
> - [x] 目标测试 7 pass / 0 fail；TUI + tui-kit 测试 71 pass / 0 fail；TUI `typecheck` 通过。

---

### S11-G — Element 边界窄接口（14h）

#### S11-G1 — 新增 `PipelineSession` / `ElementTask`

- **复杂度**: 简单（2h）
- **目标**: 定义 Element 实际使用的 Session 能力；`ElementTask = TaskItem`；编译期验证 `SessionContext` 可赋值。
- **文件**:
  - 新增 `packages/core/src/session/element-session.ts`
  - 新增 `packages/core/src/session/element-session.test.ts`（类型测试）
- **依赖**: 无
- **测试**: `const s: PipelineSession = new SessionContext("x")` 编译通过；缺字段的对象编译失败（`@ts-expect-error`）。
- **行为风险**: 低；纯类型。
- **回滚**: revert 单 commit。
- **DoD**: 接口成员全部有真实 Element 调用依据；不复制 `SessionContext` 全量。

#### S11-G2 — Conversation pipeline 窄接口

- **复杂度**: 中等（3h）
- **目标**: `ConversationFlowState.task` → `ElementTask`；`session` → `PipelineSession`；conversation deps / 元素构造参数同步。
- **文件**:
  - `src/packages/core/src/pipelines/conversation/elements/types.ts`
  - `.../elements/collect-prompts.ts`
  - `.../elements/record-context.ts`
  - `.../elements/finalize.ts`
  - `.../elements/check-follow-up.ts`
  - `.../elements/stream-llm.ts`
  - `.../elements/apply-source-context.ts`
  - `src/packages/core/src/pipelines/conversation/index.ts`
- **依赖**: G1, A8
- **测试**: conversation 全量测试；stream-llm 边界测试；typecheck。
- **行为风险**: 中；`session` 方法/字段遗漏会编译失败；`memory` 保留到 G5。
- **回滚**: revert 单 commit；恢复 `any`。
- **DoD**: conversation 目录 `session: any` / `task: any` 为 0；`SessionContext` 直接传入。

#### S11-G3 — Prediction / decision 窄接口

- **复杂度**: 中等（2.5h）
- **目标**: `PredictionFlowState` 与 pipeline deps 的 `task/session` 改为 `ElementTask`/`PipelineSession`。
- **文件**:
  - `src/packages/core/src/pipelines/prediction/elements/types.ts`
  - `.../elements/predict-input.ts`
  - `.../elements/predict-finalize.ts`
  - `src/packages/core/src/pipelines/prediction/index.ts`
- **依赖**: G1, A9
- **测试**: prediction 测试；`predict-finalize` 预算/链测试。
- **行为风险**: 中；`pendingPrediction` setter 类型需保留。
- **回滚**: revert 单 commit。
- **DoD**: prediction 目录 `session/task: any` 为 0。

#### S11-G4 — Post-conversation / context-compress 窄接口

- **复杂度**: 中等（2.5h）
- **目标**: 两个 pipeline 的 FlowState/deps/元素构造参数改为窄类型；`compress` 可变字段保留。
- **文件**:
  - `src/packages/core/src/pipelines/post-conversation/elements/types.ts`
  - `.../post-conversation/elements/collect-input.ts`
  - `src/packages/core/src/pipelines/post-conversation/index.ts`
  - `src/packages/core/src/pipelines/context-compress/elements/types.ts`
  - `.../context-compress/elements/compress-input.ts`
  - `.../context-compress/elements/compress-finalize.ts`
  - `src/packages/core/src/pipelines/context-compress/index.ts`
- **依赖**: G1, A10
- **测试**: post/compress 测试；stall 百分比测试（CR-COR-08）；压缩预算。
- **行为风险**: 中；`compressRetry/compressRatio/compressing` 必须是可写。
- **回滚**: revert 单 commit。
- **DoD**: 两目录 `session/task: any` 为 0；`#estimateContextTokens` 内部 `any` 不强制清理（S12）。

#### S11-G5 — Follow-up / evaluator / shared 元素窄接口

- **复杂度**: 中等（2.5h）
- **目标**: follow-up/evaluator deps 与元素 `task/session`、shared `token-ratio`/`check-follow-up` 的 `session`、`memory` 使用窄类型。
- **文件**:
  - `src/packages/core/src/pipelines/follow-up/index.ts`
  - `src/packages/core/src/pipelines/follow-up-evaluator/elements/types.ts`
  - `.../follow-up-evaluator/elements/evaluator-input.ts`
  - `src/packages/core/src/pipelines/follow-up-evaluator/index.ts`
  - `src/packages/core/src/pipelines/shared/token-ratio.ts`
  - `src/packages/core/src/tools/builtin/intent.ts`
- **依赖**: G1
- **测试**: evaluator/follow-up 测试；token-ratio 单测；memory retain 单测。
- **行为风险**: 中；`MemoryServiceLike` 需覆盖 `retain/findFullId/has`。
- **回滚**: revert 单 commit。
- **DoD**: `pipelines/**` 的 `session/task: any` 为 0；`memory` 在 Element 构造参数中有类型。

#### S11-G6 — 残留检查与类型测试

- **复杂度**: 简单（1.5h）
- **目标**: 确认 `pipelines/**` 的 48 处 `session/task/memory: any` 已处理到约定范围；补编译测试防止回退。
- **文件**:
  - `packages/core/src/session/element-session.test.ts`
  - `src/packages/core/src/pipelines/*/elements/types.ts`（如需）
- **依赖**: G2..G5
- **测试**: `rg 'session\\??\\s*:\\s*any|task\\??\\s*:\\s*any' src/packages/core/src/pipelines --glob '!**/*.test.*'` 为 0；typecheck。
- **行为风险**: 低；纯检查。
- **回滚**: revert 单 commit。
- **DoD**: 残留检查通过；全量 pipeline 测试通过；不触碰 `stream-llm` 内部 `as any`。

---

### S11-H — 双实例验收 / 清理 / 文档（15.5h）

#### S11-H1 — 两个 `startCore` 同进程并行

- **复杂度**: 中等（3.5h）
- **目标**: 两个 sandbox、两个 fake runtime、两个端口同时启动；各自 health/attach/任务/停止互不影响。
- **文件**:
  - 新增 `packages/core/src/server-dual-instance.test.ts`
  - 复用 `pipelines/test-helpers.ts`
- **依赖**: A5/B7/C3/D6
- **测试**: 两个 health 200；两个 registry 元素互不冲突；两个 store 隔离；分别 stop 不互杀。
- **行为风险**: 高；会暴露隐藏全局（env/cwd/timer）。
- **回滚**: revert 测试 commit；不影响生产。
- **DoD**: 测试通过；若失败，记录到对应任务并修复（不在测试里 `skip`）。

#### S11-H2 — 双 registry / prompt / store 隔离

- **复杂度**: 简单（1.5h）
- **目标**: 单元级验证三组实例的隔离与独立清理。
- **文件**:
  - `src/packages/core/src/pipeline/registry.test.ts`
  - `src/packages/shared/src/prompts/prompts.test.ts`
  - `packages/core/src/pipeline/instance-store.test.ts`
- **依赖**: A11/B7/C3
- **测试**: 同名元素分别注册；不同 refinement 输出不同；store key 相同但实例不同。
- **行为风险**: 低。
- **回滚**: revert 测试 commit。
- **DoD**: 三组测试均通过；无 `clearRegistry` 全局清理。

#### S11-H3 — TaskEngine 排序/取消/预算/链矩阵

- **复杂度**: 中等（2.5h）
- **目标**: 覆盖 active/waiting 优先级、同优先级、取消链、drain、Task.Completed 预算回滚、conversation chain。
- **文件**:
  - `src/packages/core/src/task-engine.test.ts`
  - `src/packages/core/src/task-lifecycle.test.ts`
- **依赖**: D7
- **测试**: 现有 5 个 + 新增优先级/链/回滚用例；事件顺序断言。
- **行为风险**: 中；只加测试，不改生产。
- **回滚**: revert 测试 commit。
- **DoD**: 矩阵全覆盖；`bun test` 0 fail。

#### S11-H4 — ProcessSupervisor 状态/重启矩阵

- **复杂度**: 中等（2.5h）
- **目标**: 覆盖所有状态转移、重启上限、退避、健康触发、stopAll 竞争。
- **文件**:
  - `packages/gateway/src/client-manager/process-state.test.ts`
  - `.../restart-policy.test.ts`
  - `.../process-supervisor.test.ts`
  - `.../client-manager.test.ts`
- **依赖**: E7
- **测试**: 状态表逐项；fake timer 推进；exit/health/stop 竞争。
- **行为风险**: 中；测试只使用 fake spawn/probe。
- **回滚**: revert 测试 commit。
- **DoD**: 无真实子进程；无未清理 timer（测试结束检查）。

#### S11-H5 — 全局残留 / Theme import 图 guard

- **复杂度**: 简单（1h）
- **目标**: 静态检查生产代码无旧全局符号；Theme import 图无环。
- **文件**:
  - 新增 `packages/core/src/global-state-guard.test.ts`
  - `packages/tui/src/components/theme-imports.test.ts`
- **依赖**: F1, A11/B7/C3
- **测试**: `rg` 等价断言：`pipelineMap`、`clearRegistry`、`getRegistry(`、`initPromptRegistry(`、`let _instance` 为 0；`tui` 不从 `App` 导入 `useTheme`。
- **行为风险**: 低；静态测试。
- **回滚**: revert 测试 commit。
- **DoD**: guard 测试通过；白名单为空（测试文件除外）。

#### S11-H6 — 全量 Bun/Node 回归

- **复杂度**: 中等（2.5h）
- **目标**: 跑全量测试、构建、Node smoke、package smoke，记录基线/最终数字。
- **文件**:
  - 不改源码；更新 PR 描述/计划文档
- **依赖**: H1..H5
- **测试**: `typecheck`、`typecheck:node`、`bun test`、`build`、`smoke:node`、`smoke:node:package`、`docs:check`、`docs:typecheck`。
- **行为风险**: 中；Node 路径可能暴露新的模块级 import。
- **回滚**: 无源码改动；若失败，回到对应任务修复。
- **DoD**: 全部命令通过；记录 pass/skip/fail 与构建体积。

#### S11-H7 — 文档与过渡代码清理

- **复杂度**: 中等（2h）
- **目标**: 更新 DI/启动/项目结构文档；删除所有过渡包装；更新计划进度。
- **文件**:
  - `docs/standards/dependency-injection.md`
  - `docs/overview/bootstrap.md`
  - `docs/overview/project-structure.md`
  - `docs/index.md`
  - `docs/code-review-2026-11-10/code-review-plan-2026-11-10.md`
  - `src/packages/core/src/index.ts`（残留导出）
- **依赖**: H6
- **测试**: `docs:check` / `docs:typecheck`；`rg` 过渡符号为 0。
- **行为风险**: 低；纯文档/导出清理。
- **回滚**: revert 单 commit。
- **DoD**: 文档与代码一致；`dependency-injection.md` 的构造链更新为当前实现；S11 进度标记完成（实施阶段执行）。

---

## 5. 任务规模表（S/M）

> S = 简单（≤2h），M = 中等（2–4h）。合计 110h。

| ID | 任务 | 规模 | 工时 | 依赖 |
|---|---|---|---:|---|
| A1 | CoreServices 契约 | S | 2 | — |
| A2 | resolveCoreServices | S | 2 | A1 |
| A3 | bootstrap 改用 services | M | 3 | A2 |
| A4 | startCore/main 显式 services | M | 3 | A3 |
| A5 | 删除 sm | S | 2 | A4 |
| A6 | createPromptRegistry | S | 1.5 | — |
| A7 | PromptResolver | S | 1.5 | A6 |
| A8 | conversation prompt DI | M | 3 | A7 |
| A9 | prediction/decision prompt DI | M | 2.5 | A7 |
| A10 | evaluator/post/shared prompt DI | M | 2.5 | A7 |
| A11 | 删除 prompt 单例 | M | 2.5 | A8-A10 |
| B1 | ElementRegistry 类 | S | 2 | — |
| B2 | legacy 包装 | S | 1 | B1 |
| B3 | conversation/shared 注册 | M | 2.5 | B2 |
| B4 | 其余注册函数 | S | 2 | B2 |
| B5 | Builder/Pipeline 接收 registry | M | 2.5 | B2 |
| B6 | 穿透 factory + 6 pipeline | M | 3 | B5 |
| B7 | 删除 legacy registry | M | 2 | B6 |
| C1 | PipelineInstanceStore | S | 1.5 | — |
| C2 | TaskEngine 注入 store | S | 1.5 | C1,B7 |
| C3 | 删除 pipelineMap | S | 1 | C2 |
| D1 | Wakeup | S | 1.5 | — |
| D2 | TaskEngine 单循环 | M | 3 | D1,C2 |
| D3 | 提取 task-runner | M | 3 | D2 |
| D4 | FlowState 不可变 | S | 1 | D3 |
| D5 | 取消语义收敛 | M | 2.5 | D2 |
| D6 | 生命周期/事件/drain | M | 3 | D2 |
| D7 | 删除旧重入 | S | 1 | D2-D6 |
| E1 | ClientManager 依赖注入 | M | 2.5 | — |
| E2 | 进程状态机 | M | 3 | — |
| E3 | RestartPolicy | S | 1.5 | — |
| E4 | HealthProbe | M | 2 | E1 |
| E5 | ProcessSupervisor 核心 | M | 4 | E1-E4 |
| E6 | 统一 restart/health | M | 3.5 | E5 |
| E7 | ClientManager facade | M | 3.5 | E6 |
| F1 | Theme import guard | S | 1 | — |
| G1 | PipelineSession 契约 | S | 2 | — |
| G2 | conversation 窄接口 | M | 3 | G1,A8 |
| G3 | prediction 窄接口 | M | 2.5 | G1,A9 |
| G4 | post/compress 窄接口 | M | 2.5 | G1,A10 |
| G5 | follow-up/evaluator/shared 窄接口 | M | 2.5 | G1 |
| G6 | 残留检查 | S | 1.5 | G2-G5 |
| H1 | 两个 startCore | M | 3.5 | A5,B7,C3,D6 |
| H2 | 双 registry/prompt/store | S | 1.5 | A11,B7,C3 |
| H3 | TaskEngine 矩阵 | M | 2.5 | D7 |
| H4 | Supervisor 矩阵 | M | 2.5 | E7 |
| H5 | 全局残留 guard | S | 1 | F1,A11,B7,C3 |
| H6 | Bun/Node 全量回归 | M | 2.5 | H1-H5 |
| H7 | 文档/清理 | M | 2 | H6 |
| **合计** | **49 个任务** | **20 S / 29 M** | **110h** | |

### 按阶段汇总

| 阶段 | S | M | 工时 | 占比 |
|---|---:|---:|---:|---:|
| A | 5 | 6 | 25.5h | 23% |
| B | 3 | 4 | 15h | 14% |
| C | 3 | 0 | 4h | 4% |
| D | 3 | 4 | 15h | 14% |
| E | 1 | 6 | 20h | 18% |
| F | 1 | 0 | 1h | 1% |
| G | 2 | 4 | 14h | 13% |
| H | 2 | 5 | 15.5h | 14% |
| **合计** | **20** | **29** | **110h** | **100%** |

---

## 6. 测试矩阵

### 基线（`ef7ff15`）

| 项 | 基线 |
|---|---|
| `bun run typecheck` | 6/6 |
| `bun run typecheck:node` | 0 error |
| `bun test --path-ignore-patterns='**/dist/**'` | 1001 pass / 21 skip / 0 fail |
| `bun test` | 1781 pass / 21 skip / 0 fail |
| `bun run build` | 6/6 |
| `bun run smoke:node` | build check 5/5 + platform 15/15 + release 9/9 + conversation 11/11 |
| `bun run smoke:node:package` | 11/11 |
| `docs:check` / `docs:typecheck` | 通过 |

> 基线来自 S10-B2 实施记录；S11 每个任务完成后至少跑目标测试，H6 跑全量并记录最终数字。

| 场景 | 阶段 | 测试文件 | 断言 |
|---|---|---|---|
| 两个 `startCore` 并行 | H1 | `server-dual-instance.test.ts` | 两个 health 200；任务/停止互不影响 |
| 两个 `ElementRegistry` | B7/H2 | `pipeline/registry.test.ts` | 同名注册不冲突；names 独立 |
| 两个 `PromptRegistry` | A11/H2 | `prompts/prompts.test.ts` | 不同 refinement 输出不同；缓存独立 |
| 两个 `PipelineInstanceStore` | C3/H2 | `pipeline/instance-store.test.ts` | 相同 taskId 不串 |
| TaskEngine 顺序 | D2/D6 | `task-engine.test.ts` | active 优先；同优先级最新；maxProcessing=1 |
| TaskEngine 取消 | D5 | `task-engine.test.ts` | 同 session/chain；跨 session 拒绝；queued+processing |
| TaskEngine drain | D6 | `task-engine.test.ts` | 空队列 true；超时 false；stop |
| 预算/检查点回滚 | H3 | `task-lifecycle.test.ts` | 消息/token/预算回滚一致 |
| conversation chain | H3 | `server-continuation.test.ts` | reconcile/continue/post-check 顺序 |
| FlowState 不可变 | D4 | `task/task-runner.test.ts` | 输入对象无 abortSignal；新对象 |
| Supervisor 状态 | E2/E7 | `process-state.test.ts` | 全部合法转移；非法拒绝 |
| 重启策略 | E3/E6 | `restart-policy.test.ts` | 5 次上限；退避；reset |
| 健康检查 | E4/E6 | `health-probe.test.ts` | 200/500/超时/网络错误 |
| ClientManager 并发 | E7 | `client-manager.test.ts` | start/stop/exit 竞争；stopAll 不复活 |
| Theme import 图 | F1/H5 | `theme-imports.test.ts` | 不 import App；useTheme 只来自 tui-kit |
| Element 窄接口 | G1-G6 | `element-session.test.ts` + pipeline tests | SessionContext 可赋值；pipeline 行为不变 |
| Bun 全量 | H6 | `bun test` | 0 fail；记录 pass/skip |
| Node 构建/入口 | H6 | `typecheck:node` / `smoke:node` | 0 error；smoke 全 PASS |
| Node 发布包 | H6 | `smoke:node:package` | tarball 安装/CLI/Core health |
| 文档 | H7 | `docs:check` / `docs:typecheck` | 链接与类型通过 |

### 双实例验收细节

1. **端口**：两个 `startCore` 都用 `port: 0`，断言返回不同真实端口。
2. **sandbox**：两个 `mkdtempSync` 目录；session 文件不共享。
3. **runtime**：两个 fake `RuntimeLike`，不同 model/日志；不读 `process.env`。
4. **registry**：两个实例都注册同名 5 条 pipeline；不出现 `already registered`。
5. **prompt**：两个 registry 注册不同 refinement；同一 key 输出不同。
6. **store**：两个 store 各自 `set/get/delete`；相同 taskId 不串。
7. **stop**：先停 A，B 仍可 health/提交；再停 B。
8. **清理**：两个 sandbox 删除；无 timer 泄漏（`Bun`/Node 进程可退出）。

---

## 7. 回滚矩阵

| 阶段 | 主要风险 | 回滚方式 | 回滚点 |
|---|---|---|---|
| A | 服务缺失/构造顺序 | 恢复 `sm.get` 与 prompt 单例 | A3/A5/A11 单 commit |
| B | 注册遗漏/重复 | 恢复 legacy registry 默认参数 | B6/B7 单 commit |
| C | pipeline 缓存泄漏 | 恢复 `api/tasks` 全局 Map | C2/C3 单 commit |
| D | 调度顺序/取消 | 恢复事件重入 + 变异 FlowState | D2/D5/D6 单 commit |
| E | 进程重启/健康抖动 | 恢复旧 ClientManager 并发；健康只告警 | E5/E6/E7 单 commit |
| F | 无运行时风险 | 删除 guard 测试 | F1 |
| G | 类型不兼容 | 恢复对应 Element 的 `any` | G2-G5 按 pipeline revert |
| H | 测试/文档 | 只回退测试/文档 | H1-H7 |

### 回滚原则

- 按子阶段 commit；回滚从后往前，不依赖后续阶段。
- A/B/C 的过渡包装是行为回滚点；删除包装的 commit（A5/A11/B7/C3）单独 revert 即可恢复旧路径。
- D 的回滚必须同时还原 TaskEngine 与 C2 的 store 注入；建议 D 的 commit 不混合 C 的清理。
- E 的回滚保留 `ClientManager` 签名，只恢复内部实现；`server.ts` 不应依赖 supervisor。
- G 是类型层，回滚不影响运行时，但必须恢复 `as any` 才可通过 typecheck；按 pipeline 独立 revert。
- H 不回退生产代码；若 H1 失败，回到对应 A/B/C/D 任务修复，而不是在 H 加白名单。

---

## 8. Definition of Done

### 每个任务

- [ ] 实现 + 测试同 commit。
- [ ] 目标测试通过；无新增 skip/only。
- [ ] `bun run typecheck` 通过（相关包）。
- [ ] 行为风险已在 commit message 记录。
- [ ] 回滚命令明确（revert commit / 恢复字段）。
- [ ] 不新增模块级可变状态。
- [ ] 不修改禁区代码。

### S11 整体

- [ ] CR-ARCH-01/02/03/06/08/09 全部关闭。
- [ ] CR-ARCH-04/05 有防回归测试；无重新引入。
- [ ] CR-ARCH-07 的 Element 边界范围完成；全量 any 明确留给 S12。
- [ ] 两个 `startCore` 双实例测试通过。
- [ ] `bun run typecheck` 6/6、`typecheck:node` 0 error。
- [ ] `bun test --path-ignore-patterns='**/dist/**'` 0 fail。
- [ ] `bun test` 0 fail（允许既有 dist 副本）。
- [ ] `bun run build` 6/6。
- [ ] `bun run smoke:node`、`smoke:node:package` 通过。
- [ ] `docs:check` / `docs:typecheck` 通过。
- [ ] 残留检查通过（见第 11 节）。
- [ ] 文档：`dependency-injection.md`、`bootstrap.md`、`project-structure.md`、`index.md`、计划进度表同步。
- [ ] 版本 bump 与发布说明（Gateway 健康重启需标注）。

---

## 9. 估算与关键路径

### 总量

- **49 个任务**：20 个简单 + 29 个中等。
- **基线估算 110h ≈ 13.75 工程师日**。
- **关键路径 89h ≈ 11.1 工程师日**（A→B→C→D→G→H；E 并行）。
- **建议排期 14–16 工程师日**（含 10–15% 联调/Review 缓冲）。
- **两人并行**（Core + Gateway）：10–12 日历日（按 8h/日，含联调）。

### 为什么不是 5–8 天

原计划的 5–8 天大致只覆盖：

- A 的 Services/Prompt 主路径（25.5h）。
- B 的 registry（15h）。
- C 的 store（4h）。

合计 44.5h ≈ 5.6 天，尚未包含：

- TaskEngine 单循环与兼容测试（15h）。
- ProcessSupervisor 与并发测试（20h）。
- Element 窄接口（14h）。
- 双实例验收、全量回归、文档（15.5h）。

因此 5–8 天只能得到“能编译的中间态”，无法满足 S11 的 DoD。建议按 14–16 工程师日排期，或明确把 E/G/H 推迟到 S11b（不推荐，会留下半初始化状态）。

### 关键路径

```text
A1 → A2 → A3 → A4 → A5
  → B1 → B2 → B5 → B6 → B7
  → C1 → C2 → C3
  → D1 → D2 → D3 → D4 → D6 → D7
  → G1 → G2..G5 → G6
  → H1 → H6 → H7
```

并行轨道：

```text
E1 → E2/E3/E4 → E5 → E6 → E7 → H4
F1 → H5
B3/B4 可在 B2 后与 B5 并行（不同文件）
```

### 建议 PR 拆分

| PR | 内容 | 预估 |
|---|---|---:|
| PR-S11-1 | A1–A5（Services） | 12h |
| PR-S11-2 | A6–A11（Prompt） | 13.5h |
| PR-S11-3 | B1–B7（Registry） | 15h |
| PR-S11-4 | C1–C3（Store） | 4h |
| PR-S11-5 | D1–D7（TaskEngine） | 15h |
| PR-S11-6 | E1–E7（Supervisor） | 20h |
| PR-S11-7 | F1 + G1–G6（Theme + 窄接口） | 15h |
| PR-S11-8 | H1–H7（验收/文档） | 15.5h |

> 每个 PR 内仍按任务单 commit；PR 只用于评审分组，不作为回滚单位。

---

## 10. 实施顺序与提交建议

### 第 1 周（Core 主路径）

```text
A1..A5  Services
A6..A11 Prompt
B1..B7  ElementRegistry
```

### 第 2 周（Core 执行 + Gateway 并行）

```text
C1..C3  PipelineInstanceStore
D1..D7  TaskEngine
E1..E7  ProcessSupervisor（第二人）
F1      Theme guard
```

### 第 3 周（窄接口 + 验收）

```text
G1..G6  Element 窄接口
H1..H7  双实例/全量/文档
```

### Commit message 建议

```text
refactor(core): add typed CoreServices contract (S11-A1)
refactor(core): inject CoreServices into bootstrap (S11-A3)
refactor(prompts): add createPromptRegistry factory (S11-A6)
refactor(prompts): inject resolver into conversation pipeline (S11-A8)
refactor(prompts): remove prompt singleton (S11-A11)
refactor(pipeline): add ElementRegistry instance (S11-B1)
refactor(pipeline): thread ElementRegistry through factory (S11-B6)
refactor(pipeline): remove global element registry (S11-B7)
refactor(task): add PipelineInstanceStore (S11-C1)
refactor(task): inject PipelineInstanceStore into TaskEngine (S11-C2)
refactor(task): replace TaskEngine reentry with wake loop (S11-D2)
refactor(task): make pipeline FlowState immutable (S11-D4)
feat(gateway): add ProcessSupervisor state machine (S11-E5)
feat(gateway): route health failures through restart policy (S11-E6)
test(tui): guard theme import graph (S11-F1)
refactor(core): add narrow PipelineSession interface (S11-G1)
test(core): add dual startCore acceptance (S11-H1)
docs: close S11 (S11-H7)
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

# 残留检查（S11 完成后）
rg -n 'pipelineMap|clearRegistry|getRegistry\\(|initPromptRegistry\\(' src --glob '!**/*.test.*' --glob '!**/dist/**'
# 期望：0

rg -n 'sm\\.get\\(' src/packages/core/src --glob '!**/*.test.*'
# 期望：0

rg -n 'session\\??\\s*:\\s*any|task\\??\\s*:\\s*any' src/packages/core/src/pipelines --glob '!**/*.test.*'
# 期望：0

rg -n 'from "\\.\\./App"|from "\\./App"' src/packages/tui/src --glob '!**/*.test.*'
# 期望：0

rg -n 'let _instance|const pipelineMap|const registry = new Map' src/packages --glob '!**/*.test.*'
# 期望：0（S11 目标全局符号）
```

---

## 12. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-11-12 | 初始 S11 实施计划：拆分 A–H 共 49 个任务（20 简单 / 29 中等），基线 110h，关键路径 89h；给出测试矩阵、回滚矩阵、DoD、PR 拆分与验收命令；仅文档，未改源码 |
| 2026-11-12 | S11-E 实施：新增 `client-manager/{runtime,process-state,restart-policy,health-probe,process-supervisor,test-helpers}.ts`，`ClientManager` 改为 facade；新增 5 个测试文件。Gateway 源码测试 7 → 44；健康失败进入统一重启路径 |
| 2026-11-12 | S11-A6–A11 实施：新增 `createPromptRegistry()` / `PromptResolver` / `createPromptResolver()`；删除 prompt 单例与旧导出；6 条 pipeline、`chooseDecision`、`callLLM`、JEV 模拟全部显式注入 resolver；`prompts.test.ts` 增加双 registry 隔离与逐字一致测试。shared + core 663 pass；全量 1874 pass / 21 skip / 0 fail |
| 2026-11-12 | S11-B1–B7 实施：新增 `ElementRegistry` / `createElementRegistry()`；7 个注册函数、`PipelineBuilder` / `pipeline()`、pipeline factory 与 bootstrap 全部显式透传 registry；删除模块级 registry 与旧自由函数。`registry.test.ts` 增加双实例同名隔离；`server-continuation` 移除全局表保存/恢复 |
| 2026-11-12 | S11-C1–C3 实施：新增 `PipelineInstanceStore` 并注入 `TaskEngine`；删除 `api/tasks.ts` 的 `pipelineMap` 与三个自由函数；成功/失败/取消/drain 清理与双 store 隔离测试补齐。源码 1066 pass / 21 skip / 0 fail；全量 1902 pass / 21 skip / 0 fail |
