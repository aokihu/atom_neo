# Context Management

> **Purpose**: 定义 Agent Context 的分层所有权、Snapshot 注入、事务消费、自动卸载和可观测性。

## 1. 核心原则

Memory 是持久存储，Context 是当前工作集，ContextSnapshot 是一次模型推理实际接收的只读输入。

- 各层把自己的 Context Entry 写入 ContextService，不共享可变 Context 容器。
- `record-context` 适配尚未直接写服务的现有来源；`context-collect` 只请求 Snapshot。
- Snapshot 创建过程只读；一次性数据仅在模型实际接受 Snapshot 且成功后通过 Receipt 提交消费。
- 卸载 Context 只代表后续 Snapshot 不再注入，不等于删除 Memory。
- Observation 与 Instruction 分区，Memory 和 Tool 输出不能获得系统指令权限。
- 最终 Snapshot 只包含 Context，并编码为一段 TOON System Message；Conversation Messages 与 Tool Definitions 保持独立。
- Fragment 字符串必须在 TOON 编码前完成 Unicode 净化；禁止编码后修改 TOON 文本，避免破坏反斜杠转义。

## 2. 分层所有权

| Scope | Owner | 保存内容 | 创建 | 自动释放 |
|---|---|---|---|---|
| `system` | PromptRegistry / ToolRegistry | 安全规则、系统提示、工具协议 | 程序启动 | 程序停止或配置版本变化 |
| `workspace` | AgentsCompilerService / Skill catalog | AGENTS 编译结果、Skill 定义索引 | 打开工作区 | 工作区切换或文件版本变化 |
| `session` | SessionContext / SessionStore | 消息窗口、对话摘要、稳定偏好 | 会话开始 | 显式关闭或 idle TTL |
| `topic` | TopicContext | 当前主题、主题观察、激活 Skill | 识别主题 | 主题切换 |
| `task` | TaskChainContext | 当前目标、Todo、Continuation、Prediction | 根任务开始 | 根任务完成、取消或失败 |
| `step` | StepContext | 当前 Tool 结果、临时 Memory、错误信息 | 模型步骤开始 | 下一步骤消费或步骤结束 |

下一层可以读取上一层，但不能修改上一层。长期 Memory 不属于任何运行时 Scope；检索结果只是 `step` 或 `task` Scope 的投影。

## 3. ContextService 数据模型

```typescript
type ContextScope = "system" | "workspace" | "session" | "topic" | "task" | "step";
type ContextChannel = "instructions" | "messages" | "runtime" | "tool";
type ContextEntry = {
  key: string;
  channel: ContextChannel;
  trust: "trusted" | "untrusted";
  priority: number;
  revision: number;
  content: unknown;
  consumeOnCommit?: boolean;
  expiresAt?: number;
};

type ContextBucket = {
  id: string;
  scope: ContextScope;
  owner: ContextOwner;
  lifecycle: ContextLifecycle;
  entries: Map<string, ContextEntry>;
};

type ContextSnapshot = Readonly<{
  id: string;
  content: string;
}>;

type SnapshotState = {
  id: string;
  status: "active" | "committed" | "released";
  createdAt: number;
  refs: readonly SnapshotRecordRef[];
  receipts: readonly ContextReceipt[];
};
```

同一 Scope 与 Owner 的公共字段只在 Bucket 保存一次；Entry 不重复保存 scope、owner 和生命周期。Snapshot 只保存一段 TOON Context，SnapshotState 留在 ContextService 内部负责 lease、Receipt 和 Replay。

模型侧 Snapshot 示例：

```toon
context[3]{trust,scope,channel,source,content}:
  trusted,workspace,instructions,agents-compiler,"Less Code, More Power."
  untrusted,session,messages,memory,用户的常用地址是上海市示例路 88 号。
  untrusted,topic,messages,memory,查询天气时先解析城市，再调用 weather tool。
```

