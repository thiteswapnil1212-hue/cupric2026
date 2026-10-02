import { z } from "zod";
import { EmergencyStateSchema } from "../../domain/emergency-state/schema";
import { ResponsePlanSchema } from "../../domain/response-plan/schema";
import type { RiskAssessment } from "../agents/risk-assessment/schema";
import type { ResourceRoutingAssessment } from "../agents/resource-routing/schema";
import {
  changeDetectionClassifications,
  type ChangeDetectionSuccess,
} from "../change-detection/schema";
import type { ReplanningError } from "./errors";

export const ReplanningRequestSchema = z
  .object({
    previousState: EmergencyStateSchema,
    currentState: EmergencyStateSchema,
    activePlan: ResponsePlanSchema,
    changeDetectionResult: z.custom<ChangeDetectionSuccess>((value) => {
      if (typeof value !== "object" || value === null) return false;
      const result = value as Partial<ChangeDetectionSuccess>;
      return (
        result.success === true &&
        typeof result.previousStateVersion === "number" &&
        typeof result.currentStateVersion === "number" &&
        changeDetectionClassifications.includes(
          result.classification as (typeof changeDetectionClassifications)[number],
        )
      );
    }),
  })
  .strict();

export type ReplanningRequest = z.infer<typeof ReplanningRequestSchema>;

export const ReplanningStatusSchema = z.enum([
  "NOT_REQUIRED",
  "REASSESSING",
  "PLAN_GENERATED",
  "VALIDATION_FAILED",
  "PENDING_HUMAN_APPROVAL",
  "FAILED",
]);

export type ReplanningStatus = z.infer<typeof ReplanningStatusSchema>;

export type ReplanningTiming = {
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly stages: readonly {
    readonly stage: "change-detection" | "risk-assessment" | "resource-routing" | "response-planning" | "validation";
    readonly durationMs: number;
  }[];
};

export type ReplanningResult = {
  readonly success: boolean;
  readonly status: ReplanningStatus;
  readonly incidentId: string;
  readonly previousPlanId: string;
  readonly previousPlanStateVersion: number;
  readonly currentStateVersion: number;
  readonly changeClassification: (typeof changeDetectionClassifications)[number];
  readonly affectedDependencies: ChangeDetectionSuccess["affectedDependencies"];
  readonly changeRecords: ChangeDetectionSuccess["changes"];
  readonly reassessmentPerformed: boolean;
  readonly riskAssessment: RiskAssessment | null;
  readonly resourceRoutingAssessment: ResourceRoutingAssessment | null;
  readonly revisedPlan: z.infer<typeof ResponsePlanSchema> | null;
  readonly validation: {
    readonly valid: boolean;
    readonly errors: readonly { readonly code: string; readonly message: string }[];
    readonly warnings: readonly { readonly code: string; readonly message: string }[];
  } | null;
  readonly previousPlanSuperseded: boolean;
  readonly previousPlanSupersessionPersisted: false;
  readonly timing: ReplanningTiming;
  readonly error: ReplanningError | null;
};
