# Context Compress Pipeline

- `index.ts`：定义并注册 `input → archive → summarize → finalize` Pipeline。
- `elements/compress-input.ts`：选择完整消息前缀和摘要输入。
- `elements/compress-archive.ts`：先写不可变 JSONL 原文归档。
- `elements/compress-summarize.ts`：生成累计摘要；失败时禁止破坏性提交。
- `elements/compress-finalize.ts`：提交 Context/Session checkpoint，成功后清理内存；仅自动恢复场景续跑。
- `elements/types.ts`、`elements/index.ts`：FlowState 与导出。
- `compress.test.ts`：Element、失败边界与 DSL 测试。

数据安全顺序固定为：原文归档 → 摘要 → checkpoint → 内存清理。任一步失败都不得删除
Session 原消息。

提交 checkpoint 前，根据新的 Context Snapshot 与剩余可见 Messages 重算 `contextTokens`；
checkpoint 失败时同时恢复旧 Context 条目和旧 Token 值。累计 `tokenUsage.total` 不参与该计算。

压缩对象固定为 Context 和 Messages，不搜索、读取或压缩 Memory。手动 `/compact` 使用
`trigger=manual`、`resumeConversation=false`，提交后直接完成；Token overflow 和 Context pressure
才允许恢复被中断的 Conversation。
