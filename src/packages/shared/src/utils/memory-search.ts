const QUERY_NOISE = new Set([
  "最新", "实时", "当前", "现在", "今日", "今天", "近期", "最近", "动态", "动向", "信息",
  "latest", "current", "recent", "realtime", "real-time", "today", "now", "info", "information", "update", "updates",
]);
const MAX_SEARCH_TERMS = 16;

export function containsSkillHint(text: string): boolean {
  return /(?:\bskill\b|技能)/iu.test(text);
}

function getConceptTerms(query: string): string[] {
  const segments = query.trim().toLowerCase()
    .split(/[\s,，。！？!?;；:：、/\\|()[\]{}"'`]+/u)
    .filter(Boolean);
  const hasConcept = segments.some((term) => !/^\d+$/.test(term) && !QUERY_NOISE.has(term));
  const filtered = hasConcept
    ? segments.filter((term) => !/^\d+$/.test(term) && !QUERY_NOISE.has(term))
    : segments;
  return [...new Set(filtered)];
}

export function canonicalizeMemorySearchQuery(query: string): string {
  return getConceptTerms(query).sort().join(" ");
}

function getMemorySearchComparisonTerms(query: string): Set<string> {
  const terms = new Set<string>();
  for (const segment of getConceptTerms(query)) {
    const hanRuns = [...segment.matchAll(/\p{Script=Han}{2,}/gu)];
    if (hanRuns.length === 0) {
      terms.add(segment);
      continue;
    }

    for (const match of hanRuns) {
      const text = match[0];
      for (let i = 0; i < text.length - 1; i++) terms.add(text.slice(i, i + 2));
    }
  }
  return terms;
}

export function areMemorySearchQueriesSimilar(left: string, right: string): boolean {
  const leftTerms = getMemorySearchComparisonTerms(left);
  const rightTerms = getMemorySearchComparisonTerms(right);
  if (leftTerms.size === 0 || rightTerms.size === 0) return false;
  return [...leftTerms].some((term) => rightTerms.has(term));
}

export function parseMemorySearchTerms(query: string): string[] {
  const terms: string[] = [];
  for (const segment of getConceptTerms(query)) {
    if (!terms.includes(segment)) terms.push(segment);

    for (const match of segment.matchAll(/\p{Script=Han}{5,}/gu)) {
      const text = match[0];
      for (let i = 0; i < text.length - 1; i++) {
        const pair = text.slice(i, i + 2);
        if (!terms.includes(pair)) terms.push(pair);
      }
    }
  }
  return terms.slice(0, MAX_SEARCH_TERMS);
}
