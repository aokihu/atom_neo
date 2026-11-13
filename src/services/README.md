# Services

运行时服务统一继承 `base/base-service.ts` 的 `BaseService`，由 `base/service-manager.ts` 管理生命周期。

| 目录/文件 | 职责 |
|------|------|
| `base/` | `BaseService`、`ServiceManager`、服务公共类型 |
| `memory/` | `MemoryService` facade、SQLite 存储、FTS5 召回、图关系与评分 |
| `network/` | 同进程 NetworkService、共享域名调度与 WebFetch 子功能 |
| `skill/` | Skill 扫描/加载、`SKILL.md` 解析 |
| `agents/` | Agent 定义编译 |
| `runtime/` | 运行时资源协调 |
| `storage/` | `node:sqlite` 薄封装：参数归一化、`transaction(fn)()`、`run/get/all` 兼容面 |

Memory 搜索只返回摘要；完整正文读取通过 `read_memory` 进入，并附带双向去重的关联节点数量，
由 LLM 判断是否继续遍历。`traverse_memory` 同时探索入边和出边。读取正文会调用
`MemoryService.recordRead()`，这是唯一增加真实使用分的路径。排名公式保留在
`memory/memory-ranking.ts`，避免数据库操作与评分策略重复实现。
