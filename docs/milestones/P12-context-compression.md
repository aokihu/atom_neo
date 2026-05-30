# P12: Context Compression Pipeline — 设计文档

> 长会话 token 接近上限时自动压缩早期消息，释放上下文空间，保持对话可持续。

---

## 1. 架构

```
evaluate-finalize: tokenUsage > 80%
  → orchestrator.scheduleCompress()
    → context-compress pipeline:
        ① compress-input:     取最早消息（保留最近 20 条），格式化为摘要文本
        ② compress-summarize: basic 模型生成摘要（非流式，500 字内）
        ③ compress-finalize:  归档旧消息 → 删除 → 存摘要 → 续写 conversation
```

### 消息压缩策略

```
session.messages = [m1, m2, ..., m50]
  ├── 压缩范围: 保留最后 20 条之前的所有 user/assistant 消息
  │      → LLM 生成摘要 → 存入 session.conversationSummary
  │      → 原始消息写入 JSONL 归档文件
  │      → 从内存删除
  └── 保留范围: 最近 20 条
         → 单条超过 2000 字的做截断
```

---

## 2. Pipeline 结构

和 prediction / evaluator 同构：

```
compress-input (source) → compress-summarize (transform) → compress-finalize (sink)
```

### 2.1 compress-input (source)

```
输入: { task, session }
逻辑:
  ① msgs = session.messages.filter(role === "user" || "assistant")
  ② keep = 20
  ③ toCompress = msgs.slice(0, -keep)    // 保留最后 20 条
  ④ toKeep = msgs.slice(-keep)
  ⑤ 对 toKeep 中单条 > 2000 字的做截断
输出: { mode: "summarizing", task, session,
         archiveMessages: Message[],      // 待归档的原始消息完整副本
         summaryText: string }            // 格式化后的待压缩文本
```

### 2.2 compress-summarize (transform)

basic 模型 + `generateText`（非流式）生成摘要。

```
System Prompt: 将以下对话历史总结为 500 字以内的摘要，保留关键信息、决策和进展。
```

### 2.3 compress-finalize (sink)

```
① 归档: archiveMessages 写入
   $SANDBOX/.atom/session-history/{sessionId}-{YYYYMMDD}-{counter}.jsonl

② 删除: session.replaceEarlyMessages(keep=20)

③ 存摘要: session.conversationSummary = summary

④ 续写: orchestrator.scheduleConversation()
```

---

## 3. 归档格式

```
$SANDBOX/.atom/session-history/{sessionId}-{YYYYMMDD}-{counter}.jsonl
```

每行一条消息完整快照：

```jsonl
{"role":"user","content":"帮我做性能分析","timestamp":1716988800000}
{"role":"assistant","content":"好的，开始分析...","timestamp":1716988801000}
```

---

## 4. 摘要注入

摘要存入 `session.conversationSummary`（临时字段），由 `collect-context` 注入 system prompt：

```
[对话历史摘要]
历史对话涉及性能分析、日志排查、代码优化三个方向...
```

---

## 5. 两个触发入口

| 入口 | 条件 | 调用方 |
|------|------|--------|
| 系统自动 | tokenUsage > contextLimit × 80% | evaluate-finalize |
| 用户/Tool | LLM 调用 `compress_context` tool | bootstrap.ts（预留） |

---

## 6. 改动清单

| # | 文件 | 操作 |
|---|------|------|
| 1 | `pipelines/context-compress/elements/types.ts` | 新建 |
| 2 | `pipelines/context-compress/elements/compress-input.ts` | 新建 |
| 3 | `pipelines/context-compress/elements/compress-summarize.ts` | 新建 |
| 4 | `pipelines/context-compress/elements/compress-finalize.ts` | 新建 |
| 5 | `pipelines/context-compress/elements/index.ts` | 新建 |
| 6 | `pipelines/context-compress/index.ts` | 新建 |
| 7 | `session/context.ts` | +`replaceEarlyMessages()` + `conversationSummary` |
| 8 | `session/archiver.ts` | 新建 — `archiveMessages(sessionId, messages)` |
| 9 | `conversation/elements/collect-context.ts` | +读 `conversationSummary` |
| 10 | `follow-up-evaluator/elements/evaluate-finalize.ts` | +token>80% 分流 |
| 11 | `server.ts` | +`context-compress` pipelineBuilder |
| 12 | `pipelines/index.ts` | +导出 compress pipeline |

---

## 7. 测试

| 场景 | 说明 |
|------|------|
| compress-input 选消息 | 50 条 → 压缩前 30 条，保留后 20 条 |
| compress-summarize fallback | 无 apiKey → 返回空摘要 |
| compress-finalize 归档 + 删除 | 消息写入 JSONL + replaceEarlyMessages(20) |
| collect-context 注入摘要 | conversationSummary → system prompt 出现摘要 |
| evaluate-finalize 分流 | tokenUsage>80% → scheduleCompress |

---

## 8. 验收标准

1. [ ] tokenUsage > 80% 触发压缩
2. [ ] 被压缩消息写入 JSONL 归档
3. [ ] session.messages 只保留最近 20 条
4. [ ] conversationSummary 正确注入 system prompt
5. [ ] 压缩完成后自动续写
6. [ ] 现有 148 tests 全部通过
