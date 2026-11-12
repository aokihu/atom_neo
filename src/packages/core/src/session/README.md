# Session

`message-policy.ts` 统一过滤失败 Tool Assistant 消息，Prediction、Conversation 与 Compact 不再各自解释
DSML 或 `toolEffectSummary`。

- `context.ts`：内存中的 Session 状态、消息序号、TODO 与 Continuation。
- `message-projection.ts`：纯消息投影（user append、reasoning keep/drop、visible 过滤），不改输入数组。
- `element-session.ts`：Element 边界的 `PipelineSession` / `ElementTask` / `ElementMemory` 结构契约、`CheckpointSession` 与类型化 `getTaskPayload`；不复制 `SessionContext` 全量。
- `element-session.test.ts`：`SessionContext` 可赋值、缺失字段编译失败、`ElementTask = TaskItem` 与 pipelines 生产代码 `session/task/memory: any` 静态回归。
- `store.ts`：Session 缓存、恢复、挂起、淘汰与默认 TUI 会话选择。
- `initiator` 与 `lastTuiUsedAt` 随 checkpoint 保存；历史缺字段保留 unknown，不解析 ID。
- `persistence-service.ts`：SessionPersistenceService facade；checkpoint/restore 组装状态，历史方法委托 history store，`toolRecords` 仍由 facade 持有。
- `session-format.ts`：session 目录常量、generation/segment 命名模式、`toSafeSessionId` SHA-256 前缀、message/tool-records JSONL 编解码与 manifest/receipt 构造。
- `durable-fs.ts`：0o600 文件写入 + fsync、目录 fsync、临时文件 rename 的原子替换；调用顺序与 checkpoint 契约一致。
- `checkpoint-store.ts`：`.checkpoints/g-*` generation 写入/发布/清理、`current` 指针校验、`session.json` 读取与 session 目录解析。
- `history-store.ts`：`message-{n}.jsonl` 不可变归档、archive 索引、history 搜索/读取/revision 与 `message-latest` 解析。
- `types.ts`：持久化状态、归档 receipt 与查询结果类型。
- `context.test.ts`：Session 状态、消息序号和 TODO 续跑规则测试。
- `store.test.ts`：缓存、lease、淘汰、恢复和失败保护测试。
- `persistence-service.test.ts`：原子 generation、归档、恢复和历史查询测试。
- `persistence-characterization.test.ts`：目录/软链/JSONL 字段与 history 查询行为快照。
- `session-format.test.ts`、`durable-fs.test.ts`、`checkpoint-store.test.ts`、`history-store.test.ts`：format、durable IO、checkpoint、history 的直接单测。
- `execution-budget.ts`：统一 conversation 释放政策、目标初始化、暂停和恢复授权；状态与完整待执行 TaskItem 随 checkpoint 保存。

磁盘目录以 Session 为单位。`.checkpoints/g-*` 保存完整四件套（session/context/message-latest/tool-records），
`current` 的原子切换是 checkpoint 提交点；顶层四个文件是兼容软链。`message-{n}.jsonl` 写入后不可修改。
