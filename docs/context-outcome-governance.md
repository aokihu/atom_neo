# Tool Result 与 Context 治理

> **Purpose**: 严格分离 LLM 需要的 Tool 内容与运行框架需要的元数据，避免重复字段、无效结果和错误内容污染后续推理。

---

## 1. 问题与目标

同一搜索在新 Session 中可以成功，但在长 Session 中会被旧查询、旧错误和旧 Assistant 推测持续牵引。
根因不是单个 WebFetch 实现，而是框架当前把三个不同概念混在一起：

1. `ok` 只表示调用是否返回，不能表达是否取得有效证据或产生状态变化。
2. 工具结果既用于当前工具循环恢复，又被写入跨轮 Context。
3. Prediction、Post 与 Compact 把 Assistant 叙述当成接近事实的历史。

本次 ToolResult 契约改造覆盖所有 Tool。目标是：

- Tool 只返回一份 LLM 内容和一份框架元数据。
- 所有已执行 Tool 的结果都交给当前 Conversation 的后续模型 step，框架不替 LLM 筛选。
- 只有明确的 Context Injection 可以进入跨轮 Context；普通结果不再自动沉淀。
- Tool Governance 根据 `metadata.effect` 判断是否真正前进。
- Prediction 只读取当前 User 原文，不读取 Assistant。
- Post 使用工具证据和完成元数据校验 Assistant 声明。
- Compact 只总结有资格的可见消息，并忽略无效工具残留。

## 2. 统一数据契约

```typescript
type ToolEffect = "none" | "reference" | "evidence" | "state_changed";

type ToolResult =
  | {
      content?: unknown; // 唯一提供给 LLM 的结果
      metadata: {
        ok: true;
        effect: ToolEffect;
        contextInjection?: ToolContextInjection;
      };
    }
  | {
      metadata: {
        ok: false;
        effect: "none";
        error: string; // 框架诊断字段；失败时序列化为简洁 Tool Result 供 LLM 判断
        errorSource: "guard" | "runtime" | "tool";
      };
    };
```

### Effect 矩阵

| effect | 含义 | 下一模型 step | 跨轮 Context |
|--------|------|----------------|--------------|
| `evidence` | 获得可用于当前结论的主要证据 | 投影 content | 仅显式 Injection |
| `reference` | MCP/Memory 等当前轮参考结果 | 投影 content | 默认不写入，不能单独证明完成 |
| `state_changed` | 写入或状态操作完成 | 按需投影 content | 仅显式 Injection |
| `none` | 成功执行但没有可用结果 | 投影空结果 | 不持久化 |

失败结果由 `metadata.ok:false` 表达，并作为本轮 Tool Result 返回给 LLM；所有 Tool schema 始终
向模型开放。框架禁止通过解析 `content` 文本判断 effect。

## 3. Context 边界

```
ToolResult
  ├─ ToolCallLedger           effect + fingerprint + 计数，不注入 LLM
  ├─ Conversation Tool Loop   所有 Call + Result，供当前手工循环
  ├─ Session tool result      结构化审计记录，不作为 Prompt Context
  └─ ContextService           仅 contextInjection 显式投影
```

规则：

- 删除普通 Tool Result 自动生成 `tool-history` Context 的行为。
- AI SDK 只负责单 step Tool Call 解析，Tool 不向 SDK 提供 `execute`；执行与循环由 Atom 控制。
- Tool Call 与 Tool Result 必须保持配对；完整 empty/error 只存在于当前 Conversation。只有真实
  Tool 执行会留下有界 ToolRecord，并在后续 Context 中出现摘要。
- 多 Call step 必须是显式允许的同名批次。批次校验先于任何 executor；非法批次的全部 Call
  返回配对错误，记录 blocked/no-progress，但不计入真实 execution，也不产生部分副作用。
- 有效 content 不自动成为 Prompt Context，避免旧证据无限累积；真实执行的有界详情进入审计型
  ToolRecord。需要把证据正文跨轮注入 Prompt 时，仍由 Tool 返回 `contextInjection`，沿用现有
  scope、TTL、pin 与 trust 边界。
