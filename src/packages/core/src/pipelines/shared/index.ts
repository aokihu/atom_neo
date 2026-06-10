import { registerElement } from "../../pipeline/registry";
import { TokenRatioElement } from "./token-ratio";

export { TokenRatioElement } from "./token-ratio";

export function registerSharedElements(): void {
  try { registerElement("token-ratio", TokenRatioElement); } catch {}
}