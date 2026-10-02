import { z } from "zod";
import {
  PlanActionSchema,
  PlanActionTypeSchema,
} from "../../../domain/plan-action/schema";
import { PlanPrioritySchema } from "../../../domain/response-plan/schema";

const boundedIdSchema = z.string().trim().min(1).max(128);
const boundedTextSchema = z.string().trim().min(1).max(1000);

const ProposedPlanActionSchema = z
  .object({
    sequence: PlanActionSchema.shape.sequence.max(50),
    type: PlanActionTypeSchema,
    description: PlanActionSchema.shape.description.max(500),
    priority: PlanPrioritySchema,
    resourceIds: z.array(boundedIdSchema).max(20),
    facilityIds: z.array(boundedIdSchema).max(20),
    routeIds: z.array(boundedIdSchema).max(20),
    capacityDemand: PlanActionSchema.shape.capacityDemand,
    targetLocation: PlanActionSchema.shape.targetLocation,
    estimatedDurationMinutes: PlanActionSchema.shape.estimatedDurationMinutes,
  })
  .strict()
  .refine(
    (action) =>
      action.resourceIds.length > 0 ||
      action.facilityIds.length > 0 ||
      action.routeIds.length > 0 ||
      action.targetLocation !== null,
    {
      message: "A proposed action must reference an execution target.",
      path: ["resourceIds"],
    },
  )
  .refine(
    (action) =>
      action.type !== "SHELTER_PEOPLE" ||
      (action.capacityDemand !== undefined && action.capacityDemand !== null),
    {
      message: "SHELTER_PEOPLE actions require a positive capacityDemand.",
      path: ["capacityDemand"],
    },
  );

export const AlternativeRecommendationSchema = z
  .object({
    summary: boundedTextSchema,
    rationale: boundedTextSchema,
    resourceIds: z.array(boundedIdSchema).max(20),
    facilityIds: z.array(boundedIdSchema).max(20),
    routeIds: z.array(boundedIdSchema).max(20),
  })
  .strict();

export const ResponsePlanningOutputSchema = z
  .object({
    primaryPlan: z
      .object({
        summary: boundedTextSchema,
        rationale: boundedTextSchema,
        priority: PlanPrioritySchema,
        actions: z
          .array(ProposedPlanActionSchema)
          .min(1)
          .max(50)
          .superRefine((actions, context) => {
            const seenSequences = new Set<number>();
            for (const [index, action] of actions.entries()) {
              if (seenSequences.has(action.sequence)) {
                context.addIssue({
                  code: "custom",
                  path: [index, "sequence"],
                  message: "Proposed action sequences must be unique.",
                });
              }
              seenSequences.add(action.sequence);
            }
          }),
      })
      .strict(),
    alternatives: z.array(AlternativeRecommendationSchema).max(5),
    constraints: z.array(boundedTextSchema.max(500)).max(20),
    reasoning: boundedTextSchema.max(2000),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export type ProposedPlanAction = z.infer<typeof ProposedPlanActionSchema>;
export type AlternativeRecommendation = z.infer<
  typeof AlternativeRecommendationSchema
> & { recommendationOnly: true };
export type ResponsePlanningOutput = z.infer<
  typeof ResponsePlanningOutputSchema
>;