- Session 中的结构化 ToolResult 可用于 TUI、日志和诊断，但 Prediction、Post、Compact 只能读取
  经过筛选的投影，不能把审计记录整段重新注入模型。

### ToolRecord 与框架错误边界

Tool 历史只记录已经真实进入 executor 的调用：成功结果和 Tool 自身返回或抛出的真实错误。
Guard 拒绝与 executor 缺失、结果协议缺失等 Runtime 错误只返回当前 Tool Loop 并写日志，不进入
ToolRecord。失败 metadata 使用结构化 `errorSource: "guard" | "runtime" | "tool"`，禁止根据
错误字符串前缀反推来源；即使不写历史，也必须保留 AI SDK 要求的 Call/Result 配对。

| 结果来源 | Tool 已执行 | 返回当前 LLM step | 写入 ToolRecord |
|---|---:|---:|---:|
| Tool 成功 | 是 | 是 | 是 |
| Tool 真实失败 | 是 | 是 | 是 |
| Guard 拒绝 | 否 | 是 | 否 |
| Runtime/协议错误 | 否 | 是 | 否 |
| `request_tool_record(s)` | 是 | 是 | 否 |

### Conversation ToolsGroup

一次 Conversation 在首次产生可记录结果时懒创建一个 `ToolsGroupID`。同一 Conversation 内所有
可记录结果共享该 Group，`Step` 从 1 连续递增；新 Conversation 创建新 Group 并重新从 1 开始。
Guard、Runtime 错误和历史查询 Tool 不占用 Step。记录 ID 固定为
`{ToolsGroupID}-{Step}`；`modelStep` 与同名批次的 `batchIndex` 单独保存。

### 摘要常驻、详情按需

有界的完整 input/output/error 保存在 ToolRecordStore，超限详情会标记 `truncated`。ContextService 只接收 ToolsGroup 摘要和最近记录的
`id/tool/status/inputSummary/resultSummary`，使用 `channel="tool"`、`trust="untrusted"`。
结构化摘要由 Context compiler 统一编码为 TOON，不提前拼接 TOON 字符串。

`request_tool_record` 使用 `{ToolsGroupID}-{Step}` 读取单条详情；`request_tool_records` 按 Group、
Step 范围、状态或 ID 集合分页读取。两者设置 `recordPolicy="exclude"`，只返回当前 Tool Loop，
不会生成新历史或摘要。

## 4. Pipeline 权重调整

### Prediction

- 只读取当前 User 原文，不读取历史 User、Assistant 或 Tool 内容。
- 使用 `Output.object` 返回结构化分类，不从自由文本提取 JSON。
- 保留 difficulty、modelProfile、intent、contextRelevance、topic 与 reasoning。
- 不生成 memoryQuery，不调用 Tool，也不修改用户输入。

### Post

- 保留 Assistant 回复用于质量检查，但显式标记为 `claim`。
- 同时提供本轮 Tool effect 摘要：主要证据数、参考证据数、状态变更数、无结果数和失败数。
- `satisfactory` 不能只根据 Assistant 自述“已完成”；需要与请求类型和工具证据一致。
- Post 生成的 retry suggestion 保持 `untrusted`，只作为下一轮参考，不能升级为 trusted instruction。

### Compact

- 压缩前按框架元数据筛选消息，不把无效 Tool Result 或内部工具反馈放入摘要输入。
- Assistant 内容加上“未验证叙述”标签，摘要 Prompt 优先保留 User 目标、已验证 Tool evidence、
  已确认决策和真实状态变化。
- 旧 Session 中无法识别的工具文本默认不提升为事实。
- 原始 JSONL 归档仍保持完整，便于审计；“不进入摘要”不等于删除历史文件。

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

- Prediction 只读取当前 User 原文，并使用 `Output.object` 返回结构化分类。
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
