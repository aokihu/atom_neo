import { describe, test, expect } from "bun:test";
import { makeBus } from "../../../pipelines/test-helpers";
import { InjectSkillContextElement } from "./inject-skill-context";
import type { ConversationFlowState } from "./types";

function makeState(overrides: Partial<ConversationFlowState> = {}): ConversationFlowState {
  return {
    mode: "streaming",
    task: {},
    ...overrides,
  };
}

describe("InjectSkillContextElement", () => {
  test("injects skillContext when mode is streaming", async () => {
    const skillService = { buildContext: () => "<skill name=\"t\">\n  <section name=\"a\">\n...</section>\n</skill>" };
    const element = new InjectSkillContextElement({
      name: "inject-skill-context",
      kind: "transform",
      bus: makeBus(),
      skillService: skillService as any,
    });

    const result = await element.doProcess(makeState({ mode: "streaming" }));

    expect(result.skillContext).toBe("<skill name=\"t\">\n  <section name=\"a\">\n...</section>\n</skill>");
  });

  test("passes through when mode is not streaming", async () => {
    const skillService = { buildContext: () => "should-not-appear" };
    const element = new InjectSkillContextElement({
      name: "inject-skill-context",
      kind: "transform",
      bus: makeBus(),
      skillService: skillService as any,
    });

    const result = await element.doProcess(makeState({ mode: "initial" }));

    expect(result.skillContext).toBeUndefined();
  });

  test("skillContext is empty string when no sections active", async () => {
    const skillService = { buildContext: () => "" };
    const element = new InjectSkillContextElement({
      name: "inject-skill-context",
      kind: "transform",
      bus: makeBus(),
      skillService: skillService as any,
    });

    const result = await element.doProcess(makeState({ mode: "streaming" }));

    expect(result.skillContext).toBe("");
  });
});
