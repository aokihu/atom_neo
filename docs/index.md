# Atom Neo — Documentation Index

> **用途**: 开发文档导航。AI Agent 开发时按需查阅对应文档。

文档以 Markdown 为唯一来源；Web 页面由 `docs/server.ts` 在请求时渲染（`bun run docs`），不再维护独立 HTML/JSX 页面。

---

## 总览

| 文档 | 说明 | 何时 |
|------|------|------|
| [architecture.md](./overview/architecture.md) | 系统架构总览 | 开始前必读 |
| [project-structure.md](./overview/project-structure.md) | 完整目录树、包结构、依赖图 | 创建文件/目录 |
| [bootstrap.md](./overview/bootstrap.md) | 启动序列、初始化顺序 | 理解启动流程 |
| [startup-menu.md](./subsystems/startup-menu.md) | 一次性分层启动向导、参数记忆、执行交接及远程 attach | 修改 menu 子命令 |
| [development-setup.md](./overview/development-setup.md) | 开发环境搭建、依赖升级基线 — clone → 安装 → 升级 → 验证 | 第一天 / 升级依赖 |

## 开发规范（编码时必查）

| 文档 | 说明 | 何时 |
|------|------|------|
| [coding.md](./standards/coding.md) | 代码风格、命名规则、类型约定 (三合一) | 写任何代码 |
| [testing.md](./standards/testing.md) | 测试规范、覆盖率要求 | 写测试 |
| [dependency-injection.md](./standards/dependency-injection.md) | 对象如何构造和注入 | 实现新类 |

## 子系统设计（实现功能时查）

| 文档 | 说明 | 何时 |
|------|------|------|
| [pipeline-dev.md](./core/pipeline-dev.md) | Element 接口、Pipeline Builder DSL、Event Bus (三合一) | 创建 Element/Pipeline |
| [tool-plugin.md](./subsystems/tool-plugin.md) | Tool 插件接口 | 创建 Tool |
| [session.md](./core/session.md) | Per-Session 状态、目录持久化、Context 恢复、TUI 默认新建及 -c/--continue | 操作会话 |
| [context-management.md](./context-management.md) | Context 六层所有权、Snapshot、Receipt、自动卸载与预算 | 修改 Context 注入或生命周期 |
| [context-outcome-governance.md](./context-outcome-governance.md) | Tool Result、跨轮 Context、Prediction、Post 与 Compact 的防污染治理 | 修改工具结果或上下文消费链 |
| [memory-service.md](./subsystems/memory-service.md) | 记忆图 Schema、API、遍历算法 | 实现 Memory |
| [network-service.md](./subsystems/network-service.md) | 同进程网络 Service、WebFetch 子功能与域名调度 | 修改网络能力 |
| [configuration.md](./subsystems/configuration.md) | 配置加载优先级、双层架构（用户配置 + 运行时 overlay）、TUI 专属调整 API | 添加配置项 |
| [backup.md](./subsystems/backup.md) | 配置导出/导入 — `.atombak` 归档、gzip、可选 AES-256-GCM、`.env` merge | 备份或迁移 sandbox 配置 |
| [jev-decisions.md](./subsystems/jev-decisions.md) | Jev 独立调用模块、配置、回退与验收 | 接入结构化决策模型 |
| [task-execution.md](./core/task-execution.md) | 双队列系统 + TaskEngine 状态机 (queue + runloop 合并) | 理解任务调度/生命周期 |
| [sandbox.md](./subsystems/sandbox.md) | Sandbox 隔离规则 + 运行时目录结构 | 理解工作目录 |
| [first-run-wizard.md](./subsystems/first-run-wizard.md) | 首次运行向导 + `--config` 配置编辑器（OpenTUI 窗口化、按 provider 循环、原子回滚） | 实现首次启动流程/配置编辑 |
| [tui-interface.md](./tui-interface.md) | eDEX 风格 OpenTUI 布局、工具调用背景提示与参数摘要、ROUNDS 预算、TODO 滚动跟随与响应式约束 | 修改 TUI 界面 |
| [tui-modal.md](./tui-modal.md) | TUI 通用 Modal 组件 — 标题/内容/ActionBar + 键盘导航 + 定位 | 实现 TUI 浮层/确认框 |
| [future-features.md](./future-features.md) | 已设计但未实现的功能清单 | 设计时查，避免遗忘 |

