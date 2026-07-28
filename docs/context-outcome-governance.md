# Tool Outcome 与 Context 治理改造计划

> **Purpose**: 用框架可识别的 Tool Outcome 统一工具结果、进度判定、跨轮 Context、Prediction、Post 与 Compact，避免错误或空结果持续污染后续推理。

---

## 1. 问题与目标

同一搜索在新 Session 中可以成功，但在长 Session 中会被旧查询、旧错误和旧 Assistant 推测持续牵引。
根因不是单个 WebFetch 实现，而是框架当前把三个不同概念混在一起：

1. `ok` 只表示调用是否返回，不能表达是否取得有效证据或产生状态变化。
2. 工具结果既用于当前工具循环恢复，又被写入跨轮 Context。
3. Prediction、Post 与 Compact 把 Assistant 叙述当成接近事实的历史。

本次改造覆盖所有 Tool，不为 WebFetch 添加特例。目标是：

- Tool 直接返回框架可识别的结构化 Outcome。
- 无效结果由框架审计和状态机消费，不把原始 Tool Call / Tool Result 交给后续模型 step。
- 只有明确的 Context Injection 可以进入跨轮 Context；普通结果不再自动沉淀。
- Tool Governance 根据 `progress` 而不是 `ok` 判断是否真正前进。
- Prediction 以 User 请求为主，Assistant 只作为低权重参考。
- Post 使用工具证据和完成元数据校验 Assistant 声明。
- Compact 只总结有资格的可见消息，并忽略无效工具残留。

## 2. 统一数据契约

```typescript
type ToolOutcomeStatus =
  | "success"
  | "empty"
  | "error"
  | "blocked"
  | "deferred"
  | "cancelled";

type ToolProgress = "evidence" | "state_changed" | "none";

type ToolOutcome = {
  status: ToolOutcomeStatus;
  progress: ToolProgress;
  evidenceWeight?: "primary" | "reference";
  code?: string;
};

type ToolResult = {
  ok: boolean;                 // 兼容执行协议；不再用于判定语义进度
  output: string;              // 仅供当前工具循环消费
  error?: string;
  data?: unknown;
  outcome?: ToolOutcome;       // 迁移期可选，由统一函数补齐 legacy 结果
  contextInjection?: ToolContextInjection;
  metadata?: ToolResultMetadata;
};
```

### 状态矩阵

| status | 含义 | progress | 下一模型 step | 跨轮 Context |
|--------|------|----------|----------------|--------------|
| `success` | 获得可用事实 | `evidence` | 保留 Call + 安全 Result | 仅显式 Injection |
| `success` | 写入或状态操作完成 | `state_changed` | 保留 Call + 安全 Result | 仅显式 Injection |
| `empty` | 执行成功但没有结果 | `none` | Call + Result 整组丢弃 | 丢弃 |
| `error` | 参数、传输或执行失败 | `none` | Call + Result 整组丢弃 | 丢弃 |
| `blocked` | 框架策略禁止执行 | `none` | Call + Result 整组丢弃 | 丢弃 |
| `deferred` | 前置条件不足，尚未执行 | `none` | Call + Result 整组丢弃 | 丢弃 |
| `cancelled` | 用户或任务取消 | `none` | Call + Result 整组丢弃 | 丢弃 |

`ok` 与 `status` 不等价：`empty` 和 `deferred` 可以是协议层 `ok: true`，但必须是
`progress: "none"`。框架禁止通过解析 `output` 文本判断这些状态。

## 3. Context 边界

```
ToolResult
  ├─ ToolCallLedger           outcome + fingerprint + 计数，不注入 LLM
  ├─ Conversation evidence    仅 success，供当前手工循环
  ├─ Session tool result      结构化审计记录，不作为 Prompt Context
  └─ ContextService           仅 contextInjection 显式投影
```

规则：

- 删除普通 Tool Result 自动生成 `tool-history` Context 的行为。
- AI SDK 只负责单 step Tool Call 解析，Tool 不向 SDK 提供 `execute`；执行与循环由 Atom 控制。
- 无效结果对应的 Assistant Tool Call 与 Tool Result 必须整组删除，避免 AI SDK 的 missing result 校验和
  response messages 累积污染。
