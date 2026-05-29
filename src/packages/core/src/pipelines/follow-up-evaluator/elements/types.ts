export type EvaluatorMode = "initial" | "analyzing" | "intervening";

export type EvaluatorResult = {
  health: "healthy" | "looping" | "stuck" | "degrading";
  suggestion: string;
  upgradeModel: boolean;
  reason: string;
};

export type EvaluatorFlowState = {
  mode: EvaluatorMode;
  task: any;
  session: any;
  recentSummary: string;
  evaluation?: EvaluatorResult;
};
