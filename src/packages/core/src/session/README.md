# Session

- `context.ts`：内存中的 Session 状态、消息序号、TODO 与 Continuation。
- `store.ts`：Session 缓存、恢复、挂起与淘汰。
- `persistence-service.ts`：目录 checkpoint、JSONL 分段、恢复和历史查询。
- `types.ts`：持久化状态、归档 receipt 与查询结果类型。
- `context.test.ts`：Session 状态、消息序号和 TODO 续跑规则测试。
- `store.test.ts`：缓存、lease、淘汰、恢复和失败保护测试。
- `persistence-service.test.ts`：原子 generation、归档、恢复和历史查询测试。

磁盘目录以 Session 为单位。`.checkpoints/g-*` 保存完整三件套，`current` 的原子切换是
checkpoint 提交点；顶层三个文件是兼容软链。`message-{n}.jsonl` 写入后不可修改。
