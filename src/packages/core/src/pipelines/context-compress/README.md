# Context Compress Pipeline

- `index.ts`：定义并注册 `input → archive → summarize → finalize` Pipeline。
- `elements/compress-input.ts`：选择完整消息前缀和摘要输入。
- `elements/compress-archive.ts`：先写不可变 JSONL 原文归档。
- `elements/compress-summarize.ts`：生成累计摘要；失败时禁止破坏性提交。
- `elements/compress-finalize.ts`：提交 Context/Session checkpoint，成功后再清理内存并续跑。
- `elements/types.ts`、`elements/index.ts`：FlowState 与导出。
- `compress.test.ts`：Element、失败边界与 DSL 测试。

数据安全顺序固定为：原文归档 → 摘要 → checkpoint → 内存清理。任一步失败都不得删除
Session 原消息。
