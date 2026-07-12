# Memory Service — 设计 & API

> **Purpose**: 长期记忆系统设计。SQLite 是正文、元数据、图谱和 FTS5 检索索引的唯一数据源。

---

## 1. 架构

```
.atom/memory/
└── memory.db              # SQLite (bun:sqlite) — 正文、元数据、图谱边、FTS5 索引
```

### 设计原则

- **SQLite 单一数据源** — 正文、生命周期和图关系在同一事务中更新
- **SQLite FTS5 统一搜索** — `trigram` 负责三字符以上子串和 BM25 排序，短词使用索引表上的 `instr()` 兜底
- **Bun 内置 SQLite** — `import { Database } from "bun:sqlite"`

## 2. Schema

```sql
CREATE TABLE nodes (
  id TEXT PRIMARY KEY,             -- SHA-256 of content
  content TEXT NOT NULL,           -- memory body
  tags TEXT DEFAULT '',             -- comma-separated
  weight REAL DEFAULT 100,          -- 0-100
  created_at INTEGER,
  accessed_at INTEGER
);

CREATE VIRTUAL TABLE memory_fts USING fts5(
  content,
  tags,
  content='nodes',
  content_rowid='rowid',
  tokenize='trigram'
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

  constructor(params: { dbPath: string; legacyNodesPath?: string })

  // 全文搜索 — SQLite FTS5 + 短词兜底 + 元数据排序
  search(query: string, limit?: number): MemoryNode[]

  // 图谱遍历 — SQLite edges BFS
  traverse(startId: string, maxSteps?: number): MemoryNode[]

  // 保存记忆 — SQLite transaction upsert，FTS trigger 自动同步
  save(content: string, tags?: string[]): string

  // 建立关系
  link(source: string, target: string, relation: string): void

  // 删除记忆及关联边；支持短 ID 查回完整 ID
  forget(id: string): boolean

  // 重置记忆生命周期 — RETAIN_MEMORY 意图触发
  retain(id: string): void

  // 将 Context 中的短 ID 查回唯一完整 ID
  findFullId(memoryId: string): string | null

  // 检查记忆是否存在
  has(id: string): boolean

  // Service 生命周期
  async start(): Promise<void>   // 初始化 DB + 启动后台任务
  async stop(): Promise<void>    // 停止后台任务
}
```

## 4. 搜索流程

```
查询词 → 拆分空格/标点，忽略纯数字日期
  → 中文长短语补充双字部分匹配候选
  → 三字符以上：FTS5 MATCH + bm25(memory_fts)
  → 两字符等短词：SQLite instr(content/tags) 兜底
  → 合并 memory_fts 命中的节点 ID
  → SQLite nodes 直接加载完整节点
  → 按匹配相关度 + weight × recency 排序 → ≤3 条
  → boostWeight(hit.id) → weight += 5
```

例如 `台风 最新 2026` 会删除实时限定词和年份，只保留 `台风`；只要 Memory 正文包含该概念就可进入结果集，不要求完整查询串连续出现。对没有空格的中文长句，会补充连续双字候选，避免“查询一下台风最新动向”无法召回包含“台风”的记忆。

搜索仍是轻量级词法召回，不引入 embedding。Agent 搜索为空时必须继续换用不同且更宽的查询，直到三个不同查询均为空，例如删除时间词并改用不重叠的同义词、领域词或 Skill 名称。仅调整词序、加入年份/新鲜度修饰词，或继续包含已尝试的关键词及中文片段，都视为相似查询且不累计次数。

`memory_fts` 是由 `nodes` external-content 表和 SQLite Trigger 自动维护的派生索引。升级时若检测到旧 `nodes/*.txt`，服务会在事务中把正文迁入 `nodes.content`，重建 FTS5 索引，然后删除已迁移的文本文件。

## 5. 权重系统

| 操作 | 权重变化 |
|------|----------|
| 新建记忆 | weight = 100 |
| 重复保存 | 保留 created_at / access_count / weight，仅更新 tags / accessed_at |
| 搜索命中 | weight += 5（上限 100） |
| 注入上下文 | weight += 5（上限 100） |
| 上下文卸载 (count ≥ 5) | weight -= 10（下限 0） |
| 每日衰减 | weight -= 1（下限 0） |
| RETAIN_MEMORY 意图 | weight += 5, access_count 重置为 0 |

