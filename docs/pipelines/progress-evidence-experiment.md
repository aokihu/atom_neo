# 跟踪参数对照实验

日期：2026-10-08；在 `codex/stream-continuation-integrity` 上继续。

## 实施顺序

1. 保存旧判断输入和问题作为基线。先实现完整 progressEvidence：目标及 TODO 快照、正文引用、字数及近似长度约束、TODO 转移、结束原因、续写统计、重复信号、证据覆盖范围；JEV 提供内容状态、需求覆盖、剩余工作类别、原因及证据引用。
2. 用固定正文和预先标注的场景比较旧方案、仅补齐正文、完整参数。固定模型，每个组合重复运行，失败/超时计入结果，不以单次成功判定改善。
3. 只有确认改善后，删除计数、长度解析、重复计算、续写统计等参数组，比较不同组合。另测 Runtime 只提供事实和有界正文，由 JEV 承担更多语义判断的方案。
4. 在未参与选择的场景和新的真实会话上验证候选方案。采用能保留改善的较简组合；样本小，不声称统计等价或保证模型始终正确。

## 控制因素

- 实验同时包含 Post-Conversation 和续写判断。正文缺失、旧进度、正确分段、跳项、重复、明确长度限制是不同场景。
- 原始会话的近似字数不设未经验证的硬容差；对照用例可明确改写请求，必须记录为派生场景，不能声称原会话成功率。
- 每种参数组合使用同一正文预算和问题；“只补正文”与“完整参数”单独比较，隔离证据采样与判断问题的影响。
- 保存逐次答案、概率/置信度、输入大小、延迟、Runtime 校验后结果和场景来源。不得打印凭据。
- 不新增 Element 或规划系统。事实记录复用现有消息 metadata、Task 和 continuation_request；JEV 判断不直接改 TODO。

## 证据传递

消息记录当前 TODO 和执行前后状态、实际终结原因。短正文不因存在 TODO 而省略中间段；长正文在全局预算内按片段取首尾，并显式记录裁剪或遗漏。

当前项累计计数如需跨压缩保留，放进已有 continuation_request，不能依赖归档后不可见的消息。正文被裁剪时，计数或 TODO completed 均不能单独证明语义完成。JEV 仅引用本次提供的正文片段。

Runtime 保留取消、错误、工具治理、TODO 转移和证据引用校验。JEV 负责语义是否完整、续写是否越界、重复是否影响交付以及需求是否满足。最终组合与实验结果在本文件补充。

## 收敛候选（待最终验证）

首轮完整组和参数消融支持删除 Runtime 的字数累计、长度解析、相似度和续写统计。最小 JEV 问题组曾在跳过当前项场景退化，因此保留独立 `intentScope` 判断。最终候选保留已有 TODO 前后快照，以及廉价的任务关联、真实结束原因、输出引用和裁剪范围；正文只提供一次。JEV 增加 `contentState`、`reasonCode`、`evidenceRef` 三项，续写时增加 `intentScope`。收敛后重新测试实际生产输入格式，并用新冻结场景检查；测试结果决定是否接受候选。

### 候选中的职责冲突

第一次生产格式复测：选择样本 30/30，新英文场景 15/15，但扩展筛选 7/9。两个失败的原始续写选择、内容状态和 intentScope 都正确，`reasonCode=scope_conflict` 却否决了续写。原因码不能同时充当诊断说明和另一套调度开关。因此修正为：reasonCode 仅记录，Runtime 使用专门的 contentState/intentScope 和既有真实执行约束校验。扩展场景的无 TODO 显式续写在真实流程中由规则处理；直接 JEV 对照仍保留这些失败，不能删除样本或隐瞒它们。


## 实验结果与最终选择

### 1. 先验证完整方案

使用现有 fast profile `typesafe/jev-1.13` 进行真实原生 JEV 调用，不使用模拟答案。固定 10 个场景，每组重复 3 次；同一正文、模型、标注与预算，最多三个请求并行，10 秒超时，不重试。全部调用成功返回，超时或错误仍计失败。

