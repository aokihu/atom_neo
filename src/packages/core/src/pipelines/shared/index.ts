import { registerElement } from "../../pipeline/registry";
import { JevElement } from "./jev-element";
import { TokenRatioElement } from "./token-ratio";

export { TokenRatioElement } from "./token-ratio";
export { calcTokenUsage, calcTokenRatio, applyCompressRatio } from "./token-ratio";
export { callLLM, parseJsonFromLLMResponse } from "./llm";

export function registerSharedElements(): void {
  registerElement("jev-decision", JevElement);
  registerElement("token-ratio", TokenRatioElement);
}
