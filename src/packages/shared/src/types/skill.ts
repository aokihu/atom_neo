export type SkillSectionMeta = {
  offset: number;
  length: number;
};

export type SkillDef = {
  name: string;
  description: string;
  capabilities: string[];
  version?: string;
  filePath: string;
  sections: Map<string, SkillSectionMeta>;
};

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
