import { describe, expect, test } from "bun:test";
import {
  DAY_MS,
  calculateDecayedUsage,
  calculateFinalMemoryScore,
  calculateFreshnessScore,
  calculateGraphScore,
  calculateMemoryQuality,
  calculateRetrievalRelevance,
  calculateUsageScore,
} from "./memory-ranking";

describe("memory ranking", () => {
  test("halves usage intensity after 30 days without mutating the source value", () => {
    const now = 100 * DAY_MS;
    expect(calculateDecayedUsage(4, now - 30 * DAY_MS, now)).toBeCloseTo(2, 8);
    expect(calculateUsageScore(0)).toBe(0);
    expect(calculateUsageScore(8)).toBeGreaterThan(calculateUsageScore(2));
  });

  test("uses kind-specific freshness and exempts identity or pinned memories", () => {
    const now = 400 * DAY_MS;
    const common = { pinned: false, lastConfirmedAt: now - 90 * DAY_MS, createdAt: 0, now };
    expect(calculateFreshnessScore({ ...common, kind: "decision" })).toBeCloseTo(50, 8);
    expect(calculateFreshnessScore({ ...common, kind: "realtime_data" })).toBeLessThan(1);
    expect(calculateFreshnessScore({ ...common, kind: "identity" })).toBe(100);
    expect(calculateFreshnessScore({ ...common, kind: "realtime_data", pinned: true })).toBe(100);
  });

  test("weights incoming graph relations and ignores unknown relations", () => {
    const strong = calculateGraphScore([{ relation: "depends_on", sourceBaseWeight: 100 }]);
    const weak = calculateGraphScore([{ relation: "relates_to", sourceBaseWeight: 100 }]);
    expect(strong).toBeGreaterThan(weak);
    expect(calculateGraphScore([{ relation: "unknown", sourceBaseWeight: 100 }])).toBe(0);
  });

  test("combines intrinsic, usage, graph, freshness, and confidence", () => {
    const quality = calculateMemoryQuality({
      baseWeight: 80,
      usageScore: 4,
      usageUpdatedAt: 100,
      graphScore: 50,
      kind: "stable_fact",
      confidence: 1,
      pinned: false,
      lastConfirmedAt: 100,
      createdAt: 100,
      now: 100,
    });
    const uncertain = calculateMemoryQuality({
      baseWeight: 80,
      usageScore: 4,
      usageUpdatedAt: 100,
      graphScore: 50,
      kind: "stable_fact",
      confidence: 0.5,
      pinned: false,
      lastConfirmedAt: 100,
      createdAt: 100,
      now: 100,
    });
    expect(quality).toBeGreaterThan(uncertain);
    expect(uncertain).toBeCloseTo(quality / 2, 8);
  });

  test("keeps retrieval relevance dominant in the final score", () => {
    const exact = calculateRetrievalRelevance({ matchedTermCount: 2, totalTermCount: 2, rankIndex: 0, candidateCount: 2 });
    const partial = calculateRetrievalRelevance({ matchedTermCount: 1, totalTermCount: 2, rankIndex: 1, candidateCount: 2 });
    expect(calculateFinalMemoryScore(exact, 20)).toBeGreaterThan(calculateFinalMemoryScore(partial, 100));
  });
});
