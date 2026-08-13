# Conversation Elements

当前主链路：

`collect-prompts -> record-context -> apply-source-context -> collect-context -> stream-llm -> token-ratio -> check-follow-up -> finalize`

| 文件 | 职责 |
|---|---|
| `collect-prompts.ts` | 从 Session 读取可见消息窗口 |
| `record-context.ts` | 将 Prompt、Workspace、Topic、Task 与 Memory 投影写入 ContextService；Conversation Messages 保持独立 |
| `apply-source-context.ts` | 应用显式 Source Context，不读取 Session Tool 审计结果 |
| `collect-context.ts` | 仅向 ContextService 请求精简 Snapshot |
| `stream-llm.ts` | 将 TOON Snapshot 作为 System Message 单步调用模型，手工执行 Tool Loop，并记录 Outcome、Guard 与 Skill 变化 |
| `tool-loop.ts` | schema-only Tool、progress Context 投影、最小 step instruction 与 Tool Call 文本清理 |
| `check-follow-up.ts` | 区分无计划 `follow_up` 与有计划 `continue_todo` |
| `finalize.ts` | 发布 Snapshot commit/release，并把 Chain/Post-check 决策交给 Task.Completed |
| `types.ts` | Conversation FlowState |

`load-system-prompt`、`fetch-agents-prompt`、`format-*` 与 `inject-skill-context` 保留为兼容元素，不在当前主链路重复处理 Context。
