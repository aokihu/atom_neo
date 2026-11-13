/**
 * Typed Core service contract injected by the composition root.
 * ServiceManager stays responsible for startup/stop lifecycle only.
 */
import type { MemoryKind, NetworkServiceLike } from "@atom-neo/shared";
import type { SkillServiceLike } from "./skills/types";

/** Structural memory record used by Core tools; the app-level service may carry extra fields. */
export type MemoryNodeLike = {
  id: string;
  content: string;
  summary: string;
  tags: string[];
  kind?: MemoryKind;
  expiresAt?: number | null;
};

export type MemoryTraversalResult = MemoryNodeLike & {
  sourceId: string | null;
  relation: string | null;
  direction: "incoming" | "outgoing" | null;
  depth: number;
};

export type MemoryServiceLike = {
  search(query: string, limit?: number, kind?: MemoryKind): Promise<MemoryNodeLike[]>;
  getById(id: string): MemoryNodeLike | null;
  recordRead?(id: string): void;
  countRelated?(id: string): number;
  save(content: string, tags?: string[], summary?: string, options?: Record<string, unknown>): string;
  traverse(startId: string, maxSteps?: number): MemoryTraversalResult[];
  link(source: string, target: string, relation: string): boolean;
  forget(id: string): boolean;
  retain(id: string): void;
  findFullId?(id: string): string | null;
  has?(id: string): boolean;
};

export type CoreServices = {
  memory: MemoryServiceLike;
  network: NetworkServiceLike;
  skill?: SkillServiceLike;
  compiler?: { getCompiledPrompt(): string };
};

/**
 * Resolve the explicit service object handed to Core. Kept as a pure boundary so
 * startup fails before any Core collaborator is constructed.
 */
export function resolveCoreServices(input: { services?: Partial<CoreServices> | null }): CoreServices {
  const { services } = input;
  assertCoreServices(services);
  return services;
}

/** Fail fast when a required Core service is absent; optional services may stay undefined. */
export function assertCoreServices(
  services: Partial<CoreServices> | null | undefined,
): asserts services is CoreServices {
  if (!services?.memory) throw new Error('Required service "memory" is not registered');
  if (!services?.network) throw new Error('Required service "network" is not registered');
}