记忆不会被自动删除。weight ≤ 0 的记忆仍在数据库中，仅搜索排名降至底部。

**后台定时**：每 5 分钟 `setInterval` 执行一次衰减 + 清理。

## 6. 遍历流程

```
SELECT target_id FROM edges WHERE source_id = ?
  → BFS maxSteps=4
  → 评分: source.weight × 0.5 + target.weight × 0.3 + match × 0.2
  → 返回关联记忆列表
```

## 7. 注入 conversation context

Prediction 在现有分类调用中额外生成 `memory_query`，例如把“现在查一下台风的信息”提炼为“台风”。`collect-context` 只在该字段非空时执行自动 Memory 搜索，不增加新的 LLM 调用，也不使用本地中文分词。

自动搜索会设置 `memorySearchStatus = "found" | "empty" | "unavailable"`。异常只记录 Debug 信息，不阻断 Conversation；空结果要求 Agent 使用互不相似的查询继续检索，三个不同查询均为空后才能进入 Web。命中并实际注入的节点数记录在 `injectedMemoryCount`；正文或 tags 包含 `Skill` / `技能` 线索时设置 `memorySuggestsSkill`，阻止 `memory_found` 直接开放 Web。

```typescript
// collect-context 元素 — Memory 标签包裹
const memoryQuery = session.pendingPrediction?.memoryQuery?.trim() || "";
const memories = memoryQuery ? await memory.search(memoryQuery) : [];
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
| `id` | SHA-256 前 6 位，LLM 引用用；执行 `retain_memory` 时由 MemoryService 恢复为唯一完整 ID |
| `tags` | 分类标签 |
| `aging` | count ≥ 3 时出现，提示 LLM 该记忆即将被卸载 |

`search_memory` 使用相同的 `<Memory>` 格式返回命中结果，确保 LLM 同时获得记忆正文和可供后续工具使用的短 ID：

```xml
<Memory id="2d4bed" tags="project,tech-stack">
项目使用 TypeScript 和 Bun 运行时
</Memory>
```

这里不存在独立的业务 `key`。当前实现中的完整 `id` 是正文的 SHA-256，短 ID 是它在 Context 和工具输出中的唯一前缀。

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

`check-follow-up` 检测 → `memory.findFullId("2d4bed")` 查回完整 ID → 调用 `memory.retain(fullMemoryId)` → count = 0, weight += 5

### 删除记忆

`forget_memory` 只接受完整 ID 或可唯一匹配的短 ID，不接受记忆正文。用户只描述要删除的内容时，LLM 必须先调用 `search_memory`，再把搜索结果 `<Memory id="...">` 中的 ID 传给 `forget_memory`。

```text
用户描述记忆正文 → search_memory(query) → <Memory id="2d4bed"> → forget_memory({ id: "2d4bed" })
```

`MemoryService.findFullId()` 会将短 ID 查回完整 ID；无匹配或前缀对应多条记忆时不执行删除。

### 后台衰减

每 5 分钟定时器：所有记忆每日 -1 权重。记忆不会被删除，weight ≤ 0 仅影响搜索排名。LLM 可通过 `retain_memory` 重置 accessCount 并提升权重。

## 9. 记忆工具

| 工具 | 说明 |
|------|------|
| `search_memory` | 搜索记忆库；结果包含可供后续操作使用的短 ID |
| `save_memory` | 保存新记忆；写入失败必须返回 `ok: false`，重复保存不重置生命周期 |
| `traverse_memory` | 从记忆 ID 开始图谱遍历 |
| `link_memory` | 建立记忆关联 |
| `forget_memory` | 按 ID 删除指定记忆及关联边；支持 Context/搜索结果中的短 ID，不接受正文 |

## 10. 相关文档

| 文档 | 说明 |
|------|------|
| [conversation.md](../pipelines/conversation.md) | 消息组装（context 中注入记忆） |
| [pipeline-dev.md](../core/pipeline-dev.md) | collect-context Element |
