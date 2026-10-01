import { z } from "zod";

const nonEmptyStringSchema = z.string().trim().min(1);

export const PlanStatusSchema = z.enum([
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "MODIFIED",
  "EXECUTING",
  "COMPLETED",
  "SUPERSEDED",
  "INVALID",
]);

export type PlanStatus = z.infer<typeof PlanStatusSchema>;

export const PlanPrioritySchema = z.enum([
  "LOW",
  "NORMAL",
  "HIGH",
  "URGENT",
]);

export type PlanPriority = z.infer<typeof PlanPrioritySchema>;

export const PlanActionReferenceSchema = z
  .object({
    actionId: nonEmptyStringSchema,
    sequence: z.number().int().min(1),
  })
  .strict();

export type PlanActionReference = z.infer<typeof PlanActionReferenceSchema>;

export const AlternativePlanReferenceSchema = z
  .object({
    id: nonEmptyStringSchema,
    summary: nonEmptyStringSchema,
    rationale: nonEmptyStringSchema,
  })
  .strict();

export type AlternativePlanReference = z.infer<
  typeof AlternativePlanReferenceSchema
>;

export const PlanDependenciesSchema = z
  .object({
    resourceIds: z.array(nonEmptyStringSchema),
    facilityIds: z.array(nonEmptyStringSchema),
    routeIds: z.array(nonEmptyStringSchema),
  })
  .strict();

export type PlanDependencies = z.infer<typeof PlanDependenciesSchema>;

export const ResponsePlanSchema = z
  .object({
    id: nonEmptyStringSchema,
    incidentId: nonEmptyStringSchema,
    stateVersion: z.number().int().nonnegative(),
    status: PlanStatusSchema,
    priority: PlanPrioritySchema,
    summary: nonEmptyStringSchema,
    rationale: nonEmptyStringSchema,
    generatedAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    actions: z.array(PlanActionReferenceSchema).min(1),
    alternatives: z.array(AlternativePlanReferenceSchema),
    dependencies: PlanDependenciesSchema,
  })
  .strict();

export type ResponsePlan = z.infer<typeof ResponsePlanSchema>;
