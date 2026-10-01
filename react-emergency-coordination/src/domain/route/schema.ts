import { z } from "zod";

export const RouteStatusSchema = z.enum([
  "OPEN",
  "PARTIALLY_BLOCKED",
  "BLOCKED",
  "CLOSED",
]);

export type RouteStatus = z.infer<typeof RouteStatusSchema>;

const RouteCoordinateSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  })
  .strict();

export const RouteSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    status: RouteStatusSchema,
    distanceKm: z.number().finite().nonnegative(),
    estimatedTravelMinutes: z.number().finite().nonnegative(),
    origin: RouteCoordinateSchema,
    destination: RouteCoordinateSchema,
    blockedReason: z.string().min(1).nullable(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .refine(
    (route) => {
      if (route.status === "OPEN") {
        return route.blockedReason === null;
      }

      if (route.status === "BLOCKED" || route.status === "CLOSED") {
        return route.blockedReason !== null;
      }

      return true;
    },
    {
      message: "Blocked reason must match the route status.",
      path: ["blockedReason"],
    },
  );

export type Route = z.infer<typeof RouteSchema>;