- `error`、`empty`、`blocked`、`deferred`、`cancelled` 不进入 Topic/Session Context。
- `success` 也不自动持久化正文，避免旧证据无限累积；需要跨轮使用时由 Tool 返回
  `contextInjection`，沿用现有 scope、TTL、pin 与 trust 边界。
- Session 中的结构化 ToolResult 可用于 TUI、日志和诊断，但 Prediction、Post、Compact 只能读取
  经过筛选的投影，不能把审计记录整段重新注入模型。

## 4. Pipeline 权重调整

### Prediction

- 最近 User 消息是主输入，保持完整或高字符预算。
- 历史 User 消息提供主题延续信息。
- Assistant 消息单列为 `assistant_reference`，字符预算更低，并明确标记为未验证参考。
- 不把 Assistant 的搜索词或结论混入 User 历史字段。

### Post

- 保留 Assistant 回复用于质量检查，但显式标记为 `claim`。
- 同时提供本轮 Tool Outcome 摘要：有效证据数、状态变更数、empty/error/blocked 数和 finish metadata。
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

- 在 shared types 中增加 `ToolOutcome`、状态与进度类型。
- 提供唯一的 `resolveToolOutcome(result)` 兼容函数。
- Legacy ToolResult 回退规则：`ok:false → error/none`，`ok:true → success/evidence`。
- 为归一化矩阵增加单元测试。

### Phase 2 — 执行与治理

- 将 Tool schema 与 executor 分离；AI SDK 只接收不带 `execute` 的 schema Tool。
- Stream 层改为单 step 手工循环，统一执行 Tool、解析 Outcome 并写入 Session 审计记录。
- ToolCallLedger 由 `ok` 改为 `progress !== "none"`。
- Guard 的阻塞结果显式返回 `blocked/deferred` 与稳定 code。
- 删除普通 `tool-history` Context 写入，只保留 `contextInjection`。
- 只有 `evidence/state_changed` 可以投影到下一模型 step；无效 Call/Result 整组丢弃。
- 增加重复空结果、重复错误和改变查询后恢复的测试。

### Phase 3 — 内置 Tool 迁移

- Search/grep/glob 的无匹配返回 `empty/none`。
- 参数、网络、进程失败返回 `error/none`。
- 用户取消返回 `cancelled/none`。
- 文件写入、Memory/Skill 生命周期变化返回 `success/state_changed`。
- 读取到有效内容返回 `success/evidence`。
- MCP 与旧 Plugin 先通过兼容函数工作，不强制一次性迁移外部生态。
- MCP 成功结果统一标为 `evidenceWeight:"reference"`：当前 conversation 的后续 steps 完整可用并算策略进展，但在 Post/Compact
  中不能单独支撑已完成结论；明确 `isError`、结构为空或显式无进展 Outcome 仍为 `progress:"none"`。

### Phase 4 — Prediction 与 Post

- Prediction 输入拆分 User 主上下文与 Assistant Reference。
- Post 收集结构化 Outcome 统计和 Assistant 完成元数据。
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

- 任一 Tool 的语义状态无需解析 `output` 即可判定。
- error/empty 不会出现在新生成的 Topic/Session Context Snapshot 或 Compact Summary 输入中。
- Agent 不读取原始失败内容；框架通过 Tool 可用性、Guard 状态和最小 step instruction 控制下一步。
- 能力发现链进入下一状态后，前一状态的工具从 `activeTools` 移除，避免模型重复执行已判定为空的动作。
- 连续 `progress:none` 会触发已有 no-progress 保护；新的 evidence/state change 可以解除重复保护。
- 因连续无进展停止且整轮没有有效 evidence/state change 时，不接受模型随后生成的具体事实断言。
- Prediction 的 User 请求与 Assistant Reference 在数据结构和 Prompt 中明确分离。
- Post 不会仅凭 Assistant 自述判定任务完成，retry suggestion 不是 trusted instruction。
- 现有 `contextInjection` 的 Memory/Skill 投影行为保持兼容。

## 7. 非目标

- 不删除 Session JSONL 审计历史。
- 不引入新的 Memory 检索或语义相关性模型。
- 不通过关键词解析 Tool `output` 推断 Outcome。
- 不重写全部 Plugin/MCP；本次只提供统一兼容入口和内置 Tool 迁移路径。