## Pipeline 管线

| 文档 | 说明 | 何时 |
|------|------|------|
| [pipelines/conversation.md](./pipelines/conversation.md) | 核心对话管线 — 8-Element 链、手工 Tool Loop、流式生成、链式续写、TODO 顺序执行、Unicode 净化 | 理解核心流程 |
| [pipelines/prediction.md](./pipelines/prediction.md) | 意图预测管线 — 输入分类、难度评估、主题检测 | 理解意图分析 |
| [pipelines/follow-up-evaluator.md](./pipelines/follow-up-evaluator.md) | 跟进评估管线 — 长会话质量保障、循环检测 | 理解质量守护 |
| [pipelines/follow-up.md](./pipelines/follow-up.md) | 链式续写管线 — 轻量 source/sink 转换、continuation payload 注入 | 理解链式续写 |
| [pipelines/context-compress.md](./pipelines/context-compress.md) | 上下文压缩管线 — 可靠 JSONL 归档、累计摘要与恢复 | 理解压缩机制 |
| [pipelines/post-conversation.md](./pipelines/post-conversation.md) | 对话后分析管线 — 每轮后分析回复质量，判定是否重试 | 理解质量判定 |
| [pipelines/prompts.md](./pipelines/prompts.md) | Prompt Registry — 多语言提示词统一管理、模型精细化追加、输出安全 | 修改提示词 |

## 通信

| 文档 | 说明 | 何时 |
|------|------|------|
| [gateway.md](./communication/gateway.md) | Gateway 平台 Client 中转层 — 子进程管理 + Secret 鉴权 + 消息路由 | 理解外部平台集成 |
| [clients/telegram-bot.md](./clients/telegram-bot.md) | Telegram Bot Client 实现 — 长轮询/Webhook 双模式 + 消息分片 + 限流退避 | 接入 Telegram |
| [protocol.md](./communication/protocol.md) | WebSocket 事件协议 | 通信层 |
| [error-handling.md](./communication/error-handling.md) | 错误跨层传播模型 — Element → Pipeline → TaskEngine → Client | 写 try/catch |

## 服务

| 文档 | 说明 | 何时 |
|------|------|------|
| [agents-compiler.md](./subsystems/agents-compiler.md) | AGENTS.md 安全编译器 — LLM 无害化过滤 + SHA-256 缓存 | 理解安全过滤机制 |
| [skill-system.md](./subsystems/skill-system.md) | 可插拔 AI Agent 技能系统 — 三层加载、分段注入、自主卸载 | 实现 skill 功能 |

双层执行预算：[窗口健康检查](pipelines/follow-up-evaluator.md)、[验收记录](records/continuation-validation.md)。

## 历史记录

以下文档是验收、实验与历史计划记录，**不是当前设计依据**；状态与路径可能过时。

| 文档 | 说明 |
|------|------|
| [records/README.md](./records/README.md) | 历史记录目录说明与使用约定 |
| [records/startup-validation.md](./records/startup-validation.md) | 启动模式早期验收记录（常规测试与隔离进程测试） |
| [records/startup-modes-plan.md](./records/startup-modes-plan.md) | 启动模式、TUI attach 与 Client 控制的实施计划 |
| [records/context-snapshot-cache-plan.md](./records/context-snapshot-cache-plan.md) | Context 缓存方案与 Token 小样本实验 |
| [records/continuation-validation.md](./records/continuation-validation.md) | 统一续写仲裁首次验收与已知限制 |
| [records/progress-evidence-experiment.md](./records/progress-evidence-experiment.md) | Post/续写跟踪参数对照实验与最终选择 |
| [records/code-review-telegram-bot.md](./records/code-review-telegram-bot.md) | Telegram Bot Client 历史代码审查报告 |
| [records/startup-implementation-notes.md](./records/startup-implementation-notes.md) | 启动实现进度、设计记录与改造前基线 |
| [records/startup-menu-changelog.md](./records/startup-menu-changelog.md) | Startup Menu 历史版本变更 |
| [records/context-outcome-governance-plan.md](./records/context-outcome-governance-plan.md) | Tool Result / Context 治理实施阶段与完成标准 |
| [records/skill-system-plan.md](./records/skill-system-plan.md) | Skill System 历史开发计划与测试拆分 |

