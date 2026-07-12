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
  summary TEXT NOT NULL,           -- compact search/context preview
  tags TEXT DEFAULT '',             -- comma-separated
  base_weight REAL DEFAULT 60,      -- intrinsic importance, 0-100
  usage_score REAL DEFAULT 0,       -- lazily decayed read intensity
  retrieval_count INTEGER DEFAULT 0,
  read_count INTEGER DEFAULT 0,
  kind TEXT DEFAULT 'stable_fact',
  confidence REAL DEFAULT 1,
  pinned INTEGER DEFAULT 0,
  last_read_at INTEGER,
  last_confirmed_at INTEGER,
  usage_updated_at INTEGER,
  created_at INTEGER,
  accessed_at INTEGER
);

CREATE VIRTUAL TABLE memory_fts USING fts5(
  summary,
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

  // 按完整或唯一短 ID 读取完整正文
  getById(memoryId: string): MemoryNode | null

  // 图谱遍历 — SQLite edges BFS
  traverse(startId: string, maxSteps?: number): MemoryNode[]

  // 保存记忆 — 摘要差异不足 20% 时直接复用正文
  save(content: string, tags?: string[], summary?: string, options?: MemorySaveOptions): string

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
  → SQLite nodes 加载候选摘要和内部排序字段
  → relevance = 关键词覆盖率 × 70% + BM25 顺序分 × 30%
  → quality = base × 40% + usage × 30% + graph × 20% + freshness × 10%
  → final = relevance × 65% + quality × confidence × 35%
  → 排除被 supersedes 的旧节点，返回 ≤3 条摘要并增加 retrieval_count
```

例如 `台风 最新 2026` 会删除实时限定词和年份，只保留 `台风`；只要 Memory 正文包含该概念就可进入结果集，不要求完整查询串连续出现。对没有空格的中文长句，会补充连续双字候选，避免“查询一下台风最新动向”无法召回包含“台风”的记忆。

搜索仍是轻量级词法召回，不引入 embedding。Agent 搜索为空时必须继续换用不同且更宽的查询，直到三个不同查询均为空，例如删除时间词并改用不重叠的同义词、领域词或 Skill 名称。仅调整词序、加入年份/新鲜度修饰词，或继续包含已尝试的关键词及中文片段，都视为相似查询且不累计次数。

`memory_fts` 是由 `nodes` external-content 表和 SQLite Trigger 自动维护的派生索引，索引 `summary + content + tags`。升级时若检测到旧 schema 或旧 `nodes/*.txt`，服务会补充 `summary`（默认等于正文）、重建 FTS5 索引，并把文本正文迁入 SQLite。

摘要为空，或摘要长度达到正文的 80% 时，存储层令 `summary = content`，避免短记忆同时维护两份几乎相同的文本。

## 5. 动态质量与衰减

`base_weight` 表示记忆的固有重要性，不随时间自动扣减。时间只作用于 `usage_score` 和 `freshness`，并在搜索或读取时按当前时间动态计算，不再运行定时扣权任务。

```text
decayedUsage = usage_score × exp(-ln(2) × elapsedDays / 30)
usage = 100 × (1 - exp(-decayedUsage / 4))

freshness = 100 × exp(-ln(2) × elapsedDays / kindHalfLife)
```

| kind | freshness 半衰期 |
|------|-----------------:|
| identity | 不衰减 |
| preference | 365 天 |
| stable_fact | 180 天 |
| decision / workflow | 90 天 |
| temporary_state | 7 天 |
| realtime_data | 1 天 |

只有 `read_memory` 算真实使用：先把已有 `usage_score` 懒衰减到当前时间，再 `+1`，同时增加 `read_count`。摘要搜索只增加 `retrieval_count`。`retain_memory` 令 `base_weight += 10`（上限 100）并更新 `last_confirmed_at`，不再重置读取次数。`pinned` 记忆的 freshness 固定为 100。

## 6. 遍历流程

```
SELECT target_id FROM edges WHERE source_id = ?
  → BFS maxSteps=4
  → 入边权重: depends_on/used_by=1, derived_from=0.8, extends=0.7, relates_to=0.3
  → graph = 100 × (1 - exp(-weightedReferences / 3))
  → 返回关联记忆列表
```

## 7. 注入 conversation context

Prediction 在现有分类调用中额外生成 `memory_query`，例如把“现在查一下台风的信息”提炼为“台风”。`collect-context` 只在该字段非空时执行自动 Memory 搜索，不增加新的 LLM 调用，也不使用本地中文分词。

自动搜索会设置 `memorySearchStatus = "found" | "empty" | "unavailable"`。异常只记录 Debug 信息，不阻断 Conversation；空结果要求 Agent 使用互不相似的查询继续检索。命中并实际注入的摘要数记录在 `injectedMemoryCount`。Agent 调用 `read_memory` 后才检查完整正文中的 `Skill` / `技能` 线索，并决定继续加载 Skill 或开放 Web。

```typescript
// collect-context 元素 — 自动搜索只注入摘要
const memoryQuery = session.pendingPrediction?.memoryQuery?.trim() || "";
const memories = memoryQuery ? await memory.search(memoryQuery) : [];
for (const node of memories) {
  const id = node.id.slice(0, 6);
  contextData += `\n<MemorySummary id="${id}" tags="${node.tags.join(",")}">\n${node.summary}\n</MemorySummary>\n`;
}
```

### Context 中的 Memory 摘要格式

```xml
<MemorySummary id="2d4bed" tags="project,tech-stack">
项目使用 TypeScript 和 Bun 运行时
</MemorySummary>
```

| 属性 | 说明 |
|------|------|
| `id` | SHA-256 前 6 位，LLM 引用用；执行 `retain_memory` 时由 MemoryService 恢复为唯一完整 ID |
| `tags` | 分类标签 |

`search_memory` 使用相同的 `<MemorySummary>` 格式返回候选，只提供摘要和短 ID。Agent 确认候选与当前任务相关后，调用 `read_memory({ id })` 获取完整正文：

```xml
<MemorySummary id="2d4bed" tags="project,tech-stack">
项目使用 TypeScript 和 Bun 运行时
</MemorySummary>

read_memory({ id: "2d4bed" })

<Memory id="2d4bed" tags="project,tech-stack">
完整记忆正文
</Memory>
```

这里不存在独立的业务 `key`。当前实现中的完整 `id` 是正文的 SHA-256，短 ID 是它在 Context 和工具输出中的唯一前缀。

## 8. 记忆生命周期管理

### 访问与 Context

`read_count` 只记录完整正文读取次数，不控制 Memory 是否可检索，也不会触发自动卸载。Context 预算由摘要优先和按需 `read_memory` 控制。

### RETAIN_MEMORY 意图

用户明确要求继续保留，或 Agent 确认该记忆仍是长期有效事实时：

```
LLM 调用 intent: { action: "retain_memory", mem_id: "2d4bed" }
```

`check-follow-up` 检测 → `memory.findFullId("2d4bed")` 查回完整 ID → 调用 `memory.retain(fullMemoryId)` → base_weight += 10, last_confirmed_at = now

### 删除记忆

`forget_memory` 只接受完整 ID 或可唯一匹配的短 ID，不接受记忆正文。用户只描述要删除的内容时，LLM 必须先调用 `search_memory`，再把搜索结果 `<MemorySummary id="...">` 中的 ID 传给 `forget_memory`。

```text
用户描述记忆正文 → search_memory(query) → <MemorySummary id="2d4bed"> → forget_memory({ id: "2d4bed" })
```

`MemoryService.findFullId()` 会将短 ID 查回完整 ID；无匹配或前缀对应多条记忆时不执行删除。

### 失效与替代

记忆不会因时间自动删除。若存在 `new --supersedes--> old`，旧节点保留供审计，但不参与普通搜索。

## 9. 记忆工具

| 工具 | 说明 |
|------|------|
| `search_memory` | 搜索记忆库；只返回摘要和可供后续操作使用的短 ID |
| `read_memory` | Agent 确认候选相关后，按完整或唯一短 ID 读取完整正文 |
| `save_memory` | 保存正文、可选摘要和 tags；摘要与正文接近时自动复用正文 |
| `traverse_memory` | 从记忆 ID 开始图谱遍历 |
| `link_memory` | 建立记忆关联 |
| `forget_memory` | 按 ID 删除指定记忆及关联边；支持 Context/搜索结果中的短 ID，不接受正文 |

## 10. 相关文档

| 文档 | 说明 |
|------|------|
| [conversation.md](../pipelines/conversation.md) | 消息组装（context 中注入记忆） |
| [pipeline-dev.md](../core/pipeline-dev.md) | collect-context Element |
