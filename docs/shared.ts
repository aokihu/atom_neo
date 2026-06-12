export type DocEntry = {
  slug: string;
  title: string;
  description: string;
  category: string;
  priority: number;
  path: string;
};

export type CategoryMap = Record<string, { label: string; order: number }>;

export const CATEGORIES: CategoryMap = {
  overview: { label: "总览", order: 1 },
  conventions: { label: "开发规范", order: 2 },
  subsystems: { label: "子系统设计", order: 3 },
  integration: { label: "通信与错误", order: 4 },
  guide: { label: "开发指南", order: 5 },
};

export function categorize(filename: string): string {
  if (["architecture", "project-structure", "index", "bootstrap", "development-setup"].includes(filename)) return "overview";
  if (["coding", "testing", "dependency-injection"].includes(filename)) return "conventions";
  if (["pipeline-dev", "tool-plugin", "session", "memory-service", "sandbox", "task-execution", "configuration", "first-run-wizard", "agents-compiler"].includes(filename)) return "subsystems";
  if (["protocol", "error-handling", "gateway"].includes(filename)) return "integration";
  return "guide";
}

export function extractTitle(md: string): string {
  const h1 = md.match(/^# (.+)$/m);
  return h1 ? h1[1].replace(/^Atom Next v2 — /, "").replace(/^Atom Neo — /, "") : "";
}

export function extractDesc(md: string): string {
  const desc = md.match(/> \*\*Purpose\*\*: (.+)/);
  if (desc) return desc[1];
  const firstP = md.match(/^## .+\n\n(.+?)(?:\n|$)/m);
  return firstP ? firstP[1].slice(0, 120) : "";
}

export function priority(filename: string): number {
  const order: Record<string, number> = {
    index: 0,
    architecture: 1,
    "project-structure": 2,
    "development-setup": 4,
    bootstrap: 5,
    coding: 10,
    testing: 13,
    "dependency-injection": 14,
    configuration: 15,
    "pipeline-dev": 20,
    "tool-plugin": 23,
    session: 24,
    "memory-service": 25,
    sandbox: 26,
    "task-execution": 27,
    protocol: 30,
    "error-handling": 31,
    gateway: 32,
    "first-run-wizard": 33,
    "agents-compiler": 34,
    "future-features": 50,
  };
  return order[filename] ?? 99;
}
