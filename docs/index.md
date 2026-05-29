# Atom Neo — Documentation Index

> **用途**: 开发文档导航。AI Agent 开发时按需查阅对应文档。

---

## 先导（必读）

| 文档 | 说明 | 何时 |
|------|------|------|
| [architecture.md](./architecture.md) | 系统架构总览 + v1→v2 变化 | 开始前必读 |
| [architecture.html](./architecture.html) | 架构可视化（Mermaid 图表） | 理解流转关系 |
| [project-structure.md](./project-structure.md) | 完整目录树、包结构、依赖图 | 创建文件/目录 |
| [environment-setup.md](./environment-setup.md) | clone → 安装 → 启动 → 验证 | 第一天 |
| [bootstrap.md](./bootstrap.md) | 启动序列、初始化顺序、依赖图 | 实现 server.ts |

## 开发规范（编码时必查）

| 文档 | 说明 | 何时 |
|------|------|------|
| [coding-conventions.md](./coding-conventions.md) | 代码风格、TS 规范、模式 | 写任何代码 |
| [naming-conventions.md](./naming-conventions.md) | 命名规则表（create/build/parse/...） | 命名时 |
| [type-system.md](./type-system.md) | 类型约定、判别联合体模式 | 定义新类型 |
| [testing.md](./testing.md) | 测试规范、覆盖率要求 | 写测试 |
| [dependency-injection.md](./dependency-injection.md) | 对象如何构造和注入 | 实现新类 |

## 子系统设计（实现功能时查）

| 文档 | 说明 | 何时 |
|------|------|------|
| [message-organization.md](./message-organization.md) | Message 组装架构（system prompt + context + 会话） | 实现 LLM 提交 |
| [sandbox.md](./sandbox.md) | Sandbox 隔离规则 + 运行时目录结构 | 理解工作目录 |
| [element-design.md](./element-design.md) | Element 接口 + 完整模板 | 创建 Element |
| [pipeline-builder.md](./pipeline-builder.md) | Pipeline Builder DSL | 创建 Pipeline |
| [event-bus.md](./event-bus.md) | Event Bus 内部实现、自定义事件 | 扩展事件 |
| [tool-plugin.md](./tool-plugin.md) | Tool 插件接口 + MCP 适配 | 创建 Tool |
| [session-context.md](./session-context.md) | Per-Session 上下文 | 操作会话 |
| [memory-service.md](./memory-service.md) | 记忆图 Schema、API、遍历算法 | 实现 Memory |
| [configuration.md](./configuration.md) | 配置加载优先级、格式 | 添加配置项 |
| [queue.md](./queue.md) | 双队列系统（ActiveQueue LIFO + WaitingQueue FIFO） | 理解任务调度 |
| [runloop.md](./runloop.md) | TaskEngine 状态机 — Suspend/Resume/Complete 转换 | 理解任务生命周期 |
| [future-features.md](./future-features.md) | 所有已设计但未实现的功能清单 | 设计时查，避免遗忘 |

## 通信与界面

| 文档 | 说明 | 何时 |
|------|------|------|
| [protocol.md](./protocol.md) | WebSocket 事件协议、JWT 认证 | 通信层 |
| [error-handling.md](./error-handling.md) | 错误跨层传播模型 | 写 try/catch |
| [tui-redesign.md](./tui-redesign.md) | TUI 重构方案 — OpenTUI React 绑定 | TUI 开发 |

---

## 开发流程（Agent 执行顺序）

```text
✅ 第一轮：建立骨架 P0（已完成）
  1. architecture.md       → 理解系统全貌
  2. project-structure.md  → 创建目录和 package.json
  3. environment-setup.md  → 搭建开发环境
  ✔ monorepo 4 packages (shared/core/gateway/tui) 创建完成

✅ P1：Foundation（已完成）
  7. type-system.md        → 定义所有类型
  8. element-design.md     → 实现 BaseElement
  9. event-bus.md          → 实现 PipelineEventBus
  17. protocol.md          → WebSocket 事件协议
  ✔ 28 tests, 100% pass

✅ P2：Core Engine（已完成）
  4. bootstrap.md          → 实现启动序列
  5. configuration.md      → 实现配置加载
  6. dependency-injection.md → DI 构造链
  11. session-context.md   → Per-Session 上下文
  ✔ TaskEngine, TaskQueue, TaskFactory, SessionStore, SessionContext
  ✔ 21 tests, 100% pass

✅ P3：Tools & Pipelines（已完成）
  12. tool-plugin.md       → ToolRegistry + ToolExecutor + 12 builtin tools
  ✔ read, write, ls, tree, grep, cp, mv, bash, memory tools
  ✔ 59 total tests, 100% pass

⬇ P4：Pipeline Builder（已完成）
  14. pipeline-builder.md  → PipelineBuilder DSL + Element Registry
  15. element-design.md    → 5 Element (collect-prompts→...→finalize)
  16. pipeline-builder.md  → 3 Pipeline 定义（conversation/prediction/follow-up）
  ✔ 96 total tests, 100% pass

⬇ P5：Server & Protocol（已完成）
  17. protocol.md          → HTTP + WebSocket Server + Replay
  18. error-handling.md    → API 错误处理
  ✔ Bun.serve + Broadcaster + PipelineRecorder/Player
  ✔ 107 total tests, 100% pass

✅ P6：Gateway（已完成）
  19. architecture.md      → JWT auth + RateLimit + CoreProxy
  ✔ 116 total tests, 100% pass

✅ P7：TUI（已完成）
  19. architecture.md      → TUI 终端界面

✅ P8：Integration（已完成）
   ✔ 130 total tests, 100% pass

✅ P9：Intent Prediction Pipeline（已完成）
   24. milestones/P9-intent-prediction.md → 意图预测管线完整实施方案
   ✔ 意图预测、动态工具/模型选择、parentTaskId 链路完成

⬇ P10：Follow-Up Evaluator（计划中）
   25. milestones/P10-follow-up-evaluator.md → 长会话质量保障守护管道
   ✔ 设计文档已完成，待审核
```
