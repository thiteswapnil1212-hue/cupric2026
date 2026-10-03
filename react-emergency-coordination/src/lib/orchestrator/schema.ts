import { z } from "zod";
import { EmergencyStateSchema } from "../../domain/emergency-state/schema";
import { ResourceRoutingAssessmentSchema } from "../agents/resource-routing/schema";
import { RiskAssessmentSchema } from "../agents/risk-assessment/schema";
import { ResponsePlanningResultSchema } from "../agents/response-planning/types";
import { GeminiGenerationMetadataSchema } from "../ai/gemini-contract";

export const ReactAgentStageSchema = z.enum([
  "risk-assessment",
  "resource-routing",
  "response-planning",
]);

export type ReactAgentStage = z.infer<typeof ReactAgentStageSchema>;

export const OrchestrationStatusSchema = z.enum([
  "COMPLETED",
  "FAILED",
  "PARTIAL_FAILURE",
]);

export const OrchestrationFailureCategorySchema = z.enum([
  "INVALID_STATE",
  "RISK_ASSESSMENT_FAILED",
  "RESOURCE_ROUTING_FAILED",
  "RESPONSE_PLANNING_FAILED",
  "PLAN_VALIDATION_FAILED",
  "PERSISTENCE_FAILED",
  "UNEXPECTED_ERROR",
]);

export const RecoveryRecommendationSchema = z.enum([
  "NONE",
  "RETRY_STAGE",
  "RELOAD_STATE",
  "REGENERATE_PLAN",
  "REPAIR_PERSISTENCE",
  "ABORT",
]);

export const OrchestrationRecoveryMetadataSchema = z
  .object({
    failureCategory: OrchestrationFailureCategorySchema.nullable(),
    retryable: z.boolean(),
    failedStage: ReactAgentStageSchema.nullable(),
    completedStages: z.array(ReactAgentStageSchema),
    completedWrites: z.array(z.string().trim().min(1)),
    usablePlanExists: z.boolean(),
    partialPersistence: z.boolean(),
    recommendation: RecoveryRecommendationSchema,
    geminiGeneration: GeminiGenerationMetadataSchema.optional(),
  })
  .strict();

export const OrchestratorStageTimingSchema = z
  .object({
    stage: ReactAgentStageSchema,
    startedAt: z.iso.datetime(),
    completedAt: z.iso.datetime(),
    durationMs: z.number().finite().nonnegative(),
  })
  .strict();

export const OrchestratorExecutionMetadataSchema = z
  .object({
    startedAt: z.iso.datetime(),
    completedAt: z.iso.datetime(),
    durationMs: z.number().finite().nonnegative(),
    stageTimings: z.tuple([
      OrchestratorStageTimingSchema.extend({
        stage: z.literal("risk-assessment"),
      }).strict(),
      OrchestratorStageTimingSchema.extend({
        stage: z.literal("resource-routing"),
      }).strict(),
      OrchestratorStageTimingSchema.extend({
        stage: z.literal("response-planning"),
      }).strict(),
    ]),
  })
  .strict();

export const ReactOrchestrationResultSchema = z
  .object({
    status: z.literal("COMPLETED").default("COMPLETED"),
    incidentId: EmergencyStateSchema.shape.incident.shape.id,
    stateVersion: EmergencyStateSchema.shape.stateVersion,
    usablePlanExists: z.literal(true).default(true),
    recovery: OrchestrationRecoveryMetadataSchema.default({
      failureCategory: null,
      retryable: false,
      failedStage: null,
      completedStages: [
        "risk-assessment",
        "resource-routing",
        "response-planning",
      ],
      completedWrites: [],
      usablePlanExists: true,
      partialPersistence: false,
      recommendation: "NONE",
    }),
    completedStages: z.tuple([
      z.literal("risk-assessment"),
      z.literal("resource-routing"),
      z.literal("response-planning"),
    ]),
    riskAssessment: RiskAssessmentSchema,
    resourceRoutingAssessment: ResourceRoutingAssessmentSchema,
    responsePlanning: ResponsePlanningResultSchema,
    execution: OrchestratorExecutionMetadataSchema,
  })
  .strict();

export type OrchestratorStageTiming = z.infer<
  typeof OrchestratorStageTimingSchema
>;
export type OrchestrationStatus = z.infer<typeof OrchestrationStatusSchema>;
export type OrchestrationFailureCategory = z.infer<
  typeof OrchestrationFailureCategorySchema
>;
export type RecoveryRecommendation = z.infer<
  typeof RecoveryRecommendationSchema
>;
export type OrchestrationRecoveryMetadata = z.infer<
  typeof OrchestrationRecoveryMetadataSchema
>;
export type OrchestratorExecutionMetadata = z.infer<
  typeof OrchestratorExecutionMetadataSchema
>;
export type ReactOrchestrationResult = z.infer<
  typeof ReactOrchestrationResultSchema
>;
