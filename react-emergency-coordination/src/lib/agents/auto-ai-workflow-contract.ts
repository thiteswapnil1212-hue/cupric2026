import { z } from "zod";
import { ResourceRoutingAssessmentSchema } from "./resource-routing/schema";
import { RiskAssessmentSchema } from "./risk-assessment/schema";
import { ResponsePlanningResultSchema } from "./response-planning/types";

export const AutoAiWorkflowResultSchema = z
  .object({
    riskAssessment: RiskAssessmentSchema,
    resourceRoutingAssessment: ResourceRoutingAssessmentSchema,
    responsePlanningResult: ResponsePlanningResultSchema,
  })
  .strict();

export type AutoAiWorkflowResult = z.infer<typeof AutoAiWorkflowResultSchema>;