`pinned`、`expiresAt`、`revision`、Owner 和 Receipt 不进入 TOON，由 ContextService 内部管理。`trust` 必须保留，因为整个 TOON 会作为 System Message 注入，模型仍需区分可信指令与不可信数据。

## 4. 收集与编译

```text
Core producers / record-context
  -> ContextService.put(scope, owner, entry)
  -> context-collect
       1. createSnapshot: 选择匹配 Owner 的 active Bucket
       2. select: 去重、信任分区、预算选择
       3. sanitize: 修复孤立代理字符和不完整的字面量 hex escape
       4. compile: 使用 @toon-format/toon 将选中的 Entry 确定性编码
       5. freeze: 生成精简的不可变 ContextSnapshot
  -> stream-llm
       system = snapshot.content
       messages = ConversationFlowState.userMessages
```

`record-context` 只负责把 Prompt、Workspace、Skill、Memory 和运行状态等 Context 来源适配成统一 Entry；Conversation history 与当前用户消息不写入 ContextService。`context-collect` 是很薄的 Pipeline 边界，只向 ContextService 请求 Snapshot。ContextService 是 Context 的唯一 Owner；Pipeline 和 Session 不保存可变 Context 容器。

Unicode 净化发生在每个 Fragment 的原始字符串上：普通文本和 Message 数组复用 `sanitizeForJSON`，结构化内容通过 TOON `encode` 的 `replacer` 递归净化字符串字段。编码完成的 TOON 不再进行字符串替换，因此 Snapshot 保持可解码，同时不会把孤立代理字符带入 DeepSeek 请求。

## 5. Snapshot 与 Receipt

```text
createSnapshot -> acquire lease -> model success -> commitSnapshot
                                      failure -> releaseSnapshot
```

- 构建 Snapshot 时禁止删除 Session、Topic、Task 或 Step 数据。
- `once` Fragment 仅在模型实际接受 Snapshot 且步骤成功后消费；本地 fallback、失败、取消或超时均不消费。
- 失败、取消或超时不提交 Receipt，数据保留给重试。
- commit/release 必须幂等；重复事件不得重复产生副作用。
- 在途 Snapshot 持有 lease，Owner 清理不得破坏正在执行的推理。

## 6. Turn 与 Step Snapshot

- TaskSnapshot 在根任务开始时固定 system、workspace 和基础 session revision。
- Skill revision 变化时，`prepareStep` 向 ContextService 请求新的 Snapshot，并只替换下一步骤的 TOON System Message。
- Skill load/unload 在下一模型步骤生效，topic 切换时清空当前 Session 的激活 Skill。
- Skill Tool 只返回加载回执，不把 Skill 正文写入 Tool history；正文仅存在于可替换的 StepSnapshot。
- Memory 不在每个步骤重复检索，Tool 结果由步骤消息自然追加。

`read_memory` 提供 `injectToContext` 参数：

| 参数值 | 行为 | 生命周期 |
|---|---|---|
| 不传（默认） | 完整 Memory 只作为当前 Tool Result 进入后续模型步骤 | 当前 Tool Loop |
| `{ retention: "pinned" }` | 写入 Session，并标记为预算保护数据 | 当前 Session；Session 结束时卸载 |
| `{ retention: "ttl", ttlSeconds: 900 }` | 写入当前 Topic，并设置条目过期时间 | TTL 到期时卸载；没有 Topic 时暂存于 Session |

`pinned` 适合家庭地址、长期偏好等需要在整个会话中持续可用的信息。`ttl` 适合天气查询方法、阶段性工作说明等临时信息；再次读取并注入同一条 Memory 会刷新过期时间，没有再次使用则自动卸载。

过期时间属于 Memory 条目，而不是整个 Topic Bucket，因此一条临时 Memory 到期不会清除同层级的其他 Context。持久注入只是创建 Memory 的运行时 Context 投影，不复制或修改原始 Memory。Memory 始终按 `untrusted` 数据处理，不能进入 `instructions`。

## 7. 长任务的 Turn 生命周期

Context Snapshot 成功并不代表整个用户任务完成。长任务以 Session 中的结构化 TODO 作为完成边界：

