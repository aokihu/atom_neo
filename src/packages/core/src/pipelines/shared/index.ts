import { registerElement } from "../../pipeline/registry";
import { JevElement } from "./jev-element";
import { TokenRatioElement } from "./token-ratio";

export { TokenRatioElement } from "./token-ratio";
export { calcTokenUsage, calcTokenRatio, applyCompressRatio } from "./token-ratio";
export { callLLM, parseJsonFromLLMResponse } from "./llm";

export function registerSharedElements(): void {
  try { registerElement("jev-decision", JevElement); } catch {}
  try { registerElement("token-ratio", TokenRatioElement); } catch {}
}
