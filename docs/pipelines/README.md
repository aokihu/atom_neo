# Pipelines

Atom Neo 的运行时由 5 个 Pipeline 组成，每个 Pipeline 是一组按序执行的 Element 链。

## 概览

| Pipeline | 元素数 | 触发方式 | 职责 |
|----------|--------|---------|------|
| [prediction](./prediction.md) | 3 | 外部用户请求 | 预测用户意图（工具需求、任务类型、上下文关联度） |
| [conversation](./conversation.md) | 10 | prediction 触发 / 链式续写 | 核心对话：加载上下文 → 调用 LLM → 处理结果 → 触发续写 |
| [prompts](./prompts.md) | — | Pipeline Element 内部调用 | 提示词统一注册、多语言选择、模型精细化追加、惰性缓存 |

## 子系统

| 文档 | 职责 |
|------|------|
| [topic](./topic.md) | 会话主题跟踪与状态管理 |
| [prompts](./prompts.md) | 提示词统一管理、多语言、模型级精细化 |
| [session-lifecycle](./session-lifecycle.md) | 会话生命周期 — TUI 状态指示器管理 |
| [follow-up-evaluator](./follow-up-evaluator.md) | 3 | 链式续写每 3 步 / 深度超限 | 评估对话健康度，必要时干预或升级模型 |
| [context-compress](./context-compress.md) | 3 | Token 使用超 80% 阈值 | 压缩旧对话历史：归档 → LLM 摘要 → 清理消息 |
| [follow-up](./follow-up.md) | 2 | **未使用（死代码）** | 早期续写处理桩，已被 conversation + Conversation.Chain 替代 |

## 统一范式

所有 Pipeline 遵循相同的构建和执行范式：

### Element 类型

| Kind | 职责 | 数量限制 |
|------|------|---------|
| `source` | 初始化 FlowState，从外部读取输入 | 1（必须第一个） |
| `transform` | 读取并修改 FlowState | 0-N |
| `boundary` | 决策点，决定 FlowState 的分支走向 | 0-N |
| `sink` | 终结 Pipeline，产生 PipelineResult | 1（必须最后一个） |

### 状态机

每个 Pipeline 通过 `mode` 字段驱动状态转换：

```
initial → [source] → mode₁ → [transform/boundary] → mode₂ → ... → [sink] → PipelineResult
```

### 事件通信

Element 与外部通过 `PipelineEventBus` 通信：
- `this.report(BusEvents.Element.Data, {...})` — 输出内部状态
- `this.report(BusEvents.Transport.Delta, {...})` — 流式文本传输
- `this.report(BusEvents.Conversation.Chain, {...})` — 链式任务触发
- `element.state-changed` / `pipeline.element.*` — 生命周期事件（自动发射）

### 构建方式

```typescript
pipeline("name")
  .source("element-name", deps)
  .transform("element-name", deps)
  .boundary("element-name", deps)
  .sink("element-name", deps)
  .build(bus)
```

### 执行方式

```typescript
TaskEngine → pipelineBuilders[name](task) → pipeline.build(bus) → runner.run(input, definition)
```

## 已知不一致

| 问题 | 详情 |
|------|------|
| follow-up pipeline 是死代码 | 已注册但无触发路径，`scheduleFollowUp()` 实际创建 `conversation` 任务 |
| 3 个 pipeline 未导出 deps type | follow-up-evaluator、context-compress、follow-up 的 deps 内联在函数签名中 |
| source element 模式检查不一致 | 部分 source 不检查 `mode`（prediction、evaluator、compress），部分检查（conversation、follow-up） |
| boundary kind 仅用一次 | `check-follow-up` 是唯一使用 `.boundary()` 的元素 |
| follow-up 元素内联 | follow-up 的 2 个元素定义在 `index.ts` 中，无独立文件 |
