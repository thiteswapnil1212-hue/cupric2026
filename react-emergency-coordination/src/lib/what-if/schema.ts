import { z } from "zod";
import { EmergencyStateSchema } from "../../domain/emergency-state/schema";
import {
  WhatIfChangeSchema,
  WhatIfScenarioSchema,
} from "../../domain/what-if/schema";
import { PlanActionSchema } from "../../domain/plan-action/schema";
import { ResponsePlanSchema } from "../../domain/response-plan/schema";
import { AutoAiWorkflowResultSchema } from "../agents/auto-ai-workflow-contract";

export const WhatIfSimulationResultSchema = z
  .object({
    simulationId: z.string().trim().min(1),
    scenario: WhatIfScenarioSchema,
    incidentId: z.string().trim().min(1),
    stateVersion: z.number().int().nonnegative(),
    currentState: EmergencyStateSchema,
    hypotheticalState: EmergencyStateSchema,
    currentPlan: ResponsePlanSchema.nullable(),
    currentPlanValidationValid: z.boolean().nullable(),
    currentActions: z.array(PlanActionSchema),
    workflowResult: AutoAiWorkflowResultSchema,
    changes: z.array(WhatIfChangeSchema),
    createdAt: z.iso.datetime(),
  })
  .strict();

export type WhatIfSimulationResult = z.infer<
  typeof WhatIfSimulationResultSchema
>;
