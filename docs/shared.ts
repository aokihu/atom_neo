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
  if (["architecture", "project-structure", "index"].includes(filename)) return "overview";
  if (["coding-conventions", "naming-conventions", "type-system", "testing", "dependency-injection"].includes(filename)) return "conventions";
  if (["element-design", "pipeline-builder", "event-bus", "tool-plugin", "session-context", "memory-service", "sandbox"].includes(filename)) return "subsystems";
  if (["protocol", "error-handling"].includes(filename)) return "integration";
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
    "environment-setup": 4,
    bootstrap: 5,
    "coding-conventions": 10,
    "naming-conventions": 11,
    "type-system": 12,
    testing: 13,
    "dependency-injection": 14,
    configuration: 15,
    "element-design": 20,
    "pipeline-builder": 21,
    "event-bus": 22,
    "tool-plugin": 23,
    "session-context": 24,
  "memory-service": 25,
  sandbox: 26,
  protocol: 30,
    "error-handling": 31,
  };
  return order[filename] ?? 99;
}
