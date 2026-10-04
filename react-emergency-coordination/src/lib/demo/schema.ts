import { z } from "zod";
import { AgentRunSchema } from "../../domain/agent-run/schema";
import { EmergencyStateSchema } from "../../domain/emergency-state/schema";
import { HumanDecisionSchema } from "../../domain/human-decision/schema";
import { ResponsePlanSchema } from "../../domain/response-plan/schema";
import { StateChangeSchema } from "../../domain/state-change/schema";
import type { AgentRun } from "../../domain/agent-run/schema";
import type { EmergencyState } from "../../domain/emergency-state/schema";
import type { HumanDecision } from "../../domain/human-decision/schema";
import type { ResponsePlan } from "../../domain/response-plan/schema";
import type { StateChange } from "../../domain/state-change/schema";
import { ResourceRoutingAssessmentSchema } from "../agents/resource-routing/schema";
import { RiskAssessmentSchema } from "../agents/risk-assessment/schema";
import { ResponsePlanningResultSchema } from "../agents/response-planning/types";
import type { PlanValidationResult } from "../emergency-engine/plan-validator";
import type { ResourceRoutingAssessment } from "../agents/resource-routing/schema";
import type { RiskAssessment } from "../agents/risk-assessment/schema";
import type { ResponsePlanningResult } from "../agents/response-planning/types";

export const DemoStageSchema = z.enum([
  "IDLE",
  "EMERGENCY_INITIALIZED",
  "ANALYZING",
  "PLAN_GENERATED",
  "AWAITING_APPROVAL",
  "AWAITING_EXECUTION",
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
  readonly recoverable: boolean;
  readonly occurredAt: string;
};

export type DemoSnapshot = {
  readonly stage: DemoStage;
  readonly state: EmergencyState;
  readonly agentRuns: readonly AgentRun[];
  readonly stateChanges: readonly StateChange[];
  readonly currentPlan: ResponsePlan | null;
  readonly previousPlan: ResponsePlan | null;
  readonly planHistory: readonly ResponsePlan[];
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

function isPlanValidationResult(value: unknown): value is PlanValidationResult {
  if (typeof value !== "object" || value === null || !("valid" in value) ||
      !("errors" in value) || !("warnings" in value) ||
      typeof value.valid !== "boolean" ||
      !Array.isArray(value.errors) || !Array.isArray(value.warnings)) {
    return false;
  }
  return [...value.errors, ...value.warnings].every((issue) =>
    typeof issue === "object" && issue !== null &&
    "code" in issue && typeof issue.code === "string" &&
    "message" in issue && typeof issue.message === "string" &&
    (!("actionId" in issue) || issue.actionId === undefined || typeof issue.actionId === "string") &&
    (!("entityType" in issue) || issue.entityType === undefined || typeof issue.entityType === "string") &&
    (!("entityId" in issue) || issue.entityId === undefined || typeof issue.entityId === "string"),
  );
}

const demoErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  stage: DemoStageSchema,
  recovery: z.enum(["RETRY", "RESET"]),
  recoverable: z.boolean(),
  occurredAt: z.iso.datetime(),
}).strict();

export const DemoSnapshotSchema = z.object({
  stage: DemoStageSchema,
  state: EmergencyStateSchema,
  agentRuns: z.array(AgentRunSchema),
  stateChanges: z.array(StateChangeSchema),
  currentPlan: ResponsePlanSchema.nullable(),
  previousPlan: ResponsePlanSchema.nullable(),
  planHistory: z.array(ResponsePlanSchema),
  riskAssessment: RiskAssessmentSchema.nullable(),
  resourceRoutingAssessment: ResourceRoutingAssessmentSchema.nullable(),
  responsePlanningResult: ResponsePlanningResultSchema.nullable(),
  validation: z.custom<PlanValidationResult>(isPlanValidationResult).nullable(),
  humanDecision: HumanDecisionSchema.nullable(),
  progress: z.object({
    current: z.number().int().nonnegative(),
    total: z.number().int().positive(),
    label: z.string(),
  }).strict(),
  error: demoErrorSchema.nullable(),
}).strict();

const demoOperationResultSchema = z.discriminatedUnion("success", [
  z.object({ success: z.literal(true), snapshot: DemoSnapshotSchema }).strict(),
  z.object({
    success: z.literal(false),
    snapshot: DemoSnapshotSchema,
    error: demoErrorSchema,
  }).strict(),
]);

export function parseDemoSnapshot(value: unknown): DemoSnapshot | null {
  const parsed = DemoSnapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseDemoOperationResult(value: unknown): DemoOperationResult | null {
  const parsed = demoOperationResultSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export type DemoOperationResult =
  | { readonly success: true; readonly snapshot: DemoSnapshot }
  | { readonly success: false; readonly snapshot: DemoSnapshot; readonly error: DemoError };
