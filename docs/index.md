# Atom Neo — Documentation Index

> **用途**: 开发文档导航。AI Agent 开发时按需查阅对应文档。

---

## 总览

| 文档 | 说明 | 何时 |
|------|------|------|
| [architecture.md](./overview/architecture.md) | 系统架构总览 | 开始前必读 |
| [project-structure.md](./overview/project-structure.md) | 完整目录树、包结构、依赖图 | 创建文件/目录 |
| [bootstrap.md](./overview/bootstrap.md) | 启动序列、初始化顺序 | 理解启动流程 |
| [development-setup.md](./overview/development-setup.md) | 开发环境搭建 — clone → 安装 → 启动 → 验证 | 第一天 |

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
| [session.md](./core/session.md) | Per-Session 状态、目录持久化、Context 恢复、Topic 与 TUI 生命周期 | 操作会话 |
| [context-management.md](./context-management.md) | Context 六层所有权、Snapshot、Receipt、自动卸载与预算 | 修改 Context 注入或生命周期 |
| [memory-service.md](./subsystems/memory-service.md) | 记忆图 Schema、API、遍历算法 | 实现 Memory |
| [network-service.md](./subsystems/network-service.md) | 同进程网络 Service、WebFetch 子功能与域名调度 | 修改网络能力 |
| [configuration.md](./subsystems/configuration.md) | 配置加载优先级、格式 | 添加配置项 |
| [task-execution.md](./core/task-execution.md) | 双队列系统 + TaskEngine 状态机 (queue + runloop 合并) | 理解任务调度/生命周期 |
| [sandbox.md](./subsystems/sandbox.md) | Sandbox 隔离规则 + 运行时目录结构 | 理解工作目录 |
| [first-run-wizard.md](./subsystems/first-run-wizard.md) | 首次运行 Ink 安装向导规格 | 实现首次启动流程 |
| [tui-modal.md](./tui-modal.md) | TUI 通用 Modal 组件 — 标题/内容/ActionBar + 键盘导航 + 定位 | 实现 TUI 浮层/确认框 |
| [future-features.md](./future-features.md) | 已设计但未实现的功能清单 | 设计时查，避免遗忘 |

## Pipeline 管线

| 文档 | 说明 | 何时 |
|------|------|------|
| [pipelines/conversation.md](./pipelines/conversation.md) | 核心对话管线 — 9-Element 链、FlowState、流式生成、链式续写、TODO 顺序执行、Unicode 净化 | 理解核心流程 |
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
| [clients/code-review-telegram-bot.md](./clients/code-review-telegram-bot.md) | Telegram Bot Client 代码审查报告 — 30 个问题按优先级分级 | 修复代码缺陷 |
| [protocol.md](./communication/protocol.md) | WebSocket 事件协议 | 通信层 |
| [error-handling.md](./communication/error-handling.md) | 错误跨层传播模型 — Element → Pipeline → TaskEngine → Client | 写 try/catch |

## 服务

| 文档 | 说明 | 何时 |
|------|------|------|
| [agents-compiler.md](./subsystems/agents-compiler.md) | AGENTS.md 安全编译器 — LLM 无害化过滤 + SHA-256 缓存 | 理解安全过滤机制 |
| [skill-system-plan.md](./subsystems/skill-system-plan.md) | Skill 系统开发计划 — 8 阶段，33 测试用例 | 开始编码前 |
| [skill-system.md](./subsystems/skill-system.md) | 可插拔 AI Agent 技能系统 — 三层加载、分段注入、自主卸载 | 实现 skill 功能 |
