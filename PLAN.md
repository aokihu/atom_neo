# PLAN.md — Context Compression Pipeline

> 长会话 token 接近上限时自动压缩早期消息。
> 详细设计见 [docs/milestones/P12-context-compression.md](docs/milestones/P12-context-compression.md)。

---

## 1. 定位

在 evaluator 检测到 `tokenUsage > 80%` 时触发，压缩早期消息 → 归档 → 释放上下文 → 续写。

```
evaluate-finalize → orchestrator.scheduleCompress()
  → context-compress pipeline:
      compress-input → compress-summarize → compress-finalize
```

---

## 2. Pipeline 结构

```
compress-input (source) → compress-summarize (transform) → compress-finalize (sink)
```

| Element | 职责 |
|---------|------|
| compress-input | 取保留最后 20 条前的 user/assistant 消息，格式化文本 |
| compress-summarize | basic 模型 + generateText 生成 500 字摘要 |
| compress-finalize | 归档 JSONL → session.replaceEarlyMessages(20) → 存 conversationSummary → scheduleConversation |

---

## 3. 关键设计

- **摘要不混入消息列表**：存在 `session.conversationSummary`，由 `collect-context` 注入 system prompt
- **归档到文件**：`$SANDBOX/.atom/session-history/{sessionId}-{date}-{counter}.jsonl`
- **串行执行**：先压缩再续写，确保 LLM 有最大上下文空间

---

## 4. 改动清单

| # | 文件 | 操作 |
|---|------|------|
| 1 | `pipelines/context-compress/` (6 files) | 新建 |
| 2 | `session/context.ts` | +`replaceEarlyMessages()` + `conversationSummary` |
| 3 | `session/archiver.ts` | 新建 — `archiveMessages()` |
| 4 | `collect-context.ts` | +读 summary 注入 system prompt |
| 5 | `evaluate-finalize.ts` | +token>80% 分流 |
| 6 | `server.ts` | +pipelineBuilder |
| 7 | `pipelines/index.ts` | +导出 |

---

## 5. 验收标准

1. [ ] tokenUsage > 80% 触发压缩
2. [ ] 消息写入 JSONL 归档
3. [ ] session.messages 只保留 20 条
4. [ ] conversationSummary 注入 system prompt
5. [ ] 压缩后自动续写
6. [ ] 现有 148 tests 全部通过
