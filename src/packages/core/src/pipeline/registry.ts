import type { BaseElement } from "@atom-neo/shared";

export type ElementConstructor = new (...args: any[]) => BaseElement;

/** Per-Core element constructor registry. No module-level state. */
export class ElementRegistry {
  #elements = new Map<string, ElementConstructor>();

  register(name: string, ctor: ElementConstructor): void {
    if (this.#elements.has(name)) {
      throw new Error(`Element "${name}" already registered`);
    }
    this.#elements.set(name, ctor);
  }

  resolve(name: string): ElementConstructor {
    const ctor = this.#elements.get(name);
    if (!ctor) {
      throw new Error(
        `Element "${name}" not found. Registered: [${this.names().join(", ")}]`,
      );
    }
    return ctor;
  }

  names(): string[] {
    return [...this.#elements.keys()];
  }

  clear(): void {
    this.#elements.clear();
  }
}

export function createElementRegistry(): ElementRegistry {
  return new ElementRegistry();
}
