import type { ElementRegistry } from "../../pipeline/registry";
import { JevElement } from "./jev-element";
import { TokenRatioElement } from "./token-ratio";

export { TokenRatioElement } from "./token-ratio";
export { calcTokenUsage, calcTokenRatio, applyCompressRatio } from "./token-ratio";
export { callLLM, parseJsonFromLLMResponse } from "./llm";

export function registerSharedElements(registry: ElementRegistry): void {
  registry.register("jev-decision", JevElement);
  registry.register("token-ratio", TokenRatioElement);
}