## 代码审查

| 文档 | 说明 | 何时 |
|------|------|------|
| [code-review-2026-11-10.md](./code-review-2026-11-10/code-review-2026-11-10.md) | 全量代码审查：问题 ID、文件位置、当前/目标代码片段、验收标准 | 实施整改前必读 |
| [code-review-graph-2026-11-10.md](./code-review-2026-11-10/code-review-graph-2026-11-10.md) | 审查关系图：包依赖、运行时流程、重复源、Provider、Node 运行时、阶段依赖 | 理解影响面 |
| [code-review-plan-2026-11-10.md](./code-review-2026-11-10/code-review-plan-2026-11-10.md) | 整改计划：S0–S12 阶段、风险、依赖、验收与进度追踪 | 按阶段实施 |
| [code-review-s9-2026-11-11.md](./code-review-2026-11-10/code-review-s9-2026-11-11.md) | S9 专项审查：HTTP/WS 运行时问题、Bun/Node 契约、代码片段与验收 | 实施 S9 前必读 |
| [code-review-s9-graph-2026-11-11.md](./code-review-2026-11-10/code-review-s9-graph-2026-11-11.md) | S9 关系图：请求/升级生命周期、双 adapter、阶段依赖、风险热区 | 理解 S9 影响面 |
| [code-review-s9-plan-2026-11-11.md](./code-review-2026-11-10/code-review-s9-plan-2026-11-11.md) | S9 实施计划：S9-A..E、spike、文件改动、测试矩阵、回滚与 DoD | 实施 S9 时使用 |
| [code-review-s11-2026-11-12.md](./code-review-2026-11-10/code-review-s11-2026-11-12.md) | S11 专项审查：CR-ARCH-01..09、全局状态盘点、目标契约、兼容不变量（S11 已完成，v1.23.0） | 实施 S11 前必读 |
| [code-review-s11-graph-2026-11-12.md](./code-review-2026-11-10/code-review-s11-graph-2026-11-12.md) | S11 关系图：当前/目标 DI、registry/prompt/task 序列、状态机、风险与回滚（S11 已完成，v1.23.0） | 理解 S11 影响面 |
| [code-review-s11-plan-2026-11-12.md](./code-review-2026-11-10/code-review-s11-plan-2026-11-12.md) | S11 实施计划：A–H 子阶段、49 个 S/M 任务、测试矩阵、回滚与 DoD（S11 已完成，v1.23.0） | 实施 S11 时使用 |
| [code-review-s12-2026-11-12.md](./code-review-2026-11-10/code-review-s12-2026-11-12.md) | S12 专项审查：CR-STR-01..11、CR-ARCH-10/11/12、CR-DUP-11/12、目标模块边界、行为不变量与验收（S12 已拆分，待实施） | 实施 S12 前必读 |
| [code-review-s12-graph-2026-11-12.md](./code-review-2026-11-10/code-review-s12-graph-2026-11-12.md) | S12 关系图：当前/目标模块、stream/memory/context/persistence/TUI 序列、阶段 DAG、风险与回滚（S12 已拆分，待实施） | 理解 S12 影响面 |
| [code-review-s12-plan-2026-11-12.md](./code-review-2026-11-10/code-review-s12-plan-2026-11-12.md) | S12 实施计划：A–H 子阶段、97 个 S/M 任务、测试矩阵、回滚与 DoD（S12 已拆分，待实施） | 实施 S12 时使用 |