世界文明、长故事正文取自已有测试会话；请求和负例经过明确派生：文明案例首先检验三个阶段的覆盖，**不沿用原请求的近似字数作为硬性合格线**。负例删除中间阶段、末尾、指定收束句，另加仅承诺、旧 TODO、正确分段、跳项和重复正文。标签在调用之前固定，不能将派生样本的命中率写成真实用户会话成功率。

| 第一轮方案 | JEV 原始选择正确 | Runtime 校验后正确 | 平均输入字符数 |
|---|---:|---:|---:|
| 旧问题 + 旧首尾采样 | 27/30 | 27/30 | 2,596 |
| 旧问题 + 补齐各段证据 | 29/30 | 29/30 | 2,837 |
| 完整 Runtime 参数 + 完整 JEV 判断 | 30/30 | 30/30 | 8,056 |

旧方案的三个错误均发生在实际已有三阶段正文的文明样本，首尾采样没有提供古典文明章节。只补证据后，这个问题消失，但跳项场景仍有一次误选 resume_current。完整方案通过全部样本。

**结论：在这批场景中，补齐证据及增加判断参数可行。改善主要来自证据采样修复；新增参数相对于“只补证据”仅多解决一次错误，不能据此声称每个参数都必要。**

### 2. 删除 Runtime 计算组

第二轮保留相同 JEV 问题，分别删除参数组：

| 参数组合 | JEV 原始正确 | 校验后正确 | 平均输入字符数 |
|---|---:|---:|---:|
| 完整组 | 30/30 | 30/30 | 8,056 |
| 基本事实：目标、TODO 快照/转移、引用、结束原因、裁剪范围 | 30/30 | 30/30 | 7,796 |
| 基本事实 + 字数/长度约束 | 30/30 | 30/30 | 7,918 |
| 基本事实 + 重复/续写统计 | 30/30 | 30/30 | 7,933 |
| JEV 承担语义判断，Runtime 只提供目标、快照、引用及范围、结束原因 | 30/30 | 30/30 | 7,758 |
| 不另加 progressEvidence 对象，沿用已有事实和补齐正文 | 29/30 | 30/30 | 6,099 |

后一组的一次错误是原始模型选择与 Runtime 合法转移校验共同纠正的，不能算作模型独立判断正确。

增加三个扩展筛选场景：明确最多 200 汉字、短回答完成、无 TODO 的未结束故事。完整组、JEV 判断较多组和不另加对象组分别得到 9/9。这些场景后来参与筛选，最终报告称其为筛选集，不再称为完全未见样本。

**选择：删除正文汉字累计、长度正则解析、相似度/段落重复计算和续写统计。保留既有的完全重复正文保护与深度治理。长度、语义重复和剩余内容交给同一次 JEV 判断；运行时不另建计算体系。**

### 3. 再减少 JEV 判断项

将 JEV 增加的问题压缩到 contentState / reasonCode / evidenceRef 后，不另加对象组得到 30/30 + 扩展 9/9；基本事实组却分别为 29/30 和 8/9。前者有一次跳过当前 TODO 被放行，后者有一次正确续写被过度核对。

因此不能只根据某一轮全通过选最少字段。增加独立 intentScope 判断后，两组选择样本均为 30/30。最终合并为廉价执行事实 + 单份有界正文，保留三个判断问题，续写额外加 intentScope，取消需求覆盖、剩余工作和逐 TODO 覆盖等重叠问题。

第一次实际生产格式对照得到 30/30，但扩展筛选是 7/9：两个原始 resume_current、contentState=unfinished、intentScope=current 都正确，reasonCode=scope_conflict 触发了额外否决。此前一轮完整 Core 文明运行也复现了这条链，核对无变更后安全停止。

修正职责：**reasonCode 只解释和记录；调度校验使用专门的 contentState/intentScope，以及 Runtime 的真实执行约束。** 修正后的重复测试：

