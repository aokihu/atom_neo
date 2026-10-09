# 统一续写仲裁验收记录

## v1.18.0 交付快照（2026-10-09）

- 升级根应用版本：1.17.0 → 1.18.0，package.json 与 src/version.ts 同步；各 workspace 的独立版本不变。
- 交付范围：完整续写保存、统一续写仲裁、受限 TODO 核对、双层目标执行预算、JEV 健康检查与一次 LLM 回退、ROUNDS 及可滚动 TODO 侧栏。
- 目标确认完成后 ROUNDS/WINDOW 归零显示，实际预算累计保留；默认成功、暂停、待用户输入及仅 TODO 全部完成不确认目标完成。TODO 用一行 Unicode 状态统计保留总数和当前位置。
- 当前完整测试：1318 pass、13 skip、0 fail；五个 workspace 类型检查和构建通过。日志：`/tmp/atom-rounds-compact-full-test.log`、`/tmp/atom-rounds-compact-typecheck.log`、`/tmp/atom-rounds-compact-build.log`。
- 固定三问的真实验收证据见下文；已发现的 Post 判定冲突仍单独记录，不宣称整体验收全部通过。
- `sandbox/config.json` 为用户本地测试配置，不纳入交付提交。

日期：2026-10-08。分支：`codex/stream-continuation-integrity`。

## 已实现的边界

- 现有 `check-follow-up` 统一选择当前续写、TODO 推进、进度核对或结束；明确情况使用规则，冲突使用 JEV。
- `intent.follow_up` 和当前 TODO 交接结束本轮工具循环；保留已输出正文、reasoning 和配对调用结果。
- 核对复用 conversation，只允许 `todowrite`，最多两次尝试；无实际变更停止并报告未确认。
- `continuation_request` 保留目标、摘要、续写要求及避免重复的参考信息。Runtime 的行为和目标约束独立于 Agent 参数。
- 正文与进度保存成功后才释放后续任务。续写、TODO、核对与输入溢出的压缩恢复共用深度限制；周期健康检查和压缩保留请求。
- 默认直接启用新仲裁；没有新增 element、规划系统或观察模式，没有改变正式配置的输出上限或模型升级策略。
- 用户原有 `sandbox/config.json` 修改保留；真实模型测试使用独立临时 sandbox。

## 自动化验证

验证包括实际 SDK 工具循环和本地 HTTP 模型服务：截断恢复、intent 参数保存、无效调用纠正、TODO 交接、受限核对、未变更与取消停止、JEV 违规选择及超时回退、LLM 模拟 512-token 上限与零重试、保存失败不入队、检查点及压缩恢复、轮次上限保留 TODO。

最终命令及结果记录在 `/tmp/atom-continuation-tests.log`、`/tmp/atom-continuation-typecheck.log`、`/tmp/atom-continuation-build.log`。完整测试包含构建产物中的测试副本，条目数并不等同于独立用例数；现有 13 条跳过用例不算通过。

- 完整测试：1212 pass，13 skip，0 fail（167 个文件）。
- 五个工作区的类型检查与构建全部通过。
- `git diff --check` 通过。修改留在当前工作区，未提交或推送。

## 真实模型会话

隔离测试配置使用 1024-token 单次输出预算制造截断，正式 `sandbox/config.json` 未修改。原始证据目录：`/tmp/atom-continuation-live-n_q6cx3j`。日志 `runtime.log`、`runtime-v2.log`、`runtime-v3.log`、`runtime-v4.log` 保留四次迭代；输出与 messages 文件为最后一次运行结果。

| 场景 | 最后会话 | 观察结果 |
|---|---|---|
| 世界文明三阶段 | `acceptance-world-civilization-1791389906621` | 四段可见输出，三个 TODO 全部 completed，深度 3；一个 intent/TODO 冲突调用 JEV，两个交接直接使用规则；每阶段一个标题，阶段交接后未重写已完成章节 |
| 无 TODO 长回答 | `acceptance-no-todo-long-1791389920739` | 两段输出，length 后恢复，最终 stop 并输出指定结尾；没有创建 TODO，结果检查 status=satisfactory、behavior=partial_work |

