import React from "react";
import type { DocPageProps } from "./shared";
import { Badge, Callout, CodeBlock, ComparisonTable, PageHeader, Section } from "./shared";

const scopes = [
  ["system", "PromptRegistry / ToolRegistry", "安全规则、系统提示、工具协议", "程序停止或配置变化"],
  ["workspace", "AgentsCompiler / Skill catalog", "AGENTS、Skill 定义", "工作区或文件版本变化"],
  ["session", "SessionContext / SessionStore", "消息、摘要、稳定偏好", "关闭或 idle TTL"],
  ["topic", "TopicContext", "当前主题、激活 Skill", "主题切换"],
  ["task", "TaskChainContext", "目标、Todo、Continuation", "根任务结束"],
  ["step", "StepContext", "Tool 结果、临时 Memory", "下一步骤消费后"],
];

export default function ContextManagementPage({ content, title, description, category }: DocPageProps) {
  return (
    <div className="doc-page">
      <PageHeader title={title} description={description} category={category} readTime={Math.max(1, Math.ceil(content.split(/\s+/).length / 200))} />

      <Callout type="tip" title="一句话模型">
        ContextBucket 负责管理，SnapshotState 负责追踪，ContextSnapshot 只输出一段 TOON System Message。
      </Callout>

      <Section title="六层 Context">
        <ComparisonTable
          headers={["Scope", "Owner", "保存内容", "自动释放"]}
          rows={scopes.map(([scope, owner, data, release], index) => [
            <Badge color={index < 2 ? "blue" : index < 4 ? "green" : "orange"}>{scope}</Badge>,
            <code>{owner}</code>,
            data,
            release,
          ])}
        />
        <Callout type="info" title="所有权规则">
          下一层可以读取上一层，但不能修改上一层。Memory 检索结果只是 task/step 的临时投影。
        </Callout>
      </Section>

      <Section title="统一提交边界">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", flexWrap: "wrap", margin: "16px 0" }}>
          {["Core / record-context", "ContextService", "context-collect", "ContextSnapshot", "stream-llm", "commit / release"].map((item, index, all) => (
            <React.Fragment key={item}>
              <div style={{ padding: "10px 14px", border: "1px solid var(--color-border, #334155)", borderRadius: "8px", background: "var(--color-surface, #1e1e2e)", fontWeight: 600 }}>
                {item}
              </div>
              {index < all.length - 1 && <span style={{ color: "var(--color-muted, #6b7280)" }}>→</span>}
            </React.Fragment>
          ))}
        </div>
        <CodeBlock lang="text" code={`ContextBucket -> select -> sanitize -> TOON encode -> freeze
公共层级字段       预算与信任    Unicode 安全    单段文本       只读快照`} />
        <Callout type="info" title="不重复字段">
          owner、生命周期、pinned 和 expiresAt 只保存在 ContextService；Snapshot 仅保留模型需要的 trust、scope、channel、source 和 content。
        </Callout>
        <CodeBlock lang="toon" code={`context[3]{trust,scope,channel,source,content}:
  trusted,workspace,instructions,agents-compiler,"Less Code, More Power."
  untrusted,session,messages,memory,用户的常用地址是上海市示例路 88 号。
  untrusted,topic,messages,memory,查询天气时先解析城市，再调用 weather tool。`} />
        <Callout type="ok" title="LLM 输入边界">
          snapshot.content 作为单独 System Message；Conversation Messages 和 Tool Definitions 不进入 TOON Snapshot。
        </Callout>
        <Callout type="warn" title="先净化，再编码">
          Fragment 字符串在编码前修复孤立代理字符和不完整 hex escape；结构化内容使用 TOON replacer 递归处理。禁止编码后替换 TOON 文本，否则会破坏反斜杠转义。
        </Callout>
      </Section>

      <Section title="Snapshot 事务">
        <CodeBlock lang="text" code={`createSnapshot -> acquire lease -> model success -> commitSnapshot
                                      model failure -> releaseSnapshot`} />
        <Callout type="warn" title="禁止 destructive read">
          收集期间不得删除 Session 或 Tool 数据。一次性 Fragment 只在模型实际接受 Snapshot 且步骤成功后消费，本地 fallback 或失败时保留给重试。
        </Callout>
      </Section>

      <Section title="生命周期操作">
        <ComparisonTable
          headers={["操作", "含义", "删除 Memory"]}
          rows={[
            [<code>expire</code>, "标记过期，后续 Snapshot 不再包含", "否"],
            [<code>dispose</code>, "释放运行时内存、句柄和缓存", "否"],
            [<code>forget</code>, "显式删除持久 Memory", "是"],
          ]}
        />
        <CodeBlock lang="text" code={`active -> expired -> disposed
          lease > 0 时禁止 dispose`} />
      </Section>

      <Section title="Step Snapshot">
        <CodeBlock lang="text" code={`TaskSnapshot: 固定当前分层输入
      ↓ skill revision 变化
prepareStep: 从 ContextService 获取新 Snapshot
      ↓
只替换下一步骤的 TOON System Message`} />
        <Callout type="ok" title="预期结果">
          Skill load/unload 在下一模型步骤生效，topic 切换时自动清空；Memory 不重复检索；在途 Snapshot 保持稳定可重放。
        </Callout>
        <Callout type="info" title="可真正卸载">
          Skill Tool 只返回加载回执，正文只进入可替换的 StepSnapshot，不会残留在 Tool history 中。
        </Callout>
        <Callout type="info" title="Memory 可选持久注入">
          read_memory 默认只返回当前 Tool Result。injectToContext.retention=pinned 适合家庭地址等长期信息，写入 Session；retention=ttl 适合天气查询方法等临时信息，写入 Topic 并按条目过期，同一条 Memory 再次注入会续期。所有 Memory 都作为 untrusted messages 处理。
        </Callout>
      </Section>

      <Section title="长任务的 Turn 生命周期">
        <CodeBlock lang="text" code={`LLM Turn 结束
  ↓ check-follow-up
active TODO ── 是 ──→ follow_up
     │ 否
     ↓
Task.Completed 保存 Assistant
     ↓
post-conversation 读取回复头尾 + TODO/结束状态`} />
        <ComparisonTable
          headers={["边界", "负责判断", "不负责"]}
          rows={[
            [<code>check-follow-up</code>, "TODO 是否全部完成", "不猜测文章质量"],
            [<code>Task.Completed</code>, "先保存消息再调度", "不提前启动下一任务"],
            [<code>post-conversation</code>, "模糊结果的语义质量", "不替代 active TODO 状态机"],
          ]}
        />
        <Callout type="ok" title="确定性优先">
          模型的 finishReason=stop 只结束当前生成；只要仍有 pending/in_progress TODO，系统就自动续写。质量检查只接收长回复的开头、结尾、总长度和结构化状态，不重复注入全文。
        </Callout>
      </Section>

      <Section title="当前落地状态">
        <ComparisonTable
          headers={["能力", "当前实现", "状态"]}
          rows={[
            ["ContextService / Bucket / Entry", "Core 内唯一 Context Owner", <Badge color="green">已完成</Badge>],
            ["TOON Snapshot / SnapshotState", "单独 System Message 与管理元数据分离", <Badge color="green">已完成</Badge>],
            ["commit / release / lease", "成功消费、失败保留、在途保护", <Badge color="green">已完成</Badge>],
            ["分层预算与 trust", "Entry 选择，禁止 untrusted instruction", <Badge color="green">已完成</Badge>],
            ["EventBus 生命周期", "Session、Topic、Task、Step 结束通知", <Badge color="green">已完成</Badge>],
            ["Manifest / Replay", "SnapshotState 按 ID 保留编译元数据", <Badge color="green">已完成</Badge>],
            ["Memory 分级持久注入", "pinned 跟随 Session；ttl 跟随 Topic 并自动卸载", <Badge color="green">已完成</Badge>],
            ["Artifact 引用", "大型 Tool 结果仍待外置", <Badge color="orange">需要开发</Badge>],
          ]}
        />
        <Callout type="info" title="小步迁移">
          ContextService 直接接收写入；EventBus 只发送生命周期事件，不通过事件传递大段 Context。
        </Callout>
      </Section>
    </div>
  );
}