| 最终精简方案 | JEV 原始正确 | 校验后正确 |
|---|---:|---:|
| 原 10 个选择场景，重复三次 | 30/30 | 30/30 |
| 三个扩展筛选场景，重复三次 | 9/9 | 9/9 |
| 新增五个英文场景，重复三次 | 15/15 | 15/15 |

新增英文场景包括：两阶段完整、第二阶段缺失但 TODO completed、正文完成但进度旧、同项续写和跳项。首次冻结新增场景后，旧版也得到了 15/15；它们检验没有明显退化，不能作为优于旧版的证据。职责修正后复测最终方案仍为 15/15。

### 4. 最终保留的参数

| 所属 | 参数 | 职责 |
|---|---|---|
| Runtime，消息 metadata | target、before、after | 哪一项执行，进度是否发生真实变化 |
| Runtime，消息 metadata | terminalCause | 区分截断、intent 分段、交接、核对、停止等原因 |
| Runtime，判断输入 | outputRefs、reviewCoverage | 使用已有消息 seq 标记片段，记录任务关联、裁剪与遗漏 |
| Runtime，已有输入 | TODO 前后快照、结束/错误/取消事实、incomingContinuation | 复用既有状态和获准请求 |
| JEV | contentState | 当前目标或整体交付是否仍有未写内容 |
| JEV | intentScope，仅续写 | 显式 intent 是否仍指向当前目标 |
| JEV | evidenceRef | 引用实际提供的正文证据；限定选项避免虚构引用 |
| JEV | reasonCode | 诊断原因，不再增加一套调度开关 |

progressEvidence 只为需要模型的歧义场景构造；明确规则场景只保存廉价 trace。Post-Conversation 复用同一证据采样。正文预算保持 2,400 字符，最多提供最近 16 个片段，每个片段在预算内取首尾；所有裁剪/遗漏明确标记。正文只提供一次，事实对象不再次附带 text。

不新增持久任务 ID、element、规划系统或输出限制。累计字数已删除，因此无需为它增加跨压缩载荷；恢复仍复用已有 continuation_request 中的目标和获准参数。TODO 核对不能依据 JEV 结果直接修改计划。

### 5. 实测 token 代价

以下是同一 10 场景、各三次请求的 provider 实际 usage 平均值，**不是将字符估算成 token**：

| 方案 | 平均 input_tokens | 平均 output_tokens |
|---|---:|---:|
| 旧版 | 1,627.6 | 90.1 |
| 只补各段正文 | 1,854.3 | 90.1 |
| 完整参数 | 4,258.6 | 448.9 |
| 最终精简参数 | 2,645.2 | 278.4 |

最终方案相对完整参数版的平均输入减少 **37.9%**，输出减少约 **38.0%**。相对旧版平均输入增加约 **62.5%**，因为提供了更多有效证据和结构化判断。这个数字针对 JEV 仲裁/结果检查，不代表业务 Agent 的整体会话 token 增幅；明确规则场景仍不调用续写 JEV，业务输出 token 上限未变。

## 新的完整 Core 运行

隔离 sandbox 单次业务输出上限 1024 tokens、最大深度 5、最大工具循环 20，正式配置不变。第一版运行和修正后的运行分别保留在：

- `/var/folders/3_/28hb0c0n6vz47lphq3w0s15r0000gn/T/atom-evidence-live-dt0rorff`
- `/var/folders/3_/28hb0c0n6vz47lphq3w0s15r0000gn/T/atom-evidence-live-final-fdioiy8m`

| 最终场景 | 结果与证据 |
|---|---|
| 世界文明 `acceptance-world-civilization-1791417838034` | 四段业务正文；一个总标题、三个阶段标题；三个 TODO completed。第一段 intent 与 TODO 歧义由 JEV 允许同项续写；第一项自然停止后，JEV 识别正文已完整但进度旧，核对只修改 TODO，未新增业务正文。后续按交接推进。Post 收到全部四段，coverage.complete=true，返回 satisfactory / answered / contentState=complete |
| 无 TODO 长回答 `acceptance-no-todo-long-1791417865726` | 两段，length 后按规则恢复，最终 stop；无 TODO，无重复完整段落，指定结尾出现；Post 返回 satisfactory / answered / contentState=complete |

