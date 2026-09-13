import React from "react";
import type { DocPageProps } from "./shared";
import { Badge, Callout, ComparisonTable, PageHeader, Section } from "./shared";

export default function TuiInterfacePage({ content, title, description, category }: DocPageProps) {
  return (
    <div className="doc-page">
      <PageHeader
        title={title}
        description={description}
        category={category}
        readTime={Math.max(1, Math.ceil(content.split(/\s+/).length / 200))}
      />

      <Section title="设计边界">
        <p>所有 widget 的 EMPTY 统一使用比标题更淡的颜色：当前主题 muted 文字与背景按 60% / 40% 混合，适用于定时任务、MCP、TODO 和 Runtime 队列；正常数据与异常提示不变。</p>
        <Callout type="info" title="Core 定时任务栏">右侧 Telemetry 栏的 CONTEXT 下方显示当前 Core 的全部时间任务，Compact 模式随右侧栏隐藏，中间只保留对话和输入。每 2 秒同步数量、名称、范围、状态和下次执行时间；支持滚动，空列表与断连分别显示。独立 attach 使用同一受认证接口，不展示任务 prompt。</Callout>
        <p>定时任务复用右侧其他模块的背景、标题颜色、对齐与间距，无独立背景或边框。标题左侧 SCHEDULES，右侧任务总数；下方固定保留 3 行，零任务仅显示 EMPTY。</p>
        <ComparisonTable
          headers={["保留", "禁止"]}
          rows={[
            ["等宽字符、背景 Block、细 Box Drawing、Block Gauge", "贯穿全屏的高亮线框"],
            ["键盘优先，鼠标作为增强", "Mouse-only controls"],
            ["真实 Session / Tool / Network 状态", "为了填充面板制造指标"],
            ["Conversation 单一高对比主区域", "主区与侧栏保持相同视觉重量"],
          ]}
        />
        <Callout type="info" title="eDEX 是视觉语言，不是渲染技术">
          Atom Neo 采用背景色块、暗色间隔、淡青色单字符细边框和运行状态编码。
          所有内容仍由 OpenTUI 字符网格渲染。
        </Callout>
      </Section>

      <Section title="响应式布局">
        <ComparisonTable
          headers={["终端宽度", "模式", "可见区域"]}
          rows={[
            [<code>&gt;= 150</code>, <Badge color="green">Wide</Badge>, "Runtime + Conversation + Telemetry"],
            [<code>100 - 149</code>, <Badge color="blue">Medium</Badge>, "Conversation + Telemetry"],
            [<code>&lt; 100</code>, <Badge color="orange">Compact</Badge>, "Conversation only"],
          ]}
        />
        <div style={{
          display: "grid",
          gridTemplateColumns: "0.85fr 3.4fr 0.95fr",
          gap: "8px",
          marginTop: "16px",
          padding: "8px",
          background: "#05090c",
        }}>
          {[
            ["RUNTIME", "Session\nPipeline\nActivity\nStats"],
            ["CONVERSATION", "Messages\nReasoning\nTool execution\nCommand composer"],
            ["TELEMETRY", "Context\nTools / MCP\nTODO\nNetwork"],
          ].map(([heading, body], index) => (
            <div key={heading} style={{
              padding: "12px",
              background: index === 1 ? "#0a171d" : "#071015",
              borderLeft: index === 1 ? "1px solid #63cbea" : "1px solid #244651",
              color: index === 1 ? "#c8d7dc" : "#647b84",
            }}>
              <strong style={{ color: index === 1 ? "#72c7df" : "#4f6872" }}>{heading}</strong>
              <pre style={{ margin: "10px 0 0", whiteSpace: "pre-wrap", color: "inherit" }}>{body}</pre>
            </div>
          ))}
        </div>
      </Section>

      <Section title="视觉重量">
        <ComparisonTable
          headers={["优先级", "区域", "处理"]}
          rows={[
            ["1", "Conversation / Tool execution / Command", "高对比文字、略亮背景、细焦点边框"],
            ["2", "Current response", "清晰正文与克制分隔"],
            ["3", "Actionable telemetry", "仅状态值使用绿 / 黄 / 红"],
            ["4", "Passive telemetry", "45% - 55% 亮度，不使用高亮标题条"],
          ]}
        />
        <Callout type="info" title="Tool 行保持紧凑">
          执行中每次调用只占一行，依次显示状态、工具名和截断摘要。全部完成后移除执行 Block，
          在 Thought 同一行显示 <code>TOOLS success/total ▼</code>；点击后通过 Modal 查看详情，
          不让历史 Tool 组件持续压缩 Conversation。
        </Callout>
      </Section>

      <Section title="真实数据映射">
        <ComparisonTable
          headers={["面板", "数据来源", "降级行为"]}
          rows={[
            ["Runtime", "busy、showPreparing、messages、tool entries、Reason / Text Delta", "最近 8 批按窗口最大估算 Token 数归一化；累计估算值使用 ≈"],
            ["Context", "contextTokens / contextLimit", "Gauge 填满侧栏内部宽度；Limit 缺失时使用 128K fallback"],
            ["Tools / MCP", "当前 tool entries、toolInfos、mcpServers", "无本轮调用时显示 Builtin / MCP 数量"],
            ["TODO", "todoItems", "无 TODO 时显示 EMPTY"],
            ["Network", "当前消息中的 webfetch entries", "无请求时显示 0"],
          ]}
        />
      </Section>

      <Section title="主题策略">
        <p>
          默认 <code>edex</code> 主题使用近黑 Page、略亮 Conversation、低对比 Sidebar、
          淡青色单字符细边框、绿色成功、琥珀色活动和红色错误。其他主题继续复用相同布局。
        </p>
        <Callout type="warn" title="终端兼容">
          设计以 True Color 终端为目标，但不能依赖抗锯齿、像素级线条或复杂图像。
          窄终端优先隐藏侧栏，不通过缩小字体维持三栏。
        </Callout>
      </Section>
    </div>
  );
}
