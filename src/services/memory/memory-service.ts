import { BaseService } from "../base/base-service";
import { countRelatedMemories, linkMemories, traverseMemories } from "./memory-graph";
import { searchMemories } from "./memory-query";
import { MemoryStore } from "./memory-store";
import type { MemoryKind, MemoryNode, MemorySaveOptions, MemoryTraversalNode } from "./memory-types";

export type { MemoryKind, MemoryNode, MemorySaveOptions, MemoryTraversalNode } from "./memory-types";

export class MemoryService extends BaseService {
  readonly name = "memory";

  #store: MemoryStore;

  constructor(params: { dbPath: string; legacyNodesPath?: string; now?: () => number }) {
    super();
    this.#store = new MemoryStore(params);
  }

  // == Public API ==

  async search(query: string, limit = 3, kind?: MemoryKind): Promise<MemoryNode[]> {
    return searchMemories(this.#store, query, limit, kind);
  }

  traverse(startId: string, maxSteps = 4): MemoryTraversalNode[] {
    return traverseMemories(this.#store, startId, maxSteps);
  }

  save(content: string, tags: string[] = [], summary?: string, options: MemorySaveOptions = {}): string {
    return this.#store.save(content, tags, summary, options);
  }

  has(id: string): boolean {
    return this.#store.findFullId(id) !== null;
  }

  getById(memoryId: string): MemoryNode | null {
    return this.#store.getById(memoryId);
  }

  countRelated(memoryId: string): number {
    return countRelatedMemories(this.#store, memoryId);
  }

  findFullId(memoryId: string): string | null {
    return this.#store.findFullId(memoryId);
  }

  link(source: string, target: string, relation: string): boolean {
    return linkMemories(this.#store, source, target, relation);
  }

  forget(id: string): boolean {
    return this.#store.forget(id);
  }

  retain(id: string): void {
    this.#store.retain(id);
  }

  recordRead(id: string): void {
    this.#store.recordRead(id);
  }

  // == Service lifecycle ==

  protected async onStart(): Promise<void> {
    this.#store.open();
  }

  protected async onStop(): Promise<void> {
    this.#store.close();
  }
}
