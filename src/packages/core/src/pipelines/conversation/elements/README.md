# Conversation Elements

当前主链路：

`collect-prompts -> record-context -> collect-context -> stream-llm -> token-ratio -> check-follow-up -> finalize`

| 文件 | 职责 |
|---|---|
| `collect-prompts.ts` | 从 Session 读取可见消息窗口 |
| `record-context.ts` | 将 Prompt、Workspace、Topic、Task 与 Memory 投影写入 ContextService；Conversation Messages 保持独立 |
| `collect-context.ts` | 仅向 ContextService 请求精简 Snapshot |
| `stream-llm.ts` | 将 TOON Snapshot 作为 System Message 调用模型，并记录 Step、Tool 与 Skill 变化 |
| `check-follow-up.ts` | 解析模型返回的后续动作 |
| `finalize.ts` | 发布 Snapshot commit/release，并完成 Pipeline |
| `types.ts` | Conversation FlowState |

`load-system-prompt`、`fetch-agents-prompt`、`format-*` 与 `inject-skill-context` 保留为兼容元素，不在当前主链路重复处理 Context。
