# Post-Conversation Pipeline

当前链路：

`post-collect-input -> post-analyze-result -> token-ratio -> post-finalize`

| 文件 | 职责 |
|---|---|
| `elements/collect-input.ts` | 在 Assistant 消息持久化后收集用户请求、回复头尾、TODO 与结束元数据 |
| `elements/analyze-result.ts` | 对不能由结构化状态直接判断的结果做语义质量分析 |
| `elements/finalize.ts` | satisfactory 结束；blocked 写入一次性重试指导并触发 retry |
| `elements/types.ts` | Post-conversation FlowState 与分析结果类型 |
| `index.ts` | 注册 Element 并构建 Pipeline |

Active TODO 由 conversation 的 `check-follow-up` 直接处理，不进入本 Pipeline。这里是模糊结果的质量兜底，不是任务完成状态机。
