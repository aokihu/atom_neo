import React from "react";
import type { DocPageProps } from "./shared";
import { PageHeader, Badge, Callout } from "./shared";

type TaskStatus = "done" | "pending";

interface TaskItem {
  name: string;
  file: string;
  status: TaskStatus;
}

interface PhaseItem {
  id: string;
  name: string;
  estimate: string;
  status: "done" | "in_progress" | "pending";
  desc: string;
  tasks: TaskItem[];
}

const PHASES: PhaseItem[] = [
  {
    id: "P1", name: "Foundation", estimate: "1w", status: "pending",
    desc: "Shared types, pipeline core, log system",
    tasks: [
      { name: "Shared types", file: "shared/src/types/*.ts", status: "pending" },
      { name: "Pipeline core", file: "shared/src/pipeline/*.ts", status: "pending" },
      { name: "Log system", file: "shared/src/log/*.ts", status: "pending" },
    ],
  },
  {
    id: "P2", name: "Core Engine", estimate: "1.5w", status: "pending",
    desc: "事件驱动调度器 + Per-Session 上下文",
    tasks: [
      { name: "TaskEngine", file: "core/src/task-engine.ts", status: "pending" },
      { name: "TaskQueue", file: "core/src/task-queue.ts", status: "pending" },
      { name: "TaskFactory", file: "core/src/task-factory.ts", status: "pending" },
      { name: "SessionStore", file: "core/src/session/store.ts", status: "pending" },
      { name: "SessionContext", file: "core/src/session/context.ts", status: "pending" },
    ],
  },
  {
    id: "P3", name: "Tools & Pipelines", estimate: "1w", status: "pending",
    desc: "文件系统 + Memory + Bash 工具",
    tasks: [
      { name: "ToolRegistry", file: "core/src/tools/registry.ts", status: "pending" },
      { name: "ToolExecutor", file: "core/src/tools/executor.ts", status: "pending" },
      { name: "FS tools", file: "core/src/tools/builtin/fs.ts", status: "pending" },
      { name: "Bash tool", file: "core/src/tools/builtin/bash.ts", status: "pending" },
      { name: "Memory tools", file: "core/src/tools/builtin/memory.ts", status: "pending" },
    ],
  },
  {
    id: "P4", name: "Pipeline Builder", estimate: "1.5w", status: "pending",
    desc: "Builder DSL + Element 注册表 + 3 pipeline",
    tasks: [
      { name: "PipelineBuilder DSL", file: "core/src/pipeline/builder.ts", status: "pending" },
      { name: "Element Registry", file: "core/src/pipeline/registry.ts", status: "pending" },
      { name: "Conversation pipeline", file: "core/src/pipelines/conversation/", status: "pending" },
      { name: "Prediction pipeline", file: "core/src/pipelines/prediction/", status: "pending" },
      { name: "Follow-up pipeline", file: "core/src/pipelines/follow-up/", status: "pending" },
    ],
  },
  {
    id: "P5", name: "Server & Protocol", estimate: "1w", status: "pending",
    desc: "HTTP + WebSocket 服务器 + Replay 系统",
    tasks: [
      { name: "HTTP server", file: "core/src/server.ts", status: "pending" },
      { name: "WS handler", file: "core/src/ws/handler.ts", status: "pending" },
      { name: "Broadcast", file: "core/src/ws/broadcaster.ts", status: "pending" },
      { name: "Replay system", file: "core/src/replay/*.ts", status: "pending" },
      { name: "API routes", file: "core/src/api/*.ts", status: "pending" },
    ],
  },
  {
    id: "P6", name: "Gateway", estimate: "0.5w", status: "pending",
    desc: "Auth + 权限 + 速率限制 + 代理",
    tasks: [
      { name: "Gateway server", file: "gateway/src/server.ts", status: "pending" },
      { name: "JWT auth", file: "gateway/src/auth/jwt.ts", status: "pending" },
      { name: "Permission", file: "gateway/src/permission/checker.ts", status: "pending" },
      { name: "Rate limit", file: "gateway/src/ratelimit/limiter.ts", status: "pending" },
      { name: "Core proxy", file: "gateway/src/proxy/core-proxy.ts", status: "pending" },
    ],
  },
  {
    id: "P7", name: "TUI", estimate: "1w", status: "pending",
    desc: "WebSocket 客户端 + 流式渲染",
    tasks: [
      { name: "App entry", file: "tui/src/app.tsx", status: "pending" },
      { name: "WS client", file: "tui/src/client/ws-client.ts", status: "pending" },
      { name: "Session mgr", file: "tui/src/session/manager.ts", status: "pending" },
      { name: "Stream renderer", file: "tui/src/renderer/stream.ts", status: "pending" },
      { name: "Tool display", file: "tui/src/renderer/tools.ts", status: "pending" },
      { name: "Chat view", file: "tui/src/views/chat.tsx", status: "pending" },
    ],
  },
  {
    id: "P8", name: "Integration", estimate: "0.5w", status: "pending",
    desc: "E2E 测试 + 部署 + 文档",
    tasks: [
      { name: "E2E tests", file: "tests/e2e/", status: "pending" },
      { name: "Deployment", file: "deploy/", status: "pending" },
      { name: "Documentation", file: "docs/*.md", status: "pending" },
    ],
  },
];

