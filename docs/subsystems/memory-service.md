# Memory Service — 设计 & API

> **Purpose**: 长期记忆系统设计。基于 SQLite（元数据 + 图谱）+ 文件（内容）+ ripgrep（搜索）。

---

## 1. 架构

```
.atom/memory/
├── memory.db              # SQLite (bun:sqlite) — 节点元数据 + 图谱边
└── nodes/
    ├── abc123.txt          # 纯文本内容（ripgrep 搜索目标）
    └── def456.txt
```

### 设计原则

- **SQLite 存关系和元数据** — 多对多图拓扑，JOIN 查询高效
- **`.txt` 存内容** — ripgrep 直接扫描文本，无需 DB 提取
- **一个节点一个文件** — SHA-256 命名，内容即正文
- **Bun 内置 SQLite** — `import { Database } from "bun:sqlite"`

## 2. Schema

```sql
CREATE TABLE nodes (
  id TEXT PRIMARY KEY,             -- SHA-256 of content
  tags TEXT DEFAULT '',             -- comma-separated
  weight REAL DEFAULT 100,          -- 0-100
  created_at INTEGER,
  accessed_at INTEGER
);

CREATE TABLE edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relation TEXT NOT NULL            -- "relates_to" | "depends_on" | "extends"
);
```

**关系模型**：多对多（一个节点可关联多个节点，反之亦然）。

## 3. MemoryService API

```typescript
class MemoryService extends BaseService {
  readonly name = "memory";

  constructor(params: { dbPath: string; nodesPath: string })

  // 全文搜索 — ripgrep + SQLite 元数据排序
  search(query: string, limit?: number): MemoryNode[]

  // 图谱遍历 — SQLite edges BFS
  traverse(startId: string, maxSteps?: number): MemoryNode[]

  // 保存记忆 — 写入 .txt + INSERT SQLite
  save(content: string, tags?: string[]): string

  // 建立关系
  link(source: string, target: string, relation: string): void

  // 重置记忆生命周期 — RETAIN_MEMORY 意图触发
  retain(id: string): void

  // 检查记忆是否存在
  has(id: string): boolean

  // Service 生命周期
  async start(): Promise<void>   // 初始化 DB + 启动后台任务
  async stop(): Promise<void>    // 停止后台任务
}
```

## 4. 搜索流程

```
用户输入 → ripgrep --json 扫 nodes/*.txt
  → 提取匹配文件 hash
  → SQLite: SELECT * FROM nodes WHERE id IN (...)
  → 按 weight × recency 排序 → ≤3 条
  → boostWeight(hit.id) → weight += 5
```

## 5. 权重系统

| 操作 | 权重变化 |
|------|----------|
| 新建记忆 | weight = 100 |
| 搜索命中 | weight += 5（上限 100） |
| 注入上下文 | weight += 5（上限 100） |
| 上下文卸载 (count ≥ 5) | weight -= 10（下限 0） |
| 每日衰减 | weight -= 1（下限 0） |
| RETAIN_MEMORY 意图 | weight += 5, access_count 重置为 0 |

记忆不会被删除。weight ≤ 0 的记忆仍在数据库和文件系统中，仅搜索排名降至底部。

**后台定时**：每 5 分钟 `setInterval` 执行一次衰减 + 清理。

## 6. 遍历流程

```
SELECT target_id FROM edges WHERE source_id = ?
  → BFS maxSteps=4
  → 评分: source.weight × 0.5 + target.weight × 0.3 + match × 0.2
  → 返回关联记忆列表
```

## 7. 注入 conversation context

```typescript
// collect-context 元素 — Memory 标签包裹
for (const node of memories) {
  if (node.accessCount >= 5) continue;  // 卸载
  const aging = node.accessCount >= 3 ? ' aging="true"' : "";
  const id = node.id.slice(0, 6);
  contextData += `\n<Memory id="${id}" tags="${node.tags.join(",")}"${aging}>\n${node.content}\n</Memory>\n`;
}
```

### Context 中的 Memory 格式

```xml
<Memory id="2d4bed" tags="project,tech-stack" aging="true">
项目使用 TypeScript 和 Bun 运行时
</Memory>
```

| 属性 | 说明 |
|------|------|
| `id` | SHA-256 前 6 位，LLM 引用用 |
| `tags` | 分类标签 |
| `aging` | count ≥ 3 时出现，提示 LLM 该记忆即将被卸载 |

## 8. 记忆生命周期管理

### 访问计数

| access_count | 行为 |
|-------------|------|
| 0–2 | 正常注入 context |
| 3–4 | 注入 context + `aging="true"` 标签 |
| ≥ 5 | **卸载**: 不注入 context，weight -10 |

### RETAIN_MEMORY 意图

LLM 发现 `aging="true"` 且当前会话需要该记忆时：

```
LLM 调用 intent: { action: "retain_memory", mem_id: "2d4bed" }
```

`check-follow-up` 检测 → 调用 `memory.retain("2d4bed")` → count = 0, weight += 5

### 后台衰减

每 5 分钟定时器：所有记忆每日 -1 权重。记忆不会被删除，weight ≤ 0 仅影响搜索排名。LLM 可通过 `retain_memory` 重置 accessCount 并提升权重。

## 9. 记忆工具

| 工具 | 说明 |
|------|------|
| `search_memory` | 搜索记忆库 |
| `save_memory` | 保存新记忆 |
| `traverse_memory` | 从 key 开始图谱遍历 |
| `link_memory` | 建立记忆关联 |

## 10. 相关文档

| 文档 | 说明 |
|------|------|
| [conversation.md](../pipelines/conversation.md) | 消息组装（context 中注入记忆） |
| [pipeline-dev.md](../core/pipeline-dev.md) | collect-context Element |