第一轮文明案例出现逐字重复和深度耗尽，第二轮出现上一阶段正文被复制到下一阶段。针对实际证据补充了已执行请求、重复正文信息、当前项完成后的进度更新约束，以及后续任务中的明确目标。第三轮消除了观察到的章节复制，三个阶段完成。统一中英文决策协议后，第四轮第一项续写结束即更新 TODO，两次交接均按规则推进，没有额外的自然停止仲裁。

## 已知限制与验收结论

流程边界和恢复路径通过自动化验证，最后真实会话验证了三阶段交接与无 TODO 截断恢复。**不能将其等同于正文质量全面通过。**

第三轮文明案例中，JEV 在当前 TODO 自然停止但状态仍 in_progress 时选择了 resume_current，增加了一轮第一章正文。第四轮没有发生这一额外仲裁，但仍超出字数约束：请求约 900 字，实际可见输出 1165 个总字符、1016 个正文汉字；整体结果检查仍返回 `blocked / partial_work`。该判断未给出详细解释，不能断言其原因仅是字数超出。无 TODO 案例为 2900 个总字符，同样超过请求的近似长度；其 status 与 behavior 判断并不一致，这是现有整体检查的原始结果，未在此次续写改动中重写其决策规则。

当前没有保证模型正确判断字数或语义完成度，也没有因低置信度引入未经验证的阈值。Runtime 能阻止 active TODO 上的 finish、缺少交接的 advance、完全重复且无进展的 resume；其余语义判断仍受模型质量影响。现有 Post-Conversation 检查保留，不能把所有 TODO 完成伪装为整体验收成功。

历史日志只用于回归场景，不声称还原了日志未记录的完整正文。隔离测试进程已停止，临时凭据副本在验收结束后移除。

## 后续进展

上文保留统一续写仲裁的首次验收记录。后续发现 Post 证据丢失中间章节、语义原因与调度判断职责重叠；已按完整验证、参数消融、Runtime 精简的顺序实施并复测。新世界文明和无 TODO 会话的结果检查通过，具体改善、失败、token 代价与长度限制见 [跟踪参数对照实验](./progress-evidence-experiment.md)。

## 新增调试日志后的固定顺序复测

按用户实际测试方式，在同一新会话中依次提交以下三个问题；前一问题及其自动后续任务结束后再提交下一问题，不随机排序、不改写请求、不插入补充提示：

1. `还记得CODE是多少`
2. `杭州今天天气怎么样`
3. `一口气输出输出世界文明发展的历史，不少于10段，每段不少于800字，用表格优化输出内容`

使用独立测试 sandbox，复用当前配置、AGENTS 和现有记忆数据库快照；不预先告知模型 CODE，不修改单次输出上限或最大链深度。记录真实模型和工具执行、新增调试事件、每个问题的会话结果及最终 TODO。验收分别检查 CODE 记忆依据、天气查询的真实证据，以及文明史段数、各段正文长度、表格与停止原因；运行结束后停止测试 Core、删除凭据副本，保留日志和输出用于分析。

本次复测结果：三个用户消息在同一会话中按原文、原顺序提交，源配置 SHA-256 保持不变。单次输出上限 4096 tokens、最大链深度 5。CODE 记忆召回正确，但 Post 给出 blocked/complete/requirements_met 的冲突判断；天气回答与实际 Bing 工具记录一致，Post 因 HTTP529 未完成。文明史输出4段（排除标题、表格的正文汉字数为1647、2199、2393、2858），有4个表格，未满足至少10段；最终4项 completed、1项 in_progress、6项 pending。

