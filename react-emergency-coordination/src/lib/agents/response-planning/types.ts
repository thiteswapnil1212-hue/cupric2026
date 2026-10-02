import type { PlanAction } from "../../../domain/plan-action/schema";
import type { ResponsePlan } from "../../../domain/response-plan/schema";
import type { PlanValidationResult } from "../../emergency-engine/plan-validator";
import type { AlternativeRecommendation } from "./schema";

export type ResponsePlanningAlternative = AlternativeRecommendation & {
  id: string;
};

export type ResponsePlanningResult = {
  plan: ResponsePlan;
  actions: readonly PlanAction[];
  alternatives: readonly ResponsePlanningAlternative[];
  constraints: readonly string[];
  reasoning: string;
  confidence: number;
  validation: PlanValidationResult;
};
