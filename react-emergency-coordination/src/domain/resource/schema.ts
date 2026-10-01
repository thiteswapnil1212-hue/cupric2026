import { z } from "zod";

export const ResourceTypeSchema = z.enum([
  "RESCUE_TEAM",
  "AMBULANCE",
  "FIRE_UNIT",
  "POLICE_UNIT",
  "MEDICAL_TEAM",
  "HELICOPTER",
  "OTHER",
]);

export type ResourceType = z.infer<typeof ResourceTypeSchema>;

export const ResourceStatusSchema = z.enum([
  "AVAILABLE",
  "ASSIGNED",
  "DISPATCHED",
  "BUSY",
  "UNAVAILABLE",
  "OUT_OF_SERVICE",
]);

export type ResourceStatus = z.infer<typeof ResourceStatusSchema>;

const ResourceLocationSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  })
  .strict();

export const ResourceSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: ResourceTypeSchema,
    status: ResourceStatusSchema,
    location: ResourceLocationSchema,
    capacity: z.number().int().nonnegative(),
    currentAssignmentId: z.string().nullable(),
    capabilities: z.array(z.string()),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export type Resource = z.infer<typeof ResourceSchema>;