文明史第2、3段自然停止时 todowrite 均仍开放，TODO 未回写，两次 JEV 仲裁均因 HTTP529 回退核对。5次深度递增对应3次业务推进（第2、3、4段）和2次核对；另执行1次健康检查，与第二次核对共享深度4，不能重复计为额外深度。第4段后深度5/5停止；没有 length 截断。证据证明共享预算导致本次提前结束，但本次无法验收成功 JEV 响应时的语义判断能力。即使每项顺利交接，按本次11项计划逐项执行也需要10次后续执行，超过深度5，预算与长计划的匹配问题仍存在。

证据保存在本机临时目录 `/var/folders/3_/28hb0c0n6vz47lphq3w0s15r0000gn/T/atom-fixed-sequence-hb4v1sm4`：runtime.log、report.md、逐题输出/会话快照、tool-records.jsonl、final-session.json、analysis.json 和 test-metadata.json。测试 Core 已停止，独立 sandbox 与凭据副本已删除；业务逻辑未修改。

## 双层预算验收计划（2026-10-09）

覆盖正常跨窗口、死循环/unknown、JEV→LLM一次回退、双失败、取消、全局暂停追加额度与去重、旧窗口拒绝、保存失败、暂存不扣费、重放去重、Post/核对/压缩入口及旧配置/旧会话迁移。运行针对性测试、类型检查、构建，再运行包含产物副本的完整测试。

真实测试隔离 sandbox 和记忆快照，原输出上限、全局100/局部5；同会话严格按上述三个问题。代理串行且请求启动间隔至少5秒，上一题结束后至少10秒才提交下一题；代理排队不计模型调用超时。验证文明史10段、正文各800字及表格、无重复完成章节、跨窗口累计及全局暂停恢复。记录503/529，不预设限速必然解决。CODE/Post既有问题分别记录。结束停止进程删除凭据副本，保留日志和输出。

## 双层预算实施与验收结果（2026-10-09）

### 实现范围

现有分支直接启用全局100/局部5默认值；局部允许5～10。Orchestrator 统一释放入口覆盖 Prediction、续写、TODO、核对、Post 重试、压缩、后台任务、Hook 和定时任务。正文保存、暂停/窗口状态保存、扣减保存与实际入队按序执行；暂存不收费，单个 owner 最多释放一个业务后续任务。

目标与 Topic 分离，原始目标、窗口 TODO 基线、完整待执行载荷及最近释放记录持久化；旧 depth/config 转换兼容。控制消息记录 resume_budget，跳过 Prediction；追加额度不清空累计，重复指令不多授权。最近释放记录支持进程退出后显式恢复，旧 ID 重放不收费；新恢复尝试是新的一轮。

健康检查使用 fast/JEV，失败后 basic LLM 模拟一次；各10秒、512 output tokens、SDK重试0；取消不回退。不健康与 unknown 温和暂停，不再默认 healthy。沿用有界正文引用和真实 ToolRecord，不增加 Runtime 字数/相似度计算。请求、选项、概率、来源、回退、窗口/预算变化及可用的模型 usage 分开诊断。

### 自动化

- 完整测试：1302 pass、13 skip、0 fail，171个文件；包含构建产物副本，不等于独立用例数。
- 五个工作区类型检查、构建以及 git diff --check 通过。构建先于完整测试。
- 全链本地模型服务测试：7轮无 TODO 正常推进在第5轮后检查，仅重置 local；looping 在第6轮释放前暂停；全局2轮暂停后精确“继续”追加2，最终used=3/allowance=4，原目标保留且无第二次 Prediction；同时到来的 CONTINUE 不额外授权。
- 补充回归：暂存零扣减、检查/正文保存失败不释放、JEV503/529/非法答案/超时的一次模拟回退、双失败unknown、取消、旧窗口拒绝、缺凭据、压缩完整载荷、旧配置/旧会话、相同Topic新目标、恢复重放，以及预算保存后退出保留参数。

