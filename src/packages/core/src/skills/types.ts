import type { SkillListItem, SkillLoadResult } from "@atom-neo/shared";

export type { SkillListItem, SkillLoadResult };

export type SkillServiceLike = {
  list(): SkillListItem[];
  load(name: string, sessionId?: string): SkillLoadResult;
  loadSection(name: string, section: string, sessionId?: string): boolean;
  removeSection(name: string, section: string, sessionId?: string): boolean;
  unload(name: string, sessionId?: string): void;
  buildContext(sessionId?: string): string;
  clearScope?(sessionId: string): void;
  getRevision?(sessionId?: string): number;
};
