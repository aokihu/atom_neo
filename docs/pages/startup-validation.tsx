import React from "react";
import type { DocPageProps } from "./shared";
import { PageHeader, Section, ComparisonTable, Callout, CodeBlock } from "./shared";

export default function StartupValidation({ title, description, category }: DocPageProps) {
  return <div className="doc-page">
    <PageHeader title={title} description={description} category={category} readTime={5} />
    <Callout type="ok" title="2026-09-13 最新回归通过">常规测试 1040 通过、0 失败；13 项进程验收全部通过，workspace 类型检查通过。首次向导取消与全局定时任务冷启动均已修复。新增过期不补跑、Core 关闭取消定时执行、摘要认证及 TUI 数据栏验证。以下矩阵保留修复前历史，工作区未提交。</Callout>
    <p>80/140 列终端均通过任务栏与 EXPIRED 状态显示回归；dist/atom 已重新编译。最新日志位于 /tmp/atom-schedule-all.log、/tmp/atom-schedule-integration.log、/tmp/atom-schedule-layout.log、/tmp/atom-schedule-typecheck.log。</p>
    <Callout type="ok" title="v1.15.0 提交前回归（2026-09-14）">1040 项常规测试、13 项进程验收（126 项断言）、workspace 类型检查和 6 个相关 Web 文档渲染通过。当前定时 widget 位于右侧栏，Compact 隐藏；所有 EMPTY 统一低对比度。日志为 /tmp/atom-v1.15-tests.log、/tmp/atom-v1.15-integration.log、/tmp/atom-v1.15-types.log。</Callout>
    <Section title="首次验收历史：检查结果">
      <ComparisonTable headers={["项目", "结果", "说明"]} rows={[
        ["常规测试", "1036 pass / 0 fail / 10 skip", "10 项进程测试单独显式执行"],
        ["类型检查", "通过", "全部 workspace"],
        ["本机 ARM64 二进制", "通过", "Bun 1.3.14 编译到临时目录"],
        ["build:bin", "通过", "隔离最小项目执行原脚本并校验版本输出"],
        ["差异空白检查", "通过", "git diff --check"],
      ]} />
    </Section>
    <Section title="首次验收历史：进程矩阵">
      <ComparisonTable headers={["场景", "结果", "证据"]} rows={[
        ["CLI 错误", "通过", "非零退出且无 sandbox 初始化"],
        ["源码/二进制 Core attach 与重启", "通过", "随机端口、0600 凭据、403、默认会话与历史恢复"],
        ["Client 单个/全部启停", "通过", "幂等、旧 secret 失效、崩溃后手动停止不复活"],
        ["无交互冷启动定时任务", "失败", "没有活动会话，未执行模型请求"],
        ["默认/独立 TUI 退出", "通过", "真实 PTY 双 Ctrl+C，资源归属正确"],
        ["取消首次向导", "失败", "installed 与 Core 运行文件仍被创建"],
        ["Gateway 来源冲突", "通过", "不同 clientId 返回 409，默认 TUI 不变"],
        ["活动任务期间断开", "通过", "快照显示 busy，断开后任务继续完成"],
        ["build:bin 脚本", "通过", "版本源文件有效且二进制输出正确版本"],
        ["启动失败清理", "通过", "端口占用/Client 失败无运行描述遗留"],
      ]} />
      <p>3 项新增 Session 测试验证发起者持久化、历史 unknown 及磁盘默认 TUI 选择。ID 前缀、Gateway 活动和内部访问均不能替代明确的发起者元数据。</p>
    </Section>
    <Section title="定时任务失败链">
      <CodeBlock lang="text" code={"恢复 global hook → 定时器触发 → 读取内存 lastActiveSessionId → 冷启动为空 → 跳过任务"} />
      <p>旧逻辑依赖最近活动会话，冷启动无法执行。现已改为使用保存的 sessionId，无归属 global 使用稳定内部会话；Core 关闭停止触发并取消任务链。过期一次性任务不补跑，周期任务只等未来时间。</p>
    </Section>
    <Section title="向导取消失败链">
      <CodeBlock lang="text" code={"Ctrl+D → renderer.destroy → onDestroy/finish 成功 resolve → abort 因 settled 而返回 → 父进程写 installed 并启动 Core"} />
      <p>首次验收检测到 installed=true、corePublished=true。现已修复：只有保存完成才成功，首次向导取消返回非零状态，父进程只在配置确实完成后写安装标记。</p>
      <p>两处问题均为既有逻辑在首次验收场景中暴露，后续已修复，并增加 Core 定时任务栏。</p>
    </Section>
    <Section title="复现与范围">
      <CodeBlock lang="bash" code={"bun test\nbun run typecheck\nATOM_RUN_STARTUP_VALIDATION=1 bun test src/bootstrap/startup.integration.test.ts"} />
      <p>测试位于 src/bootstrap/startup.integration.test.ts、fixtures/ 和 session/initiator.test.ts。使用临时 sandbox、固定响应的本地假模型与假 Client；退出清理临时目录及子进程，未连接真实平台或使用真实 API Key，未替换 dist/atom，未提交或推送。</p>
      <p>PTY 验证启动/输出/退出，不是完整视觉审查。远程 attach、真实平台收发、长期压力及定时结果主动推送未覆盖。</p>
      <p>本机原始日志：/tmp/atom-validation-tests-final.log、/tmp/atom-validation-integration-final.log、/tmp/atom-validation-typecheck.log。临时日志可能被系统清理，本报告保留结论与复现条件。</p>
    </Section>
  </div>;
}
