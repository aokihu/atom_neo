import { ProgressCircle } from "@heroui/react";

const DEV_PHASES = [
  { id: "p1", title: "P1: Foundation", desc: "Shared types, pipeline core, log system", tasks: 3, done: 0, status: "pending" as const },
  { id: "p2", title: "P2: Core Engine", desc: "TaskEngine, Session store, Tool Registry, Pipeline Builder", tasks: 4, done: 0, status: "pending" as const },
  { id: "p3", title: "P3: Tools & Pipelines", desc: "FS/Bash/Memory tools, 3 pipeline definitions", tasks: 3, done: 0, status: "pending" as const },
  { id: "p4", title: "P4: Server & Protocol", desc: "HTTP + WS server, event protocol, Replay system", tasks: 3, done: 0, status: "pending" as const },
  { id: "p5", title: "P5: Gateway", desc: "Auth, Permission, RateLimit, Core proxy", tasks: 2, done: 0, status: "pending" as const },
  { id: "p6", title: "P6: TUI", desc: "WebSocket client, stream renderer, session manager", tasks: 2, done: 0, status: "pending" as const },
  { id: "p7", title: "P7: Integration", desc: "E2E tests, deployment config", tasks: 2, done: 0, status: "pending" as const },
  { id: "docs", title: "Docs", desc: "Architecture docs, dev guides, API references", tasks: 19, done: 19, status: "done" as const },
];

function ProgressRing({ pct, size, strokeWidth }: { pct: number; size: number; strokeWidth: number }) {
  const r = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  return (
    <svg className="progress-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle className="progress-ring-circle" cx={size / 2} cy={size / 2} r={r} />
      <circle
        className="progress-ring-fill"
        cx={size / 2}
        cy={size / 2}
        r={r}
        strokeDasharray={circ}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text className="progress-ring-text" x={size / 2} y={size / 2}>
        {Math.round(pct)}%
      </text>
    </svg>
  );
}

export function ProgressSection() {
  const total = DEV_PHASES.reduce((s, p) => s + p.tasks, 0);
  const done = DEV_PHASES.reduce((s, p) => s + p.done, 0);
  const wip = DEV_PHASES.filter(p => p.status === "wip").length;
  const pending = DEV_PHASES.filter(p => p.status === "pending").length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="progress-section">
      <h2>Development Progress</h2>
      <div className="progress-overall">
        <ProgressRing pct={pct} size={80} strokeWidth={6} />
        <div className="progress-stats">
          <div className="stat stat-done">
            <span>{done}</span> of {total} tasks completed
          </div>
          <div className="stat stat-wip">
            <span>{wip}</span> phases in progress
          </div>
          <div className="stat stat-pending">
            <span>{pending}</span> phases pending
          </div>
        </div>
      </div>
      <div className="progress-bar-wrap">
        <div
          className={`progress-bar-fill ${pct === 100 ? "green" : "orange"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="phase-list">
        {DEV_PHASES.map(p => {
          const phasePct = p.tasks > 0 ? Math.round((p.done / p.tasks) * 100) : 0;
          const icon = p.status === "done" ? "✓" : p.status === "wip" ? "◉" : "○";
          return (
            <div key={p.id} className="phase-item">
              <span className={`phase-status ${p.status}`}>{icon}</span>
              <div className="phase-label">
                <strong>{p.title}</strong>
                <small>{p.desc}</small>
              </div>
              <span className={`phase-pct ${p.status}`}>{phasePct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
