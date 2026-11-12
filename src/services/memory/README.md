# Memory 服务模块

`MemoryService`（`../memory-service.ts`）只保留公共 API facade；数据库、查询和图的实现都在本目录。

| 文件 | 职责 |
|------|------|
| `memory-types.ts` | `MemoryNode`、`MemorySaveOptions`、`MemoryTraversalNode` 及 `MemoryKind` re-export |
| `memory-schema.ts` | schema/列迁移、FTS5 表与 trigger、旧 `.txt` 内容迁移 |
| `memory-store.ts` | SQLite 生命周期、行映射、CRUD/query primitives、写入事务与 usage 记录 |
| `memory-query.ts` | FTS5/短词候选、过期与 supersedes 过滤、覆盖率、rank order、最终评分、retrieval 记录、节点质量计算 |
| `memory-graph.ts` | BFS `traverse`、`link`、`countRelated`、邻居质量排序 |

约束：

- `schema`、SQL 语句、事务边界必须与拆分前逐字/逐边界一致。
- DDL、列迁移与 FTS trigger 只在 `memory-schema.ts` 维护；`MemoryStore` 不内联 schema SQL。
- `MemoryStore` 只做持久化与行映射，不计算 relevance/final score。
- 评分公式仍集中在 `../memory-ranking.ts`。
- 修改本目录后至少运行 `bun test src/services/memory-service.test.ts src/services/memory-characterization.test.ts src/services/memory` 与 `bunx tsc -p tsconfig.node.json --noEmit`。
