export type EvaluatorMode = "initial" | "analyzing" | "intervening";

export type EvaluatorResult = {
  health: "healthy" | "looping" | "stuck" | "degrading" | "unknown";
  suggestion: string;
  upgradeModel: boolean;
  reason: string;
};

export const FALLBACK_EVALUATOR: EvaluatorResult = {
  health: "unknown",
  suggestion: "",
  upgradeModel: false,
  reason: "健康检查尚未确认",
};

export type EvaluatorFlowState = {
  mode: EvaluatorMode;
  task: any;
  session: any;
  recentSummary: string;
  evaluation?: EvaluatorResult;
  evidence?: Record<string, unknown>;
  budgetCheck?: { goalId: string; windowId: number };
  abortSignal?: AbortSignal;
};
