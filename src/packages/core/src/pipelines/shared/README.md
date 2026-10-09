# pipelines/shared

> 跨 Pipeline 共享的 Element 和工具

## 文件

| 文件 | 说明 |
|------|------|
| `token-ratio.ts` | TokenRatioElement（kind: boundary）— 计算 token 占用比并上报 |
| `jev-element.ts` | 可选 JevElement（kind: transform）— Prediction/Post-Conversation 限定选择 |
| `progress-evidence.ts` | 任务关联、真实结束原因、正文引用与裁剪范围；事实对象不重复正文 |
| `progress-questions.ts` | JEV 内容状态、续写范围、诊断原因和证据引用的限定判断 |
| `index.ts` | `registerSharedElements()` 统一注册 |

## Token Ratio

TokenRatioElement 通过 `registerSharedElements()` 挂载到 5 条 pipeline：
conversation / prediction / follow-up-evaluator / context-compress / post-conversation。

计算公式：`ratio = contextTokens / (configContextLimit - maxTokens)`。`tokenUsage.total` 是累计模型消费，不能用于 Context 压缩阈值。

> 文档: [pipelines/conversation.md](../../../docs/pipelines/conversation.md) 第 13 节

限定选择调用共享 `decision/choose.ts`，续写仲裁由原有 `check-follow-up` 负责。

局部预算健康检查复用 progress-evidence 的有界正文引用，不增加字数或相似度计算。
