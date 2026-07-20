# pipelines/shared

> 跨 Pipeline 共享的 Element 和工具

## 文件

| 文件 | 说明 |
|------|------|
| `token-ratio.ts` | TokenRatioElement（kind: boundary）— 计算 token 占用比并上报 |
| `index.ts` | `registerSharedElements()` 统一注册（token-ratio） |

## Token Ratio

TokenRatioElement 通过 `registerSharedElements()` 挂载到 5 条 pipeline：
conversation / prediction / follow-up-evaluator / context-compress / post-conversation。

计算公式：`ratio = contextTokens / (configContextLimit - maxTokens)`。`tokenUsage.total` 是累计模型消费，不能用于 Context 压缩阈值。

> 文档: [pipelines/conversation.md](../../../docs/pipelines/conversation.md) 第 13 节
