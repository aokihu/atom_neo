# Future Features — 未来功能清单

> **Purpose**: 集中记录所有已设计但尚未实现的功能。按模块分类。新功能设计时如产生扩展点想法，统一记录到此文档，避免遗忘。

---

## Evaluator Pipeline

> 来源： [Follow-Up Evaluator](pipelines/follow-up-evaluator.md)

| 功能 | 说明 | 优先级 | 触发时机 |
|------|------|--------|----------|
| **阶段性 checkpoint** | 每 N 轮将当前进度摘要存入 memory（traverse_memory 可读取），防止断点丢失 | 中 | 每 5 轮 |
| **话题漂移检测** | 检测对话是否偏离原始任务，偏离时提示 | 中 | 每次 evaluator 触发 |
| **自动 fallback** | 连续失败时自动降级到更简单模型 | 中 | evaluator 判断 stuck 时 |
| **结构化分析指标** | evaluator-input 预计算 stats（回复相似度、tool 成功率、语义距离）辅助 LLM 判断 | 低 | 每次 evaluator |
| **质量回归检测** | 对比当前输出和早期输出的质量指标（长度、结构化程度、token 分布） | 低 | 每次 evaluator |
| **任务分解** | 检查是否可拆成子 task 并行处理，利用 Task Queue 并发 | 低 | evaluator 触发时 |
| **混合模型调度** | 推理子任务用 reasoner，生成子任务用 chat | 低 | 根据 upgradeModel 标记 |
| **成本/延迟统计** | 记录每轮 token 消耗和延迟，长会话结束后生成报告 | 低 | 长会话结束 |

---

## Conversation Pipeline

> 来源： [Conversation Pipeline](pipelines/conversation.md)

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **Memory 查询注入** | MemoryService 查询长期记忆，附加到 collect-context 的 contextData | 中 |
| **Inference facts** | SessionContext 中的推理事实注入 system prompt | 低 |
| **Sandbox 目录快照** | 将 sandbox 当前目录结构注入上下文 | 低 |

---

## Configuration & Providers

> 来源： [Configuration](subsystems/configuration.md)

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **多 Provider 支持** | 支持 OpenAI（reasoningEffort）、Gemini（thinkingConfig）等 provider 的动态模型选择 | 中 |
| **模型选择从 config 读取** | `transport.model` 当前生效但 server 硬编码 `deepseek-v4-flash`，改为从 config 读取 | 低 |

---

## Pipeline Chain

> 来源： [Task Execution](core/task-execution.md)、[Conversation Pipeline](pipelines/conversation.md)

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **新链类型扩展** | chainAction 目前有 `more_tools` / `follow_up`，预留接口支持新类型（如 `summary`、`checkpoint`） | 中 |
| **链深度可视化** | 在 TUI 中显示当前 chainDepth / 链状态 | 低 |

---

## TUI

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **链状态指示器** | 显示当前对话链的轮次和健康状态（从 evaluator 读取） | 低 |
| **Stale spinner 超时后显示进度提示** | 超过 2s 无数据时显示 "等待中..." 而非 spinner | 低 |

---

## Shared Types

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **SessionMessage 元数据标准化** | 统一 `metadata` 字段的使用规范（当前是自由 `Record<string, unknown>`） | 低 |
| **TaskItem 扩展字段** | 支持 per-task 的 evaluator 结果、chain 状态等元数据 | 低 |

---

## 维护说明

- 实现某功能后，将对应行从本文档移除
- 新增扩展点想法时，添加到对应模块分类下
- 优先级评估标准：
  - **高**：下一版本应当实现
  - **中**：3 个版本内有望实现
  - **低**：方向性想法，暂无计划

## 相关文档

| 文档 | 说明 |
|------|------|
| [pipelines/conversation.md](./pipelines/conversation.md) | 核心对话管线（实现的功能基线） |
| [configuration.md](./subsystems/configuration.md) | 配置系统（Provider 扩展入口） |