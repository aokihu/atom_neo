import { decode } from "@toon-format/toon";
import { CONTEXT_DATA_HEADER } from "./compiler";

/** Decode independent TOON documents for assertions, excluding instruction text. */
export function contextRows(snapshot?: { content: string }): Array<Record<string, unknown>> {
  const data = snapshot?.content.split(`${CONTEXT_DATA_HEADER}\n`)[1];
  return data ? data.split("\n\n").map(block =>
    (decode(block) as { context: Record<string, unknown> }).context) : [];
}
