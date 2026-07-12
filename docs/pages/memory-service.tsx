import React from "react";
import type { DocPageProps } from "./shared";
import { PageHeader, Section, CodeBlock, Callout, ComparisonTable, Badge } from "./shared";

export default function DocPage({ content, title, description, category }: DocPageProps) {
  return (
    <div className="doc-page">
      <PageHeader
        title={title}
        description={description}
        category={category}
        readTime={Math.max(1, Math.ceil(content.split(/\s+/).length / 200))}
      />

      <Section title="当前架构">
        <ComparisonTable
          headers={["存储", "内容", "职责"]}
          rows={[
            [<strong>SQLite nodes</strong>, <code>content, summary, base_weight, usage_score, kind, counters, timestamps</code>, "保存正文、摘要、固有价值和动态评分信号"],
            [<strong>SQLite edges</strong>, <code>source_id, target_id, relation</code>, "保存记忆之间的图关系"],
            [<strong>SQLite FTS5</strong>, <code>memory_fts(summary, content, tags)</code>, "external-content trigram 索引、BM25 排序及短词兜底"],
          ]}
        />
        <CodeBlock lang="sql" code={`CREATE TABLE nodes (
  id TEXT PRIMARY KEY,             -- SHA-256 of content
  content TEXT NOT NULL,
  summary TEXT NOT NULL,
  tags TEXT DEFAULT '',
  base_weight REAL DEFAULT 60,
  usage_score REAL DEFAULT 0,
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
  relation TEXT NOT NULL
);`} />
      </Section>

      <Section title="ID 语义">
        <ComparisonTable
          headers={["名称", "含义", "使用位置"]}
          rows={[
            [<Badge color="blue">完整 ID</Badge>, "记忆正文的 64 位 SHA-256", "SQLite 主键、图关系"],
            [<Badge color="green">短 ID</Badge>, "完整 ID 的唯一前缀，Context 默认显示前 6 位", "LLM 引用、retain_memory、forget_memory"],
            [<Badge color="orange">key</Badge>, "当前 MemoryService 没有独立业务 key", "旧文档或遗留参数名不代表当前数据字段"],
          ]}
        />
        <Callout type="info" title="写操作必须先恢复完整 ID">
          <code>findFullId(memoryId)</code> 先尝试完整 ID，再查找唯一前缀。没有匹配或前缀命中多条记忆时返回 <code>null</code>，不会执行保留或删除。
        </Callout>
      </Section>

      <Section title="MemoryService API">
        <ComparisonTable
          headers={["操作", "方法签名", "说明"]}
          rows={[
            [<Badge color="blue">search</Badge>, <code>search(query, limit?)</code>, "候选词 OR 搜索正文/tags，按相关度、权重和时效排序"],
            [<Badge color="blue">getById</Badge>, <code>getById(memoryId)</code>, "将摘要候选的 ID 恢复并读取完整正文"],
            [<Badge color="green">save</Badge>, <code>save(content, tags?, summary?, options?)</code>, "可用 supersedesId 原子替代旧节点"],
            [<Badge color="purple">traverse</Badge>, <code>traverse(startId, maxSteps?)</code>, "BFS 返回 sourceId、relation、depth，工具层只展示摘要"],
            [<Badge color="blue">findFullId</Badge>, <code>findFullId(memoryId)</code>, "将唯一短 ID 查回完整 ID"],
            [<Badge color="orange">link</Badge>, <code>link(source, target, relation)</code>, "恢复完整 ID 后建立唯一关系边"],
            [<Badge color="red">forget</Badge>, <code>forget(id)</code>, "按完整 ID 或唯一短 ID 删除节点、正文、索引和关联边"],
            [<Badge color="blue">retain</Badge>, <code>retain(id)</code>, "确认仍然有效并提升 base_weight，不重置读取历史"],
          ]}
        />
      </Section>

      <Section title="搜索与删除">
        <p><code>search_memory</code> 只返回摘要和短 ID；确认相关后再读取正文：</p>
        <CodeBlock lang="xml" code={`<MemorySummary id="2d4bed" tags="project,tech-stack">
项目技术栈摘要
</MemorySummary>

read_memory({ id: "2d4bed" })
<Memory id="2d4bed" tags="project,tech-stack">
项目使用 TypeScript 和 Bun 运行时
</Memory>`} />
        <CodeBlock lang="text" code={`用户描述要删除的正文
  → search_memory({ query })
  → 读取 <MemorySummary id="2d4bed">
  → forget_memory({ id: "2d4bed" })
  → findFullId("2d4bed")
  → 在 SQLite 事务中删除 edges 和 nodes
  → Trigger 同步删除 memory_fts 索引`} />
        <Callout type="warn" title="forget_memory 不接受正文">
          如果用户没有提供 ID，Agent 必须先搜索。把记忆正文直接传入 <code>id</code> 会被拒绝，也不会触发删除。
        </Callout>
      </Section>

      <Section title="查询能力发现">
        <ComparisonTable
          headers={["阶段", "行为", "结果"]}
          rows={[
            ["Context", "检查已注入的 Memory 与 Skill", "已有查询方法时直接遵循"],
            ["Memory", "搜索摘要、正文与 tags，只注入候选摘要", "记录 found / empty / unavailable"],
            ["Read", "确认候选相关后调用 read_memory", "取得完整正文"],
            ["Skill", "Memory 提供 Skill 线索时加载对应 section", "取得可复用查询流程"],
            ["Web", "普通方法命中，或 Skill 成功加载后开放 webfetch", "获取最终实时数据"],
          ]}
        />
        <CodeBlock lang="text" code={`用户: 现在查一下台风的信息
  → Prediction.memoryQuery = "台风"
  → collect-context 搜索 Memory
  → 命中查询方法 / Skill 线索
  → 按方法开放并执行 webfetch`} />
        <Callout type="info" title="空结果需要扩大查询">
          空结果不会立即开放 Web。Agent 必须使用互不相似且更宽的查询重试；三个不同查询仍为空，或 Memory 不可用时才进入 Web。年份、实时性修饰词及存在关键词或中文片段重叠的组合不累计次数。用户提供明确 URL 时可直接访问。
        </Callout>
      </Section>

      <Section title="动态质量与生命周期">
        <ComparisonTable
          headers={["事件", "变化"]}
          rows={[
            ["摘要曝光", "自动搜索、search_memory、traverse_memory 均令 retrieval_count +1"],
            ["read_memory", "懒衰减 usage_score 后 +1，read_count +1"],
            ["选择率", "平滑 read/retrieval 比例占质量分 5%"],
            ["RETAIN_MEMORY", "base_weight +10，更新 last_confirmed_at"],
            ["时间流逝", "动态降低 usage/freshness，不修改 base_weight"],
            ["supersedes", "save_memory 在事务中保存新节点并替代旧节点"],
            ["pinned", "freshness 固定为 100"],
          ]}
        />
      </Section>

      <Section title="瞬时图谱浏览">
        <p><code>traverse_memory</code> 返回摘要、短 ID、来源节点、关系类型和遍历深度。结果仅供紧接着的一个模型 step 选择节点，随后自动从 AI SDK messages 中裁剪，也不会写入跨轮次 Session Tool Context。</p>
        <CodeBlock lang="xml" code={`<MemorySummary id="a1b2c3" tags="workflow" depth="0">
根记忆摘要
</MemorySummary>
<MemorySummary id="d4e5f6" tags="skill" sourceId="a1b2c3" relation="depends_on" depth="1">
关联记忆摘要
</MemorySummary>`} />
      </Section>

      <Section title="工具一览">
        <ComparisonTable
          headers={["工具", "权限", "职责"]}
          rows={[
            [<code>search_memory</code>, "READ_ONLY", "搜索并返回摘要与短 ID"],
            [<code>read_memory</code>, "READ_ONLY", "按完整或唯一短 ID 读取完整正文"],
            [<code>save_memory</code>, "FILE_WRITE", "保存正文；supersedesId 可原子替代旧记忆"],
            [<code>traverse_memory</code>, "READ_ONLY", "瞬时返回摘要、短 ID 和关系元数据"],
            [<code>link_memory</code>, "FILE_WRITE", "关联两条记忆"],
            [<code>forget_memory</code>, "FILE_WRITE", "按完整 ID或唯一短 ID删除记忆"],
          ]}
        />
      </Section>
    </div>
  );
}
