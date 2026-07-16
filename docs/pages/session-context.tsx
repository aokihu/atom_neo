import React from "react";
import type { DocPageProps } from "./shared";
import { PageHeader, Section, CodeBlock, Callout, ComparisonTable, Badge } from "./shared";

export default function SessionContextPage({ content, title, description, category }: DocPageProps) {
  return (
    <div className="doc-page">
      <PageHeader
        title={title}
        description={description}
        category={category}
        readTime={Math.max(1, Math.ceil(content.split(/\s+/).length / 200))}
      />

      <Section title="职责边界">
        <ComparisonTable
          headers={["组件", "负责", "不负责"]}
          rows={[
            [<code>SessionContext</code>, "运行时 Session 状态", "磁盘读写"],
            [<code>SessionStore</code>, "缓存、恢复、挂起 Session", "Context 编译"],
            [<code>ContextService</code>, "Context 生命周期与 Snapshot", "Session 文件结构"],
            [<code>SessionPersistenceService</code>, "原子保存、恢复、消息归档", "自动恢复 Task"],
          ]}
        />
        <Callout type="info" title="状态恢复不等于任务恢复">
          重启后恢复 Topic、TODO、Continuation、Context 和最近消息，但不会自动执行 active TODO
          或重放中断的工具调用。
        </Callout>
      </Section>

      <Section title="Session 目录">
        <CodeBlock lang="text" code={`{sandbox}/.atom/sessions/{safeSessionId}/
├── .checkpoints/g-{revision}-{uuid}/
│   ├── session.json
│   ├── context.json
│   └── message-latest.jsonl
├── current -> .checkpoints/g-{revision}-{uuid}
├── session.json -> current/session.json
├── context.json -> current/context.json
├── message-000001.jsonl
├── message-000002.jsonl
└── message-latest.jsonl -> current/message-latest.jsonl`} />
        <ComparisonTable
          headers={["文件", "数据", "更新策略"]}
          rows={[
            [<code>current</code>, "完整 checkpoint generation", "原子切换；唯一提交点"],
            [<code>session.json</code>, "Session 元数据、TODO、Continuation、Token 和归档游标", "current 兼容入口"],
            [<code>context.json</code>, "可恢复的 Session/Topic Context entries", "current 兼容入口"],
            [<code>message-{`{n}`}.jsonl</code>, "压缩产生的原始消息分段", "不可变"],
            [<code>message-latest.jsonl</code>, "尚未归档的最近消息", "current 兼容入口"],
          ]}
        />
        <Callout type="warn" title="单 Writer 约束">
          一个 sandbox 同时只能由一个 Core 写入 Session 目录；多进程 writer lock 尚未开发。
        </Callout>
        <Callout type="info" title="current 是唯一读写基准">
          Core 内部读取 latest 时直接解析 <code>current</code> generation。顶层软链只用于兼容和人工检查，
          即使暂时未修复，也不能让 History Tool 读到旧检查点。
        </Callout>
      </Section>

      <Section title="Checkpoint 提交顺序">
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
          {[
            "归档分段",
            "generation.tmp",
            "写三文件",
            "fsync generation",
            "rename generation",
            "切换 current",
            "校验 revision",
            "清理内存",
          ].map((label, index, all) => (
            <React.Fragment key={label}>
              <div style={{ padding: "9px 12px", border: "1px solid var(--color-border, #334155)", borderRadius: "8px" }}>
                <Badge color={index === all.length - 1 ? "green" : "blue"}>{index + 1}</Badge> {label}
              </div>
              {index < all.length - 1 && <span style={{ color: "var(--color-muted, #6b7280)" }}>→</span>}
            </React.Fragment>
          ))}
        </div>
        <Callout type="warn" title="删除必须最后发生">
          归档或 checkpoint 任一步失败，都必须保留 Session 内存中的原始消息。恢复时按单调递增
          <code>seq</code> 去重，允许短暂重复，不允许数据缺失。
        </Callout>
      </Section>

      <Section title="Context 保存范围">
        <ComparisonTable
          headers={["保存", "不保存"]}
          rows={[
            ["active session/topic entries", "编译后的 TOON Snapshot"],
            ["尚未过期的累计摘要和归档索引", "task/step/once Context"],
            ["非 consumeOnCommit entries", "Snapshot receipt 与 lease"],
          ]}
        />
        <CodeBlock lang="text" code={`context.json
  → restore durable entries
  → ContextService.put(...)
  → createSnapshot(...)
  → compile a fresh TOON snapshot`} />
      </Section>

      <Section title="保存与恢复">
        <ComparisonTable
          headers={["安全点", "行为"]}
          rows={[
            ["用户消息入队前", "保存 latest 与 Session 状态"],
            ["Conversation 完成、chain 调度前", "保存 assistant、TODO、Token 和 Context"],
            ["Pipeline 产生下游 Task", "携带 ownerTaskId 暂存；父 Task 发出 Task.Committed 后才入队"],
            ["Context 压缩", "先归档并 checkpoint，再删除内存前缀"],
            ["Task 排队或执行", "持有计数 lease，禁止 idle/capacity 淘汰与 DELETE"],
            ["idle / capacity 淘汰", "保存成功后才移出内存"],
            ["Core 关闭", "拒绝新请求，drain 排队和执行中的 Task；全部 Session 保存成功后再清理 Context"],
          ]}
        />
        <CodeBlock lang="text" code={`SessionStore.get(sessionId)
  ├── memory hit → return
  └── memory miss
      ├── no directory → create
      └── restore session.json + context.json + message-latest.jsonl
          └── keep message-{n}.jsonl cold until history tools read it`} />
        <Callout type="info" title="读路径不创建 Session">
          HTTP GET 使用 <code>SessionStore.load()</code>；内存和磁盘都不存在时返回 404，不触发
          Session Started Hook。只有接收新消息的写路径使用 <code>get()</code>。
        </Callout>
      </Section>

      <Section title="安全关闭失败路径">
        <CodeBlock lang="text" code={`reject new input
  → quiesce HookManager + ScheduleService
  → drain waiting + active + processing tasks
  → checkpoint every in-memory Session
      ├── all saved → clear Context and stop services
      └── any failed → keep Session + Context, reject stop(), allow retry`} />
      </Section>

      <Section title="下游任务提交门">
        <CodeBlock lang="text" code={`Pipeline schedules next work with ownerTaskId
  → orchestrator stages it under that parent Task
  → Task.Completed updates Session
  → checkpoint
      ├── success → Task.Committed → release staged work + hooks
      └── failure → report TaskFailed + discard staged work

Independent WS Compact has no ownerTaskId → enqueue immediately`} />
        <Callout type="info" title="失败只关联原始请求">
          显式 <code>ownerTaskId</code> 不存在时直接拒绝调度，不能绕过 checkpoint gate。
          <code>TaskFailed</code> 携带 <code>rootTaskId</code>；客户端只拒绝同一 root 的请求，
          不会让已完成请求的 post-check 或 Hook 失败误伤后续请求。
          HTTP 创建 root Task 若返回非 2xx 或缺少有效 <code>taskId</code>，TUI 会立即失败，
          不会留下无法被事件匹配的 pending 请求。
        </Callout>
      </Section>

      <Section title="生命周期状态">
        <ComparisonTable
          headers={["事件", "状态", "永久结束"]}
          rows={[
            ["idle / capacity 淘汰", <Badge color="orange">suspended</Badge>, "否"],
            ["Core 关闭", <Badge color="orange">suspended</Badge>, "否"],
            ["异常退出后恢复旧 active checkpoint", <Badge color="purple">interrupted</Badge>, "否"],
            ["用户显式结束", <Badge color="green">completed（需要开发）</Badge>, "是"],
            ["不可恢复失败", <Badge color="red">failed（需要开发）</Badge>, "是"],
          ]}
        />
      </Section>

      <Section title="运行时状态、Topic 与界面">
        <ComparisonTable
          headers={["范围", "保留", "切换或结束时处理"]}
          rows={[
            ["Session", "messages、inferenceFacts、tokenUsage、Context", "checkpoint 后可挂起和恢复"],
            ["Topic", "当前主题下的 TODO、Continuation、Skill Context", "Topic 变化时清理旧 Topic/Task/Step Context"],
            ["Task / Step", "本次执行的一次性输入与工具结果", "完成或失败后由 Context 生命周期卸载"],
            ["TUI", "只展示 Server 广播的 Session/Task/Token 状态", "不直接读写 Session 文件"],
          ]}
        />
      </Section>
    </div>
  );
}
