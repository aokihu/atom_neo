import { describe, expect, test } from "bun:test";
import { assertCoreServices, resolveCoreServices } from "./core-services";
import type { CoreServices, MemoryServiceLike } from "./core-services";
import type { SkillServiceLike } from "./skills/types";

function makeMemory(): MemoryServiceLike {
  return {
    search: async () => [],
    getById: () => null,
    save: () => "memory-1",
    traverse: () => [],
    link: () => true,
    forget: () => true,
    retain: () => {},
  };
}

function makeServices(): CoreServices {
  return {
    memory: makeMemory(),
    network: { webFetch: async () => ({ ok: true, code: "success", content: "" }) },
  };
}

describe("assertCoreServices", () => {
  test("accepts memory and network without optional services", () => {
    expect(() => assertCoreServices({ memory: makeMemory(), network: makeServices().network })).not.toThrow();
  });

  test("throws when memory is missing", () => {
    expect(() => assertCoreServices({ network: makeServices().network }))
      .toThrow('Required service "memory" is not registered');
  });

  test("throws when network is missing", () => {
    expect(() => assertCoreServices({ memory: makeMemory() }))
      .toThrow('Required service "network" is not registered');
  });

  test("throws on empty or missing input", () => {
    expect(() => assertCoreServices({})).toThrow('Required service "memory" is not registered');
    expect(() => assertCoreServices(undefined)).toThrow('Required service "memory" is not registered');
    expect(() => assertCoreServices(null)).toThrow('Required service "memory" is not registered');
  });
});

describe("resolveCoreServices", () => {
  test("returns the provided services object unchanged", () => {
    const services = makeServices();
    const resolved = resolveCoreServices({ services });
    expect(resolved).toBe(services);
    expect(resolved.skill).toBeUndefined();
    expect(resolved.compiler).toBeUndefined();
  });

  test("keeps optional skill and compiler services", () => {
    const services = makeServices();
    const skill: SkillServiceLike = {
      list: () => [],
      load: () => ({ ok: true }),
      loadSection: () => true,
      removeSection: () => true,
      unload: () => {},
      buildContext: () => "",
    };
    const resolved = resolveCoreServices({
      services: { ...services, skill, compiler: { getCompiledPrompt: () => "prompt" } },
    });
    expect(resolved.skill).toBe(skill);
    expect(resolved.compiler?.getCompiledPrompt()).toBe("prompt");
  });

  test("fails when required services are missing", () => {
    expect(() => resolveCoreServices({ services: { network: makeServices().network } }))
      .toThrow('Required service "memory" is not registered');
    expect(() => resolveCoreServices({ services: { memory: makeMemory() } }))
      .toThrow('Required service "network" is not registered');
    expect(() => resolveCoreServices({})).toThrow('Required service "memory" is not registered');
  });
});
