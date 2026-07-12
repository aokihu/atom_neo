export const DAY_MS = 86_400_000;
export const USAGE_HALF_LIFE_DAYS = 30;

export type MemoryKind =
  | "identity"
  | "preference"
  | "stable_fact"
  | "decision"
  | "workflow"
  | "temporary_state"
  | "realtime_data";

const FRESHNESS_HALF_LIFE_DAYS: Record<MemoryKind, number> = {
  identity: Infinity,
  preference: 365,
  stable_fact: 180,
  decision: 90,
  workflow: 90,
  temporary_state: 7,
  realtime_data: 1,
};

const RELATION_WEIGHTS: Record<string, number> = {
  depends_on: 1,
  used_by: 1,
  derived_from: 0.8,
  extends: 0.7,
  relates_to: 0.3,
};

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

function elapsedDays(from: number | null | undefined, now: number): number {
  if (!from) return 0;
  return Math.max(0, now - from) / DAY_MS;
}

export function calculateDecayedUsage(
  usageScore: number,
  usageUpdatedAt: number | null | undefined,
  now: number,
): number {
  const exponent = -Math.LN2 * elapsedDays(usageUpdatedAt, now) / USAGE_HALF_LIFE_DAYS;
  return Math.max(0, usageScore) * Math.exp(exponent);
}

export function calculateUsageScore(decayedUsage: number): number {
  return clamp(100 * (1 - Math.exp(-Math.max(0, decayedUsage) / 4)));
}

export function calculateFreshnessScore(params: {
  kind: MemoryKind;
  pinned: boolean;
  lastConfirmedAt?: number | null;
  createdAt: number;
  now: number;
}): number {
  const halfLife = FRESHNESS_HALF_LIFE_DAYS[params.kind];
  if (params.pinned || halfLife === Infinity) return 100;
  const referenceTime = params.lastConfirmedAt || params.createdAt;
  return clamp(100 * Math.exp(-Math.LN2 * elapsedDays(referenceTime, params.now) / halfLife));
}

export function calculateGraphScore(
  references: Array<{ relation: string; sourceBaseWeight: number }>,
): number {
  const weightedReferences = references.reduce((total, reference) => {
    const relationWeight = RELATION_WEIGHTS[reference.relation] ?? 0;
    return total + relationWeight * clamp(reference.sourceBaseWeight) / 100;
  }, 0);
  return clamp(100 * (1 - Math.exp(-weightedReferences / 3)));
}

export function calculateMemoryQuality(params: {
  baseWeight: number;
  usageScore: number;
  usageUpdatedAt?: number | null;
  graphScore: number;
  kind: MemoryKind;
  confidence: number;
  pinned: boolean;
  lastConfirmedAt?: number | null;
  createdAt: number;
  now: number;
}): number {
  const usage = calculateUsageScore(calculateDecayedUsage(params.usageScore, params.usageUpdatedAt, params.now));
  const freshness = calculateFreshnessScore(params);
  const rawQuality = clamp(params.baseWeight) * 0.4
    + usage * 0.3
    + clamp(params.graphScore) * 0.2
    + freshness * 0.1;
  return clamp(rawQuality * clamp(params.confidence, 0, 1), 0, 100);
}

export function calculateRetrievalRelevance(params: {
  matchedTermCount: number;
  totalTermCount: number;
  rankIndex: number;
  candidateCount: number;
}): number {
  const coverage = params.totalTermCount === 0 ? 0 : params.matchedTermCount / params.totalTermCount * 100;
  const rankScore = params.candidateCount <= 1
    ? 100
    : (1 - params.rankIndex / (params.candidateCount - 1)) * 100;
  return clamp(coverage * 0.7 + rankScore * 0.3);
}

export function calculateFinalMemoryScore(relevance: number, quality: number): number {
  return clamp(relevance) * 0.65 + clamp(quality) * 0.35;
}
