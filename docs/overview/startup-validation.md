# 启动模式与参数验证报告

> **Purpose**: 记录 2026-09-13 对参数、Core/TUI/Gateway 生命周期及 Session 发起者的真实验证结果。

## 结论

v1.15.0 提交前回归（2026-09-14）：1040 项常规测试通过，13 项进程验收全部通过（126 项断言），workspace 类型检查与 6 个相关 Web 文档渲染通过。当前定时 widget 位于右侧栏，Compact 隐藏；EMPTY 统一低对比度。日志：/tmp/atom-v1.15-tests.log、/tmp/atom-v1.15-integration.log、/tmp/atom-v1.15-types.log。以下保留此前阶段结果。

最新结果（2026-09-13）：常规测试 1040 通过、0 失败，13 项显式进程验收全部通过；workspace 类型检查通过。首次向导取消与全局定时任务冷启动两个问题已修复。新增覆盖过期任务连续重启不补跑、摘要接口认证与 prompt 隐藏、Core 关闭取消执行中/排队的 global 定时任务、TUI 显示过期任务。

定时规则：Core 生命周期拥有全部触发与任务链；global 只跨重启保留定义。一次性任务过期不补跑；周期任务跳过错过的次数，只等未来时间。TUI 数据栏读取当前 Core 的任务摘要。首次配置取消不启动 Core。

补充终端回归：80/140 列均显示任务栏和 EXPIRED 状态，退出清理正常。已重新编译 dist/atom。最新日志：/tmp/atom-schedule-all.log、/tmp/atom-schedule-integration.log、/tmp/atom-schedule-layout.log、/tmp/atom-schedule-typecheck.log。未提交或推送。

## 首次验收历史（修复前）

部分通过，不能标记为完整验收通过。常规测试 1036 pass、0 fail；10 个进程验收用例中 8 pass、2 fail。新增测试与报告已保留，业务代码本轮未修改，未提交或推送。

测试基于分支 codex/startup-modes-session-initiator 的当前工作区（包括尚未提交的启动模式实现）；已提交的参数修复为 2755582。环境为 macOS ARM64 / Bun 1.3.14。

## 检查结果

| 检查 | 结果 | 边界 |
|------|------|------|
| 常规 bun test | 1036 通过、0 失败、10 跳过 | 跳过的是单独显式运行的进程验收，不是遗漏 |
| workspace 类型检查 | 全部通过 | 包括新增 Session 测试 |
| 当前源码编译为本机二进制 | 通过 | 编译到隔离临时目录，没有替换用户 dist/atom |
| build:bin 脚本生成版本与二进制 | 通过 | 在最小隔离项目执行原脚本，并检查可执行文件输出版本 |
| 文档与代码差异空白检查 | 通过 | git diff --check |

## 进程验收矩阵

| 场景 | 结果 | 观察 |
|------|------|------|
| 非法模式、缺少参数、无效端口、空 sandbox | 通过 | 非零退出，无意外 .atom 初始化 |
| 源码与二进制 Core 启动、attach、重启 | 通过 | 随机端口、0600 凭据、认证拒绝、并发默认会话一致、消息与会话重启恢复 |
| Gateway 单个/全部启停、崩溃退避中停止 | 通过 | 操作幂等，其他 Client 存活，旧 secret 失效，手动停止不复活 |
| 纯 Core 冷启动后的全局定时任务 | 失败 | 没有用户交互时没有执行模型请求 |
| 默认 TUI 和独立 TUI 的真实终端退出 | 通过 | PTY 内发送两次 Ctrl+C；默认模式清理 Core，独立模式保留 Core |
| 首次向导取消 | 失败 | Ctrl+D 后 installed=true、corePublished=true，程序继续进入主 TUI |
| Gateway 会话发起者冲突 | 通过 | 不同 clientId 返回 409，不改变默认 TUI 会话 |
| 活动任务期间断开 TUI | 通过 | 握手显示活动状态，断开不取消任务，任务继续完成 |
| 原 build:bin 脚本 | 通过 | 生成的版本文件可编译，输出正确版本 |
| 端口占用与 Client 启动失败 | 通过 | 非零退出，未遗留 Core/Gateway 运行描述文件 |

新增的 3 项 Session 测试验证：initiator 经 checkpoint/恢复保持不变；历史缺字段为 unknown，不能根据 tui- 前缀推测；磁盘上最近的明确 TUI 会话优先，Gateway/内部访问不改变选择。

## 失败一：全局定时任务依赖活动会话

位置：src/packages/core/src/hooks/hook-manager.ts 的 restore 与 #fire。

复现：临时 sandbox 配置一个持久化的 global interval hook，带有 sessionId；仅启动 Core，不 attach、不提交消息。定时器会恢复，但 #fire 对非 session scope 只取内存中的 #lastActiveSessionId。冷启动时它为空，于是记录 hook skipped: no active session 并返回。测试中的本地假模型没有收到请求。

影响：Core 进程常驻不代表无人交互的恢复任务能够执行。这直接影响后台定时任务目标。

已修复：定时任务使用保存的 sessionId，无归属 global 使用稳定内部会话，不再依赖最近活动的 Gateway/TUI。保留 session scope 不跨重启恢复规则，并按绝对截止时间跳过过期执行。

## 失败二：取消首次向导被当作成功

位置：src/packages/config-tui/src/app.tsx 的退出回调，及 src/main.ts 的首次安装完成处理。

复现：删除临时 sandbox 的 installed 标记，用真实 PTY 启动二进制，在向导中发送 Ctrl+D。检测到 .atom/installed 和 core-runtime.json 被创建，主 TUI 已启动；测试在 9 秒截止时终止进程组。

原因：取消路径先 renderer.destroy()，其 onDestroy 调用 finish()，将 settled 设为 true 并成功 resolve；随后 abort() 看到 settled 已为 true，直接返回。父进程收到成功退出，执行 markInstalled() 并启动 Core。

已修复：区分成功完成与主动取消，界面销毁只负责清理；first-run 取消返回非零状态，父进程仅在确实完成配置后写 installed 标记。

首次验收时上述两处文件与 HEAD 相同，属于既有逻辑在此次场景中暴露的问题。后续已修复配置取消，并按新规则修改定时生命周期和 TUI 数据栏。

## 复现命令与隔离

```bash
bun test
bun run typecheck
ATOM_RUN_STARTUP_VALIDATION=1 bun test src/bootstrap/startup.integration.test.ts
```

进程测试使用 mkdtemp 生成独立 sandbox、临时二进制、本地 HTTP 假模型和假 Gateway Client；模型响应是固定内容，不评价真实模型质量。测试退出清理子进程与临时目录。未使用真实 API Key、Telegram/其他平台账号或用户已有会话。

PTY 覆盖启动、界面产生输出与退出生命周期；不等同完整视觉审查。远程 attach、平台消息真实收发、长期运行压力测试和定时结果主动推送不在本轮覆盖范围。

对应测试：src/bootstrap/startup.integration.test.ts、src/bootstrap/fixtures/、src/packages/core/src/session/initiator.test.ts。

原始输出保存在本机临时文件 /tmp/atom-validation-tests-final.log、/tmp/atom-validation-integration-final.log、/tmp/atom-validation-typecheck.log；临时文件可能被系统清理，本报告保留结论与复现条件。