```text
LLM Turn 结束
  -> check-follow-up 检查 active TODO
       -> 有 pending/in_progress: chainAction=follow_up
       -> 全部 completed/cancelled: 允许结束
  -> Task.Completed 先保存 Assistant 消息
  -> 再调度下一轮 Conversation 或 post-conversation
```

这样下一轮 Snapshot 和 Conversation Messages 都建立在已提交的上一轮结果之上，避免续写重复，也避免 post-conversation 在消息落盘前误判为空回复。质量检查不注入完整长文本，只使用回复开头、结尾、长度、TODO 状态和模型结束原因。

## 8. 预算策略

```text
inputBudget = contextLimit - outputReserve - toolSchemaReserve - safetyMargin
```

保留顺序：

1. 系统与 Workspace 规则。
2. 当前任务状态和激活 Skill。
3. Session、Topic 与相关 Memory。
4. 低优先级观察数据。

Context 预算已为 Conversation Messages、Tool Definitions 和模型输出预留空间。预算淘汰以完整 Fragment 为单位，不截断内容。大型 Tool 输出留在 Artifact，只注入摘要、Hash 和读取引用。

## 9. 生命周期操作

| 操作 | 含义 | 是否删除持久数据 |
|---|---|---|
| `expire` | 标记过期，后续 Snapshot 不再包含 | 否 |
| `dispose` | 释放内存、句柄和缓存 | 否 |
| `forget` | 删除持久 Memory | 是，必须显式调用 |

ContextService 直接接收写入；EventBus 只发送生命周期事件，不传递大段 Context。自动清理触发器：step 完成、根任务结束、topic change、session close、idle TTL、workspace revision 变化和进程停止。

状态转换：`active -> expired -> disposed`。expired 数据不再进入新 Snapshot；只有 lease 归零后才能 disposed。

## 10. 可观测性

每次模型调用必须关联 `snapshotId`。Manifest 记录元数据，不记录敏感正文：

- Fragment key、source、scope、revision 和 content hash。
- estimated tokens、selected/dropped 和原因。
- Snapshot budget、编译顺序和 prefix hash。
- committed/released Receipt。

ContextService 通过 Snapshot ID 保存 SnapshotState 与紧凑 Manifest；Pipeline 只携带精简 Snapshot。Replay 通过 `inspectSnapshot(snapshotId)` 查询，不把生命周期元数据注入模型。

## 11. 迁移顺序

1. 引入 ContextService、Bucket、Entry、SnapshotState 和精简 Snapshot。
2. 将 system/workspace/session/topic/task/step 数据迁入 ContextService。
3. 将 context-collect 缩减为 `createSnapshot()` 调用。
4. 接入 commit/release、lease 与 EventBus 生命周期。
5. 接入定时 expiry sweep、Manifest/Replay 和 inspect API。
6. 删除 Session 与 Pipeline 中旧的 Context 拼接和消费逻辑。

## 12. 当前落地状态

| 能力 | 当前实现 | 状态 |
|---|---|---|
| ContextService / Bucket / Entry | Core 内唯一 Context Owner | 已完成 |
| TOON Snapshot / SnapshotState | 单独 System Message 与管理元数据分离 | 已完成 |
| Snapshot commit/release/lease | 成功消费、失败保留、在途保护 | 已完成 |
| 分层预算与 trust 分区 | 以 Entry 为单位选择，禁止 untrusted instruction | 已完成 |
| EventBus 生命周期 | Session/Topic/Task/Step 结束通知 ContextService | 已完成 |
| Manifest / Replay | SnapshotState 内保存并通过 ID 查询 | 已完成 |
| Memory 分级持久注入 | `pinned` 跟随 Session；`ttl` 跟随 Topic 并自动卸载 | 已完成 |
| 大型 Tool Artifact 引用 | 当前仅保存 Tool history 摘要 | 需要开发 |

ContextBucket 负责管理，SnapshotState 负责追踪，ContextSnapshot 只负责给模型看。
