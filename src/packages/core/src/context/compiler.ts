import { createHash, randomUUID } from "node:crypto";
import { encode } from "@toon-format/toon";
import type {
  ContextFragment,
  ContextManifestEntry,
  ContextReceipt,
  ContextSnapshot,
} from "@atom-neo/shared";

const SCOPE_ORDER: Record<ContextFragment["scope"], number> = {
  system: 0,
  workspace: 1,
  session: 2,
  topic: 3,
  task: 4,
  step: 5,
};

export type CompileContextOptions = {
  id?: string;
  inputBudget?: number;
};

export type ContextCompilation = {
  snapshot: ContextSnapshot;
  manifest: readonly Readonly<ContextManifestEntry>[];
  receipts: readonly Readonly<ContextReceipt>[];
  estimatedTokens: number;
  inputBudget: number;
  prefixHash: string;
};

export function compileContextSnapshot(
  fragments: readonly ContextFragment[],
  options: CompileContextOptions = {},
): ContextCompilation {
  const ordered = fragments.toSorted(compareFragment);
  const unsafe = ordered.find(fragment => fragment.channel === "instructions" && fragment.trust === "untrusted");
  if (unsafe) throw new Error(`Untrusted context cannot use the instructions channel: ${unsafe.key}`);
  const latestByKey = new Map<string, ContextFragment>();
  for (const fragment of ordered) {
    const current = latestByKey.get(fragment.key);
    if (!current || fragment.revision > current.revision) latestByKey.set(fragment.key, fragment);
  }

  const budget = options.inputBudget ?? Number.POSITIVE_INFINITY;
  const candidates = ordered.filter(fragment => latestByKey.get(fragment.key) === fragment);
  let used = 0;
  const selectedSet = new Set<ContextFragment>();
  for (const fragment of candidates.toSorted(compareSelection)) {
    const tokens = estimateTokens(fragment.content);
    const fits = fragment.retention === "pinned" || used + tokens <= budget;
    if (!fits) continue;
    selectedSet.add(fragment);
    used += tokens;
  }
  const selected = ordered.filter(fragment => selectedSet.has(fragment));
  const manifest = ordered.map(fragment => {
    const tokens = estimateTokens(fragment.content);
    if (latestByKey.get(fragment.key) !== fragment) return toManifest(fragment, tokens, false, "duplicate");
    const isSelected = selectedSet.has(fragment);
    return toManifest(fragment, tokens, isSelected, isSelected ? undefined : "budget");
  });

  const receipts: ContextReceipt[] = [];

  for (const fragment of selected) {
    if (fragment.retention === "once") {
      const fragmentReceipts = fragment.receipts ?? [{
        id: fragment.receiptId ?? `${fragment.source}:${fragment.key}:${fragment.revision}`,
        fragmentKey: fragment.key,
        source: fragment.source,
        revision: fragment.revision,
      }];
      receipts.push(...fragmentReceipts.map(receipt => Object.freeze({ ...receipt })));
    }
  }

  const content = encode({ context: selected.map(toSnapshotRow) });

  const snapshot = Object.freeze({
    id: options.id ?? randomUUID(),
    content,
  });
  return Object.freeze({
    snapshot,
    manifest: Object.freeze(manifest.map(entry => Object.freeze(entry))),
    receipts: Object.freeze(receipts),
    estimatedTokens: used,
    inputBudget: Number.isFinite(budget) ? budget : used,
    prefixHash: createHash("sha256").update(content).digest("hex").slice(0, 16),
  });
}

function compareFragment(a: ContextFragment, b: ContextFragment): number {
  return SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope]
    || b.priority - a.priority
    || a.key.localeCompare(b.key)
    || b.revision - a.revision;
}

function compareSelection(a: ContextFragment, b: ContextFragment): number {
  const pinned = Number(b.retention === "pinned") - Number(a.retention === "pinned");
  return pinned
    || b.priority - a.priority
    || SCOPE_ORDER[b.scope] - SCOPE_ORDER[a.scope]
    || a.key.localeCompare(b.key)
    || b.revision - a.revision;
}

function estimateTokens(content: ContextFragment["content"]): number {
  const text = typeof content === "string" ? content : JSON.stringify(content);
  return Math.max(1, Math.ceil(text.length / 4));
}

function toManifest(
  fragment: ContextFragment,
  estimatedTokens: number,
  selected: boolean,
  reason?: ContextManifestEntry["reason"],
): ContextManifestEntry {
  return {
    key: fragment.key,
    source: fragment.source,
    scope: fragment.scope,
    channel: fragment.channel,
    retention: fragment.retention,
    revision: fragment.revision,
    estimatedTokens,
    contentHash: createHash("sha256").update(JSON.stringify(fragment.content)).digest("hex").slice(0, 16),
    selected,
    reason,
  };
}

function toSnapshotRow(fragment: ContextFragment) {
  return {
    trust: fragment.trust ?? "trusted",
    scope: fragment.scope,
    channel: fragment.channel,
    source: fragment.source,
    content: formatContent(fragment.content),
  };
}

function formatContent(content: ContextFragment["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(message => message.content).join("\n\n");
  return encode(content);
}
