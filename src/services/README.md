# Services

运行时服务统一继承 `BaseService`，由 `ServiceManager` 管理生命周期。

| 文件 | 职责 |
|------|------|
| `memory-service.ts` | SQLite Memory 存储、FTS5 召回、图关系和生命周期事件 |
| `memory-ranking.ts` | 无状态的 Memory 相关性、质量与时间衰减计算 |
| `skill-service.ts` | Skill 扫描、加载与 Context 构建 |
| `skill-parser.ts` | 解析 `SKILL.md` 元数据和章节 |
| `agents-compiler.ts` | 编译 Agent 定义 |
| `runtime-service.ts` | 运行时资源协调 |
| `service-manager.ts` | 服务注册、启动与停止 |

Memory 搜索只返回摘要；完整正文读取通过 `read_memory` 进入
`MemoryService.recordRead()`，这是唯一增加真实使用分的路径。排名公式应保留在
`memory-ranking.ts`，避免数据库操作与评分策略重复实现。
