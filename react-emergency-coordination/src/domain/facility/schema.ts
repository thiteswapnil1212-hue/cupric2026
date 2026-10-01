import { z } from "zod";

export const FacilityTypeSchema = z.enum([
  "HOSPITAL",
  "SHELTER",
  "MEDICAL_CENTER",
  "RELIEF_CENTER",
  "OTHER",
]);

export type FacilityType = z.infer<typeof FacilityTypeSchema>;

export const FacilityStatusSchema = z.enum([
  "OPERATIONAL",
  "LIMITED",
  "FULL",
  "CLOSED",
  "UNAVAILABLE",
]);

export type FacilityStatus = z.infer<typeof FacilityStatusSchema>;

const FacilityLocationSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    address: z.string(),
  })
  .strict();

export const FacilitySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: FacilityTypeSchema,
    status: FacilityStatusSchema,
    location: FacilityLocationSchema,
    totalCapacity: z.number().int().nonnegative(),
    availableCapacity: z.number().int().nonnegative(),
    capabilities: z.array(z.string()),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .refine((facility) => facility.availableCapacity <= facility.totalCapacity, {
    message: "Available capacity cannot exceed total capacity.",
    path: ["availableCapacity"],
  });

export type Facility = z.infer<typeof FacilitySchema>;