function pct(done: number, total: number) { return total > 0 ? Math.round((done / total) * 100) : 0; }

export default function DevelopmentPlanPage({ title, description, category }: DocPageProps) {
  const totalTasks = PHASES.reduce((s, p) => s + p.tasks.length, 0);
  const doneTasks = PHASES.reduce((s, p) => s + p.tasks.filter(t => t.status === "done").length, 0);
  const overallPct = pct(doneTasks, totalTasks);

  return (
    <div className="doc-page">
      <PageHeader title={title} description={description} category={category} />

      {/* Overall progress */}
      <div className="plan-overall">
        <div className="plan-overall__ring-wrap">
          <svg className="plan-ring" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="52" className="plan-ring__track" />
            <circle cx="60" cy="60" r="52" className="plan-ring__fill"
              strokeDasharray={2 * Math.PI * 52}
              strokeDashoffset={2 * Math.PI * 52 * (1 - overallPct / 100)}
              transform="rotate(-90 60 60)" />
            <text x="60" y="55" className="plan-ring__pct">{overallPct}%</text>
            <text x="60" y="75" className="plan-ring__label">{doneTasks}/{totalTasks}</text>
          </svg>
        </div>
        <div className="plan-overall__info">
          <div className="plan-overall__title">Overall Progress</div>
          <div className="plan-overall__stats">
            <span className="plan-stat plan-stat--done">{doneTasks} done</span>
            <span className="plan-stat plan-stat--pending">{totalTasks - doneTasks} remaining</span>
            <span className="plan-stat plan-stat--est">~8 weeks</span>
          </div>
        </div>
      </div>

      {/* Phase roadmap */}
      <div className="plan-roadmap">
        <div className="plan-roadmap__line" />
        {PHASES.map((phase, pi) => {
          const phaseDone = phase.tasks.filter(t => t.status === "done").length;
          const phasePct = pct(phaseDone, phase.tasks.length);

          return (
            <div key={phase.id} className={`plan-phase ${phase.status === "done" ? "plan-phase--done" : phase.status === "in_progress" ? "plan-phase--wip" : ""}`}>
              <div className="plan-phase__marker">
                {phase.status === "done" ? "✓" : phase.status === "in_progress" ? "●" : "○"}
              </div>
              <div className="plan-phase__card">
                <div className="plan-phase__head">
                  <Badge color={phase.status === "done" ? "green" : phase.status === "in_progress" ? "orange" : "blue"}>
                    {phase.id}
                  </Badge>
                  <strong className="plan-phase__name">{phase.name}</strong>
                  <span className="plan-phase__est">{phase.estimate}</span>
                </div>
                <p className="plan-phase__desc">{phase.desc}</p>

                {/* Progress bar */}
                <div className="plan-phase__bar-wrap">
                  <div className="plan-phase__bar" style={{ width: `${phasePct}%` }} />
                </div>
                <div className="plan-phase__meta">{phaseDone} / {phase.tasks.length} tasks</div>

                {/* Task dots */}
                <div className="plan-phase__tasks">
                  {phase.tasks.map((task, ti) => (
                    <div key={ti} className={`plan-task-dot ${task.status === "done" ? "plan-task-dot--done" : ""}`} title={task.name}>
                      {task.status === "done" ? "✓" : "·"}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <Callout type="tip" title="执行顺序">
        严格按 P1 → P8 顺序执行，每阶段完成全部任务后方可进入下一阶段。
      </Callout>
    </div>
  );
}
