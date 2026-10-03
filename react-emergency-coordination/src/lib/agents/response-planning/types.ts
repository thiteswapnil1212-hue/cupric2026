import { z } from "zod";
import { PlanActionSchema } from "../../../domain/plan-action/schema";
import type { PlanAction } from "../../../domain/plan-action/schema";
import { ResponsePlanSchema } from "../../../domain/response-plan/schema";
import type { ResponsePlan } from "../../../domain/response-plan/schema";
import type { PlanValidationResult } from "../../emergency-engine/plan-validator";
import type { AlternativeRecommendation } from "./schema";
import {
  GeminiFailureCategorySchema,
  GeminiModelSchema,
} from "../../ai/gemini-contract";
import type {
  GeminiFailureCategory,
  GeminiModel,
} from "../../ai/gemini-contract";

export type ResponsePlanningGenerationMetadata = {
  aiAttempted: boolean;
  modelsAttempted: readonly GeminiModel[];
  selectedModel: GeminiModel | null;
  failureCategory: GeminiFailureCategory | null;
  fallbackActivated: boolean;
  fallbackValidation: PlanValidationResult | null;
};

const planValidationIssueSchema = z
  .object({
    code: z.string().trim().min(1),
    message: z.string().trim().min(1),
    actionId: z.string().optional(),
    entityType: z
      .enum(["PLAN", "INCIDENT", "ACTION", "RESOURCE", "FACILITY", "ROUTE"])
      .optional(),
    entityId: z.string().optional(),
  })
  .strict();

const planValidationResultSchema = z
  .object({
    valid: z.boolean(),
    errors: z.array(planValidationIssueSchema),
    warnings: z.array(planValidationIssueSchema),
  })
  .strict();

export const ResponsePlanningGenerationMetadataSchema = z
  .object({
    aiAttempted: z.boolean(),
    modelsAttempted: z.array(GeminiModelSchema),
    selectedModel: GeminiModelSchema.nullable(),
    failureCategory: GeminiFailureCategorySchema.nullable(),
    fallbackActivated: z.boolean(),
    fallbackValidation: planValidationResultSchema.nullable(),
  })
  .strict();

const responsePlanningAlternativeSchema = z
  .object({
    id: z.string().trim().min(1),
    summary: z.string().trim().min(1),
    rationale: z.string().trim().min(1),
    resourceIds: z.array(z.string().trim().min(1)),
    facilityIds: z.array(z.string().trim().min(1)),
    routeIds: z.array(z.string().trim().min(1)),
    recommendationOnly: z.literal(true),
  })
  .strict();

const responsePlanningResultShapeSchema = z
  .object({
    plan: ResponsePlanSchema,
    actions: z.array(PlanActionSchema),
    alternatives: z.array(responsePlanningAlternativeSchema),
    constraints: z.array(z.string()),
    reasoning: z.string(),
    confidence: z.number().min(0).max(1),
    validation: planValidationResultSchema,
    generation: ResponsePlanningGenerationMetadataSchema.optional(),
  })
  .strict();

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
  generation?: ResponsePlanningGenerationMetadata;
};

export const ResponsePlanningResultSchema = z.custom<ResponsePlanningResult>(
  (value) => responsePlanningResultShapeSchema.safeParse(value).success,
);