文明输出为 1,213 个总字符、1,024 个正文汉字；故事为 2,563 个总字符、2,222 个正文汉字。统计在验收脚本中离线计算，不放回 Runtime。近似字数仍有偏差，文明 JEV reasonCode=length_deviation；它是诊断，不能据此宣称精确长度控制已解决。故事正文超过采样预算，reviewCoverage.complete=false；提供首尾和裁剪范围，不能声称检查模型看过完整原文。

修正前运行没有丢弃：文明被 reasonCode 的额外否决拦截并安全停止；长故事原始 satisfactory 与 partial_work/unfinished 冲突，Runtime 改为 blocked。修正后的新会话通过，不意味着同一模型以后不再出现矛盾。概率、置信度、原始选择、专门判断和实际行动均写入诊断日志，不设置未经校准的置信度阈值。

## 自动化验证

新增回归覆盖中间章节证据、裁剪与遗漏、任务引用关联、核对不能冒充交接、contentState/intentScope 合法性、原因码职责，以及 Post 的 satisfactory 与 partial_work/no_output 冲突。已有取消、超时、非法选择、无凭据、模拟路径、两次核对限制、保存失败、单次调度、深度限制、检查点和压缩透传测试继续通过。

- 针对性验证：42 pass，0 fail（随后新增一个核对 trace 测试也包含在完整测试中）。
- 完整测试：1,232 pass、13 skip、0 fail，169 个文件；包含 dist 内的测试副本，不能等同于独立用例数。
- 五个工作区类型检查、构建均通过；git diff --check 通过。
- 原 sandbox/config.json 与实验前 SHA-256 相同。测试 Core 已停止，临时 .env 副本已删除。未提交或推送。

## 复现与资料

原始对照资料目录：`/var/folders/3_/28hb0c0n6vz47lphq3w0s15r0000gn/T/atom-evidence-clg1y8pd`。

- initial-results.json：旧版、只补证据、完整组。
- ablation-results.json、holdout-full-results.json：Runtime 参数组消融及扩展筛选。
- minimal-results.json、holdout-minimal-results.json、scoped-results.json：JEV 问题精简与 scope 恢复。
- final-screen-results.json：第一次生产格式的两次误拦截，保留原始答案。
- final2-results.json、final2-screen-results.json：最终重复结果。
- final-gate-results.json、replay-check/final-gate-results.json：新增英文场景及最终复测。
- replay.json：冻结场景、原始旧问题和完整参数快照，可在删除完整 Runtime 计算后继续复现各组。真实模型存在波动，后续运行不保证复现完全相同的答案。

复现示例（需要当前配置的原生 JEV fast profile 和环境凭据）：

```sh
bun --env-file=sandbox/.env scripts/continuation-evidence-experiment.ts \
  --replay /var/folders/3_/28hb0c0n6vz47lphq3w0s15r0000gn/T/atom-evidence-clg1y8pd/replay.json \
  --output /tmp/atom-evidence-replay \
  --arms baseline,evidence_only,full,final --repeats 3 --name comparison
```

`--holdout` 运行扩展筛选，`--gate` 运行新增英文场景；没有冻结完整快照时不允许把精简输入冒充 full 组。实验数据目前在本机临时目录，长期复现应保留 replay.json。日志、测试和构建输出分别是 `/tmp/atom-evidence-*.log`。

## 结论的边界

增加参数在这批证据中可行，且可在删除多项 Runtime 计算后保留观察到的改善。最终收敛为廉价事实、单份正文、三个 JEV 判断和一个续写专用判断。最大的收益来自补齐正文证据和明确判断职责；不是字段越多越好。

样本数小，重复请求不是独立用户任务；新增英文场景也没有证明优于旧版。尚未验证统计等价、长期任务的全部组合、精确字数或所有裁剪后的语义完整性。保留失败与真实运行证据，便于后续依据新问题增补场景。
