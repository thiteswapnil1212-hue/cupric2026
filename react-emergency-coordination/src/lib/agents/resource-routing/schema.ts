import { z } from "zod";
import { FacilityStatusSchema } from "../../../domain/facility/schema";
import { ResourceStatusSchema } from "../../../domain/resource/schema";
import { RouteStatusSchema } from "../../../domain/route/schema";

const boundedIdSchema = z.string().trim().min(1).max(128);
const boundedNoteSchema = z.string().trim().min(1).max(240);

export const ResourceAvailabilitySchema = z.enum([
  "AVAILABLE",
  "ASSIGNED",
  "UNAVAILABLE",
]);

export const FacilityCapacityStatusSchema = z.enum([
  "AVAILABLE",
  "LIMITED",
  "FULL",
  "UNAVAILABLE",
]);

export const RouteUsabilitySchema = z.enum([
  "USABLE",
  "PARTIALLY_BLOCKED",
  "BLOCKED",
  "CLOSED",
]);

export const ResourceRoutingResourceSchema = z
  .object({
    resourceId: boundedIdSchema,
    status: ResourceStatusSchema,
    availability: ResourceAvailabilitySchema,
    capacity: z.number().int().nonnegative(),
    capabilityMatch: z.array(boundedNoteSchema.max(120)).max(20),
    notes: z.array(boundedNoteSchema).max(6),
  })
  .strict();

export const ResourceRoutingFacilitySchema = z
  .object({
    facilityId: boundedIdSchema,
    status: FacilityStatusSchema,
    totalCapacity: z.number().int().nonnegative(),
    availableCapacity: z.number().int().nonnegative(),
    capacityStatus: FacilityCapacityStatusSchema,
    notes: z.array(boundedNoteSchema).max(6),
  })
  .strict();

export const ResourceRoutingRouteSchema = z
  .object({
    routeId: boundedIdSchema,
    status: RouteStatusSchema,
    distanceKm: z.number().finite().nonnegative(),
    estimatedTravelMinutes: z.number().finite().nonnegative(),
    usability: RouteUsabilitySchema,
    notes: z.array(boundedNoteSchema).max(6),
  })
  .strict();

export const ResourceRoutingAssessmentSchema = z
  .object({
    resources: z.array(ResourceRoutingResourceSchema).max(100),
    facilities: z.array(ResourceRoutingFacilitySchema).max(100),
    routes: z.array(ResourceRoutingRouteSchema).max(100),
    constraints: z.array(boundedNoteSchema).max(20),
    reasoning: z.string().trim().min(1).max(2000),
  })
  .strict();

export type ResourceRoutingResource = z.infer<
  typeof ResourceRoutingResourceSchema
>;
export type ResourceRoutingFacility = z.infer<
  typeof ResourceRoutingFacilitySchema
>;
export type ResourceRoutingRoute = z.infer<typeof ResourceRoutingRouteSchema>;
export type ResourceRoutingAssessment = z.infer<
  typeof ResourceRoutingAssessmentSchema
>;
