import { z } from "zod";
import { FacilitySchema } from "../facility/schema";
import { IncidentSchema } from "../incident/schema";
import { PlanActionSchema } from "../plan-action/schema";
import { ResponsePlanSchema } from "../response-plan/schema";
import { ResourceSchema } from "../resource/schema";
import { RouteSchema } from "../route/schema";

export const EmergencyStateSchema = z
  .object({
    incident: IncidentSchema,
    resources: z.array(ResourceSchema),
    facilities: z.array(FacilitySchema),
    routes: z.array(RouteSchema),
    planActions: z.array(PlanActionSchema),
    activePlan: ResponsePlanSchema.nullable(),
    stateVersion: z.number().int().nonnegative(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((state, context) => {
    if (state.activePlan === null) {
      return;
    }

    if (state.activePlan.incidentId !== state.incident.id) {
      context.addIssue({
        code: "custom",
        path: ["activePlan", "incidentId"],
        message: "Active plan incidentId must match the state incident id.",
      });
    }

    if (state.activePlan.stateVersion > state.stateVersion) {
      context.addIssue({
        code: "custom",
        path: ["activePlan", "stateVersion"],
        message: "Active plan stateVersion cannot exceed EmergencyState stateVersion.",
      });
    }
  });

export type EmergencyState = z.infer<typeof EmergencyStateSchema>;
