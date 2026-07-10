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
            [<strong>SQLite nodes</strong>, <code>id, tags, weight, access_count, timestamps</code>, "保存节点身份和生命周期元数据"],
            [<strong>SQLite edges</strong>, <code>source_id, target_id, relation</code>, "保存记忆之间的图关系"],
            [<strong>nodes/*.txt</strong>, "每条记忆一个文本文件", "保存正文并供 ripgrep 搜索"],
          ]}
        />
        <CodeBlock lang="sql" code={`CREATE TABLE nodes (
  id TEXT PRIMARY KEY,             -- SHA-256 of content
  tags TEXT DEFAULT '',
  weight REAL DEFAULT 100,
  access_count INTEGER DEFAULT 0,
  created_at INTEGER,
  accessed_at INTEGER
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
            [<Badge color="blue">完整 ID</Badge>, "记忆正文的 64 位 SHA-256", "SQLite 主键、正文文件名、图关系"],
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
            [<Badge color="blue">search</Badge>, <code>search(query, limit?)</code>, "ripgrep 搜索正文，按权重和时效排序"],
            [<Badge color="green">save</Badge>, <code>save(content, tags?)</code>, "临时文件 + SQLite upsert，返回完整 ID"],
            [<Badge color="purple">traverse</Badge>, <code>traverse(startId, maxSteps?)</code>, "按 ID 从 edges 开始 BFS"],
            [<Badge color="blue">findFullId</Badge>, <code>findFullId(memoryId)</code>, "将唯一短 ID 查回完整 ID"],
            [<Badge color="orange">link</Badge>, <code>link(source, target, relation)</code>, "按完整 ID 建立关系边"],
            [<Badge color="red">forget</Badge>, <code>forget(id)</code>, "按完整 ID或唯一短 ID删除节点、正文和关联边"],
            [<Badge color="blue">retain</Badge>, <code>retain(id)</code>, "重置访问计数并提升权重"],
          ]}
        />
      </Section>

      <Section title="搜索与删除">
        <p><code>search_memory</code> 的可见输出必须同时包含正文和短 ID：</p>
        <CodeBlock lang="xml" code={`<Memory id="2d4bed" tags="project,tech-stack">
项目使用 TypeScript 和 Bun 运行时
</Memory>`} />
        <CodeBlock lang="text" code={`用户描述要删除的正文
  → search_memory({ query })
  → 读取 <Memory id="2d4bed">
  → forget_memory({ id: "2d4bed" })
  → findFullId("2d4bed")
  → 删除 edges、nodes 和 nodes/<full-id>.txt`} />
        <Callout type="warn" title="forget_memory 不接受正文">
          如果用户没有提供 ID，Agent 必须先搜索。把记忆正文直接传入 <code>id</code> 会被拒绝，也不会触发删除。
        </Callout>
      </Section>

      <Section title="权重与生命周期">
        <ComparisonTable
          headers={["事件", "变化"]}
          rows={[
            ["新建记忆", "weight = 100, access_count = 0"],
            ["重复保存", "保留 created_at、access_count、weight；更新 tags、accessed_at"],
            ["搜索或注入 Context", "weight + 5，上限 100"],
            ["RETAIN_MEMORY", "access_count = 0，weight + 5"],
            ["Context 卸载", "access_count ≥ 5 时不再注入并降低权重"],
          ]}
        />
      </Section>

      <Section title="工具一览">
        <ComparisonTable
          headers={["工具", "权限", "职责"]}
          rows={[
            [<code>search_memory</code>, "READ_ONLY", "搜索并返回带短 ID 的 Memory 标签"],
            [<code>save_memory</code>, "FILE_WRITE", "保存正文和标签"],
            [<code>traverse_memory</code>, "READ_ONLY", "从记忆 ID 遍历图谱"],
            [<code>link_memory</code>, "FILE_WRITE", "关联两条记忆"],
            [<code>forget_memory</code>, "FILE_WRITE", "按完整 ID或唯一短 ID删除记忆"],
          ]}
        />
      </Section>
    </div>
  );
}
