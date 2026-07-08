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
  load(name: string): SkillLoadResult;
  loadSection(name: string, section: string): boolean;
  removeSection(name: string, section: string): boolean;
  unload(name: string): void;
  buildContext(): string;
};
