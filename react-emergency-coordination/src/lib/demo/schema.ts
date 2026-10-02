import { z } from "zod";
import type { AgentRun } from "../../domain/agent-run/schema";
import type { EmergencyState } from "../../domain/emergency-state/schema";
import type { HumanDecision } from "../../domain/human-decision/schema";
import type { ResponsePlan } from "../../domain/response-plan/schema";
import type { StateChange } from "../../domain/state-change/schema";
import type { ResourceRoutingAssessment } from "../agents/resource-routing/schema";
import type { RiskAssessment } from "../agents/risk-assessment/schema";
import type { ResponsePlanningResult } from "../agents/response-planning/types";
import type { PlanValidationResult } from "../emergency-engine/plan-validator";

export const DemoStageSchema = z.enum([
  "IDLE",
  "EMERGENCY_INITIALIZED",
  "ANALYZING",
  "PLAN_GENERATED",
  "AWAITING_APPROVAL",
  "EXECUTING",
  "SITUATION_CHANGED",
  "CHANGE_DETECTED",
  "REASSESSING",
  "REVISED_PLAN_GENERATED",
  "AWAITING_REVISED_APPROVAL",
  "EXECUTING_REVISED_PLAN",
  "COMPLETED",
  "FAILED",
]);

export type DemoStage = z.infer<typeof DemoStageSchema>;

export type DemoError = {
  readonly code: string;
  readonly message: string;
  readonly stage: DemoStage;
  readonly recovery: "RETRY" | "RESET";
};

export type DemoSnapshot = {
  readonly stage: DemoStage;
  readonly state: EmergencyState;
  readonly agentRuns: readonly AgentRun[];
  readonly stateChanges: readonly StateChange[];
  readonly currentPlan: ResponsePlan | null;
  readonly previousPlan: ResponsePlan | null;
  readonly riskAssessment: RiskAssessment | null;
  readonly resourceRoutingAssessment: ResourceRoutingAssessment | null;
  readonly responsePlanningResult: ResponsePlanningResult | null;
  readonly validation: PlanValidationResult | null;
  readonly humanDecision: HumanDecision | null;
  readonly progress: {
    readonly current: number;
    readonly total: number;
    readonly label: string;
  };
  readonly error: DemoError | null;
};

export type DemoOperationResult =
  | { readonly success: true; readonly snapshot: DemoSnapshot }
  | { readonly success: false; readonly snapshot: DemoSnapshot; readonly error: DemoError };
