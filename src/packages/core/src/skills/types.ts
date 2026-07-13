export type SkillListItem = {
  name: string;
  description: string;
  capabilities: string[];
};

export type SkillLoadResult = {
  ok: boolean;
  sections?: string[];
  error?: string;
};

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
