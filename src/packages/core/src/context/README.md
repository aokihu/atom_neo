# Context

ContextService 是 Core 内 Context 的唯一 Owner。Pipeline、Session、Skill 与 Memory 只通过服务写入或获取 Snapshot。

| 文件 | 职责 |
|---|---|
| `context-service.ts` | 管理分层 Bucket、Entry、生命周期、SnapshotState 与 lease |
| `compiler.ts` | 对 Entry 去重、信任分区、预算选择，净化字符串后生成静态文本与动态 TOON 的混合 Snapshot，并提供统一 Token 估算 |
| `context-service.test.ts` | Bucket、过期、lease、commit/release 与 Snapshot 测试 |
| `compiler.test.ts` | Snapshot 顺序、预算和不可变性测试 |
| `compiler-cache.test.ts` | 静态前缀、格式信任约束与结构化数据回归测试 |
| `test-helpers.ts` | 仅测试使用的动态 TOON 分块读取器 |

ContextBucket 保存共同 scope、owner 和生命周期；Entry 只保存有差异的内容字段。SnapshotState 留在服务内部，Pipeline 只接收 `{ id, content }`，其中 `content` 是单独注入模型的混合指令正文。

字符串必须在 TOON 编码前调用 `String.toWellFormed()`。结构化内容使用 `@toon-format/toon` 的 `replacer` 递归处理；字面量 `\u`、路径和代码保持原样。禁止对编码完成的 TOON 做正则替换。