日志：`/tmp/atom-budget-targeted.log`、`/tmp/atom-budget-core-test.log`、`/tmp/atom-budget-typecheck.log`、`/tmp/atom-budget-build.log`、`/tmp/atom-budget-full-test.log`。

### 固定三问真实测试

两个独立测试会话都按原文和原顺序提交 CODE、杭州天气、文明史三个问题，未插入额外用户请求。原输出上限4096，测试global100/local5。源配置hash保持 `ef9a485f532619fe3c4964a548923834dd9a5160dd400237b9356bf140fe9e5b`。

| 结果 | 第一轮 | 第二轮 |
|---|---|---|
| CODE | 正确召回9527，Post satisfactory | 正确召回9527，Post satisfactory |
| 天气 | 实际工具访问实时天气来源 | 实际 Bing websearch；26/15℃与工具返回一致，来源标记1天前，未独立验证预报日期时效 |
| 文明史 | 10节，但第1节正文479汉字，最终校验TODO未完成 | 10节，正文与表格验收通过，10项TODO全部completed |
| 窗口健康 | 第5轮healthy、第10轮unknown，暂停且保留请求 | 第5、10轮均healthy，正常停止于15轮 |
| 最终预算 | global10/local5/window1，pause=unknown | global15/local5/window2，未触发额度暂停 |
| 模型调用 | 25次，其中native7次 | 34次，其中native13次；10次业务正文+5次核对=15个预算轮次，2次健康检查不计预算 |
| 503/529 | 0 | 0 |
| 最小模型启动间隔 | 5001ms | 5000ms |
| 题间间隔 | 10019ms、10011ms | 10014ms、10009ms |

两个测试代理均串行持有请求直至完整响应，无模型请求重叠。决策队列等待点位于单次调用计时之前；最终代码也为流式调用排除测试代理等待，生产没有配置限速。

第一轮不能视为通过。健康选择unknown的原始概率0.51、healthy0.46；输入显示5个不同阶段摘录与交接，但unknown选项把“裁剪”单独列为条件，可能过度要求证明完整交付。由于JEV没有自由解释，不能断言其内部原因。澄清检查口径为“窗口推进”而非“整体验收”，同时提醒Agent交接前满足本项正文长度；第二轮改善得到实测支持，不能据单次测试声称统计稳定。

第二轮各节正文汉字（排除标题、表格、引用块）：951、1875、2081、2593、2954、3219、3814、4375、4821、4358；每节1个表格。10个章节标题唯一，5次核对仅调用TODO工具，没有生成已完成章节正文。

### 尚存的 Post 问题

第二轮文明史 Post 的原生选择互相冲突：status=satisfactory、contentState=unfinished、reasonCode=requirements_met。现有校验将其转为 blocked / inconsistent_success。没有将全部TODO完成或任务completed冒充整体验收通过，也没有在本次修改Post的业务判断逻辑。预算与内容数量/格式验收通过，**Post整体验收仍未通过**，需后续单独处理。

历史固定测试有7次原生请求中5次503/529；本次两轮均0。会话、请求数量和时间不同，不能据此证明先前错误一定由速度引起。当前世界史文字量远高于最低要求；Runtime没有新增业务长度计算，模型仍可能不精确控制长度或出现事实错误。

### 保留证据与清理

- 第一轮：`/var/folders/3_/28hb0c0n6vz47lphq3w0s15r0000gn/T/atom-budget-live-TSqf1X`。
- 第二轮：`/var/folders/3_/28hb0c0n6vz47lphq3w0s15r0000gn/T/atom-budget-live-xMDoiU`。
- 目录包含runtime.log、完整逐题输出/messages、session.json、tool-records.jsonl、model-timeline.json、budget-timeline.json、analysis.json与metadata.json。

测试Core和代理已停止，两个独立sandbox和凭据副本已删除；日志与完整输出保留。用户已有sandbox/config.json本地修改未被改写。代码留在当前分支工作区，未提交或推送。
