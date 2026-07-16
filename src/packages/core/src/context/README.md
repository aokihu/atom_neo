# Context

ContextService 是 Core 内 Context 的唯一 Owner。Pipeline、Session、Skill 与 Memory 只通过服务写入或获取 Snapshot。

| 文件 | 职责 |
|---|---|
| `context-service.ts` | 管理分层 Bucket、Entry、生命周期、SnapshotState 与 lease |
| `compiler.ts` | 对 Entry 去重、信任分区、预算选择，净化字符串后生成 TOON Snapshot |
| `context-service.test.ts` | Bucket、过期、lease、commit/release 与 Snapshot 测试 |
| `compiler.test.ts` | Snapshot 顺序、预算和不可变性测试 |

ContextBucket 保存共同 scope、owner 和生命周期；Entry 只保存有差异的内容字段。SnapshotState 留在服务内部，Pipeline 只接收 `{ id, content }`，其中 `content` 是单独注入模型的 TOON System Message。

字符串必须在 TOON 编码前调用 `String.toWellFormed()`。结构化内容使用 `@toon-format/toon` 的 `replacer` 递归处理；字面量 `\u`、路径和代码保持原样。禁止对编码完成的 TOON 做正则替换。
