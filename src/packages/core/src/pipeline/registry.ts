import type { BaseElement, PipelineEventBus, PipelineEventMap } from "@atom-neo/shared";

export type ElementConstructor = new (...args: any[]) => BaseElement;

const registry = new Map<string, ElementConstructor>();

export function registerElement(name: string, ctor: ElementConstructor): void {
  if (registry.has(name)) {
    throw new Error(`Element "${name}" already registered`);
  }
  registry.set(name, ctor);
}

export function resolveElement(name: string): ElementConstructor {
  const ctor = registry.get(name);
  if (!ctor) {
    throw new Error(
      `Element "${name}" not found. Registered: [${[...registry.keys()].join(", ")}]`,
    );
  }
  return ctor;
}

export function getRegisteredNames(): string[] {
  return [...registry.keys()];
}

export function clearRegistry(): void {
  registry.clear();
}
