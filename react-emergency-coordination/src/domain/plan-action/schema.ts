import { z } from "zod";
import { PlanPrioritySchema } from "../response-plan/schema";

const nonEmptyStringSchema = z.string().trim().min(1);

export const PlanActionTypeSchema = z.enum([
  "DISPATCH_RESOURCE",
  "ASSIGN_RESOURCE",
  "TRANSPORT_PEOPLE",
  "EVACUATE_AREA",
  "CLOSE_ROUTE",
  "OPEN_ROUTE",
  "ESTABLISH_TRIAGE",
  "SHELTER_PEOPLE",
  "NOTIFY_FACILITY",
  "OTHER",
]);

export type PlanActionType = z.infer<typeof PlanActionTypeSchema>;

export const PlanActionStatusSchema = z.enum([
  "PENDING",
  "APPROVED",
  "IN_PROGRESS",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

export type PlanActionStatus = z.infer<typeof PlanActionStatusSchema>;

const PlanActionTargetLocationSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  })
  .strict();

export const PlanActionSchema = z
  .object({
    id: nonEmptyStringSchema,
    planId: nonEmptyStringSchema,
    sequence: z.number().int().min(1),
    type: PlanActionTypeSchema,
    status: PlanActionStatusSchema,
    description: nonEmptyStringSchema,
    priority: PlanPrioritySchema,
    resourceIds: z.array(nonEmptyStringSchema),
    facilityIds: z.array(nonEmptyStringSchema),
    routeIds: z.array(nonEmptyStringSchema),
    capacityDemand: z.number().int().positive().nullable().optional(),
    targetLocation: PlanActionTargetLocationSchema.nullable(),
    estimatedDurationMinutes: z.number().finite().nonnegative(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .refine(
    (action) =>
      action.resourceIds.length > 0 ||
      action.facilityIds.length > 0 ||
      action.routeIds.length > 0 ||
      action.targetLocation !== null,
    {
      message: "A plan action must reference at least one execution target.",
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

export type PlanAction = z.infer<typeof PlanActionSchema>;
