import { z } from "zod";

export const IncidentTypeSchema = z.enum([
  "FIRE",
  "MEDICAL",
  "BUILDING_COLLAPSE",
  "FLOOD",
  "ROAD_ACCIDENT",
  "INDUSTRIAL_ACCIDENT",
  "OTHER",
]);

export type IncidentType = z.infer<typeof IncidentTypeSchema>;

export const IncidentStatusSchema = z.enum([
  "ACTIVE",
  "CONTAINED",
  "RESOLVED",
  "CANCELLED",
]);

export type IncidentStatus = z.infer<typeof IncidentStatusSchema>;

export const SeverityLevelSchema = z.enum([
  "LOW",
  "MODERATE",
  "HIGH",
  "CRITICAL",
]);

export type SeverityLevel = z.infer<typeof SeverityLevelSchema>;

export const PriorityLevelSchema = z.enum([
  "LOW",
  "NORMAL",
  "HIGH",
  "URGENT",
]);

export type PriorityLevel = z.infer<typeof PriorityLevelSchema>;

const IncidentLocationSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    address: z.string(),
  })
  .strict();

export const IncidentSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    type: IncidentTypeSchema,
    status: IncidentStatusSchema,
    severity: SeverityLevelSchema,
    priority: PriorityLevelSchema,
    location: IncidentLocationSchema,
    affectedPopulation: z.number().int().nonnegative(),
    hazards: z.array(z.string()),
    reportedAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export type Incident = z.infer<typeof IncidentSchema>;