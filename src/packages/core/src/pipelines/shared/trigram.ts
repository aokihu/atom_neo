export function trigramSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const tA = trigrams(a);
  const tB = trigrams(b);
  const intersection = tA.intersection(tB);
  const union = tA.union(tB);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

function trigrams(s: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < s.length - 2; i++) {
    set.add(s.slice(i, i + 3));
  }
  return set;
}
