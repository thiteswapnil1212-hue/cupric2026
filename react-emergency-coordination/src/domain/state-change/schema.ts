import { z } from "zod";

const nonEmptyTrimmedStringSchema = z.string().trim().min(1);
const nullableUnknownValueSchema = z
  .unknown()
  .nullable()
  .refine((value) => value !== undefined);

export const StateChangeEntityTypeSchema = z.enum([
  "INCIDENT",
  "RESOURCE",
  "FACILITY",
  "ROUTE",
  "PLAN",
  "OTHER",
]);

export type StateChangeEntityType = z.infer<
  typeof StateChangeEntityTypeSchema
>;

export const StateChangeTypeSchema = z.enum([
  "CREATED",
  "UPDATED",
  "STATUS_CHANGED",
  "CAPACITY_CHANGED",
  "AVAILABILITY_CHANGED",
  "LOCATION_CHANGED",
  "SEVERITY_CHANGED",
  "HAZARD_CHANGED",
  "ROUTE_CHANGED",
  "POPULATION_CHANGED",
  "OTHER",
]);

export type StateChangeType = z.infer<typeof StateChangeTypeSchema>;

export const StateChangeSchema = z
  .object({
    id: z.string(),
    entityType: StateChangeEntityTypeSchema,
    entityId: nonEmptyTrimmedStringSchema,
    changeType: StateChangeTypeSchema,
    description: nonEmptyTrimmedStringSchema,
    previousValue: nullableUnknownValueSchema,
    newValue: nullableUnknownValueSchema,
    occurredAt: z.iso.datetime(),
    detectedAt: z.iso.datetime(),
  })
  .strict()
  .refine(
    (change) => change.previousValue !== null || change.newValue !== null,
    {
      message: "A state change must include a previous or new value.",
      path: ["newValue"],
    },
  )
  .refine(
    (change) => Date.parse(change.detectedAt) >= Date.parse(change.occurredAt),
    {
      message: "Detected time cannot be earlier than occurrence time.",
      path: ["detectedAt"],
    },
  );

export type StateChange = z.infer<typeof StateChangeSchema>;
