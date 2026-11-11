# Tool Result 与 Context 治理 — 实施记录（历史）

> **状态**：历史实施计划与完成标准。当前规范以 [context-outcome-governance.md](../context-outcome-governance.md) 为准。

## 5. 实施阶段

### Phase 1 — 契约与归一化

- shared types 只保留 `ToolResult.content` 与 `ToolResult.metadata`。
- 删除通用 `output`、`data`、`code`、`status`、`progress`、`evidenceWeight`。
- Tool 需要结构化 LLM 结果时直接把对象放入 `content`，不再同时维护文本与 data。

### Phase 2 — 执行与治理

- 将 Tool schema 与 executor 分离；AI SDK 只接收不带 `execute` 的 schema Tool。
- Stream 层改为单 step 手工循环，统一执行 Tool、读取 metadata 并写入 Session 审计记录。
- ToolDefinition 使用 `allowSameToolBatch` 显式声明无副作用查询 Tool 是否允许同 step 多调用；
  未声明、写入/控制 Tool 及 MCP/插件 Tool 默认单次。
- 同一 step 混合不同 Tool，或对非 batchable Tool 发出多个 Call 时，整批拒绝；合法同名批次
  仍按 Call 顺序执行，整批结果返回后才进入下一模型 step。
- 所有 Tool schema 始终开放，由 LLM 自主决定调用顺序与次数；框架不再动态收窄 `activeTools`。
- Prediction 不执行 Memory 查询；Memory、Skill、WebFetch 全部由 Conversation LLM 自主调用。
- Prompt 要求 LLM 在 WebFetch 前先查询 Memory 与 Skill；框架不维护或强制该业务前置状态。
- 不使用 provider-specific `toolChoice`，也不维护 Memory review、retry、Skill load 或 WebFetch
  前置路由状态。
- ToolCallLedger 根据 `metadata.effect !== "none"` 判断有效进展。
- 连续无进展只生成辅助判断提示，不隐藏 Tool、不阻止下一次正常调用；完全重复调用与执行总上限
  才触发强制循环保护。
- 删除普通 `tool-history` Context 写入，只保留 `contextInjection`。
- 所有实际执行的 Call/Result 投影到当前 Conversation；Conversation 结束后不自动持久化。
- 增加重复空结果、重复错误和改变查询后恢复的测试。

### Phase 3 — 内置 Tool 迁移

- Search/grep/glob 的无匹配返回 `ok:true/effect:"none"`，且没有 content。
- 参数、网络、进程失败返回 `ok:false/effect:"none"`。
- 文件写入、Memory/Skill 生命周期变化返回 `ok:true/effect:"state_changed"`。
- 读取到有效内容返回 `ok:true/effect:"evidence"`。
- MCP 由其结构映射为 `reference`、`none` 或失败，不解析自然语言，也不接受旧 Outcome 字段。
- MCP 成功结果统一使用 `effect:"reference"`：当前 conversation 的后续 steps 完整可用并算策略进展，但在 Post/Compact
  中不能单独支撑已完成结论；明确 `isError` 或结构为空使用 `effect:"none"`。
- Memory 摘要与完整读取均使用 `effect:"reference"`；读取成功只表示取得参考内容，不等于已经验证与当前任务相关。
- `realtime_data` 与 `temporary_state` 保存时由框架补充有效期，过期节点不再参与搜索、读取和遍历。
- WebFetch 对 HTML 结果按当前任务查询抽取相关片段；相关词覆盖不足时返回
  `ok:true/effect:"none"`，不把“大页面存在正文”直接升级为 evidence。

### Phase 4 — Prediction 与 Post

- Prediction 保持当前 User 原文不变，并附带当前 Topic 与上一轮有界上下文，使用
  `Output.object` 返回结构化分类。
- `standalone` 只投递当前 User；`follow_up` 只保留最近一组 User/Assistant 交互和当前 User。
- Prediction 不生成查询词，不修改 User 原文，不调用任何 Tool。
- Post 收集结构化 effect 统计和 Assistant 完成元数据。
- Post retry suggestion 降为 untrusted message/reference。
- 增加 Assistant 错误自述不会压过 User 请求或工具证据的测试。

### Phase 5 — Compact

- Compact Input 增加可摘要消息筛选和来源标签。
- 更新摘要 Prompt 的事实优先级。
- 增加错误/empty 不进入摘要、有效 User 决策仍保留的测试。

### Phase 6 — 全链路验证

- `bun test`
- `bun run typecheck`
- `bun run build`
- 文档 SSR bundle
- `bun why` 依赖收敛检查
- `git diff --check`
- 使用失败日志场景构造回归测试：同一失败查询不会被视为进展，改变查询后可以继续。

## 6. 完成标准

- 任一 Tool 的语义效果无需解析 `content` 即可判定。
- error/empty 不会出现在新生成的 Topic/Session Context Snapshot 或 Compact Summary 输入中。
- 所有实际执行的 Tool Result 都返回当前 Conversation 的后续 step，框架不按 effect 筛选。
- 所有 Tool schema 始终开放；WebFetch 与 Memory/Skill 一样由 LLM 决定是否调用。
- Prediction 只返回结构化分类，不执行 Memory 查询或生成 Tool 参数。
- standalone/follow-up 不再携带无关会话历史；短期 Memory 过期后不可检索。
- WebFetch HTML 只向下一模型 step 投影相关片段。
- 连续 `effect:none` 只触发辅助提示；完全重复调用或执行总上限才阻止 Tool Loop。
- 框架不丢弃模型最终文本。
- Prediction 输入与 Conversation 当前 User 输入保持逐字一致。
- Post 不会仅凭 Assistant 自述判定任务完成，retry suggestion 不是 trusted instruction。
- 现有 `contextInjection` 的 Memory/Skill 投影行为保持兼容。

## 7. 非目标

- 不删除 Session JSONL 审计历史。
- 不引入新的 Memory 检索或语义相关性模型。
- 不通过关键词解析 Tool `content` 推断 effect。
- 不重写全部 Plugin/MCP；本次只提供统一兼容入口和内置 Tool 迁移路径。
