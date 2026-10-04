import "server-only";

import { z } from "zod";
import type { EmergencyState } from "../../domain/emergency-state/schema";
import {
  WhatIfScenarioSchema,
  type WhatIfChangeSchema,
  type WhatIfScenario,
} from "../../domain/what-if/schema";
import { EmergencyStateSchema } from "../../domain/emergency-state/schema";
import { validateEmergencyStateConsistency } from "../emergency-state/consistency";
import { loadEmergencyState } from "../emergency-state/loader";
import {
  runAutoAiWorkflow,
  type AutoAiWorkflowDependencies,
} from "../agents/auto-ai-workflow";
import { validatePlan } from "../emergency-engine/plan-validator";
import { getDemoState } from "../demo/fixtures";
import { getServerDemoSnapshot } from "../demo/server-session";
import { WhatIfSimulationResultSchema } from "./schema";

export class WhatIfSimulationError extends Error {
  constructor(
    readonly code:
      | "WHAT_IF_STATE_INVALID"
      | "WHAT_IF_TARGET_NOT_FOUND"
      | "WHAT_IF_PLAN_INVALID",
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "WhatIfSimulationError";
  }
}

export type WhatIfSimulationDependencies = {
  loadState?: typeof loadEmergencyState;
  workflowDependencies?: AutoAiWorkflowDependencies;
  now?: () => Date;
  baselineState?: EmergencyState;
};

function currentPlan(state: EmergencyState): EmergencyState["activePlan"] {
  return state.activePlan;
}

async function loadServerOwnedWhatIfState(
  incidentId: string,
): Promise<EmergencyState> {
  const demoState = getDemoState("initial").state;
  if (incidentId === demoState.incident.id) {
    return (await getServerDemoSnapshot()).state;
  }
  return loadEmergencyState(incidentId);
}

export type AppliedWhatIfScenario = {
  hypotheticalState: EmergencyState;
  changes: z.infer<typeof WhatIfChangeSchema>[];
};

function targetNotFound(): never {
  throw new WhatIfSimulationError(
    "WHAT_IF_TARGET_NOT_FOUND",
    `The selected What-If target is not present in the current incident state.`,
    422,
  );
}

export function applyWhatIfScenario(
  currentState: EmergencyState,
  scenarioInput: WhatIfScenario,
  timestamp: string,
): AppliedWhatIfScenario {
  const currentValidation = EmergencyStateSchema.safeParse(currentState);
  if (!currentValidation.success) {
    throw new WhatIfSimulationError(
      "WHAT_IF_STATE_INVALID",
      "The current emergency state is invalid; no simulation was run.",
      422,
    );
  }
  const consistency = validateEmergencyStateConsistency(currentValidation.data);
  if (!consistency.valid) {
    throw new WhatIfSimulationError(
      "WHAT_IF_STATE_INVALID",
      "The current emergency state is inconsistent; no simulation was run.",
      422,
    );
  }
  const scenarioValidation = WhatIfScenarioSchema.safeParse(scenarioInput);
  if (!scenarioValidation.success) {
    throw new WhatIfSimulationError(
      "WHAT_IF_TARGET_NOT_FOUND",
      "The requested What-If scenario is not supported.",
      400,
    );
  }

  const scenario = scenarioValidation.data;
  const hypotheticalState = structuredClone(currentValidation.data);
  const changes: AppliedWhatIfScenario["changes"] = [];
  const recordChange = (
    entityType: z.infer<typeof WhatIfChangeSchema>["entityType"],
    entityId: string,
    field: string,
    previousValue: string | number,
    hypotheticalValue: string | number,
  ) => {
    if (previousValue === hypotheticalValue) return;
    changes.push({
      entityType,
      entityId,
      field,
      previousValue,
      hypotheticalValue,
    });
  };

  switch (scenario.type) {
    case "ROUTE_BLOCKED": {
      const route = hypotheticalState.routes.find(
        (candidate) => candidate.id === scenario.targetId,
      );
      if (route === undefined) targetNotFound();
      recordChange("ROUTE", route.id, "status", route.status, "BLOCKED");
      route.status = "BLOCKED";
      route.blockedReason =
        route.blockedReason ?? "Blocked in What-If simulation.";
      route.updatedAt = timestamp;
      break;
    }
    case "FACILITY_UNAVAILABLE": {
      const facility = hypotheticalState.facilities.find(
        (candidate) => candidate.id === scenario.targetId,
      );
      if (facility === undefined) targetNotFound();
      recordChange(
        "FACILITY",
        facility.id,
        "status",
        facility.status,
        "UNAVAILABLE",
      );
      recordChange(
        "FACILITY",
        facility.id,
        "availableCapacity",
        facility.availableCapacity,
        0,
      );
      facility.status = "UNAVAILABLE";
      facility.availableCapacity = 0;
      facility.updatedAt = timestamp;
      break;
    }
    case "RESOURCE_UNAVAILABLE": {
      const resource = hypotheticalState.resources.find(
        (candidate) => candidate.id === scenario.targetId,
      );
      if (resource === undefined) targetNotFound();
      recordChange(
        "RESOURCE",
        resource.id,
        "status",
        resource.status,
        "UNAVAILABLE",
      );
      resource.status = "UNAVAILABLE";
      resource.updatedAt = timestamp;
      break;
    }
    case "AFFECTED_POPULATION_INCREASE": {
      const previousPopulation =
        hypotheticalState.incident.affectedPopulation;
      const hypotheticalPopulation = previousPopulation + scenario.value;
      if (!Number.isSafeInteger(hypotheticalPopulation)) {
        throw new WhatIfSimulationError(
          "WHAT_IF_STATE_INVALID",
          "The hypothetical affected-population value is invalid.",
          422,
        );
      }
      recordChange(
        "INCIDENT",
        hypotheticalState.incident.id,
        "affectedPopulation",
        previousPopulation,
        hypotheticalPopulation,
      );
      hypotheticalState.incident.affectedPopulation = hypotheticalPopulation;
      hypotheticalState.incident.updatedAt = timestamp;
      break;
    }
  }

  hypotheticalState.updatedAt = timestamp;
  const hypotheticalValidation = EmergencyStateSchema.safeParse(
    hypotheticalState,
  );
  if (!hypotheticalValidation.success) {
    throw new WhatIfSimulationError(
      "WHAT_IF_STATE_INVALID",
      "The hypothetical state failed emergency-state validation.",
      422,
    );
  }
  const hypotheticalConsistency = validateEmergencyStateConsistency(
    hypotheticalValidation.data,
  );
  if (!hypotheticalConsistency.valid) {
    throw new WhatIfSimulationError(
      "WHAT_IF_STATE_INVALID",
      "The hypothetical state failed consistency validation.",
      422,
    );
  }
  return {
    hypotheticalState: hypotheticalValidation.data,
    changes,
  };
}

export async function runWhatIfSimulation(
  incidentId: string,
  scenario: WhatIfScenario,
  dependencies: WhatIfSimulationDependencies = {},
): Promise<z.infer<typeof WhatIfSimulationResultSchema>> {
  const loadState =
    dependencies.loadState ?? loadServerOwnedWhatIfState;
  const demoIncidentId = getDemoState("initial").state.incident.id;
  if (
    dependencies.baselineState !== undefined &&
    incidentId !== demoIncidentId
  ) {
    throw new WhatIfSimulationError(
      "WHAT_IF_STATE_INVALID",
      "A client baseline is only accepted for the local demo incident.",
      400,
    );
  }
  const currentState =
    dependencies.baselineState ?? await loadState(incidentId);
  if (currentState.incident.id !== incidentId) {
    throw new WhatIfSimulationError(
      "WHAT_IF_STATE_INVALID",
      "The loaded emergency state does not match the requested incident.",
      409,
    );
  }

  const now = (dependencies.now ?? (() => new Date()))();
  const timestamp = now.toISOString();
  const { hypotheticalState, changes } = applyWhatIfScenario(
    currentState,
    scenario,
    timestamp,
  );
  const simulationId = `SIM-${crypto.randomUUID()}`;
  const workflowResult = await runAutoAiWorkflow(
    hypotheticalState,
    simulationId,
    dependencies.workflowDependencies,
  );

  const responsePlanningResult = workflowResult.responsePlanningResult;
  const candidateState: EmergencyState = {
    ...hypotheticalState,
    planActions: [
      ...hypotheticalState.planActions,
      ...responsePlanningResult.actions,
    ],
  };
  const validation = validatePlan(
    responsePlanningResult.plan,
    candidateState,
  );
  if (!validation.valid) {
    throw new WhatIfSimulationError(
      "WHAT_IF_PLAN_INVALID",
      "The hypothetical response plan failed deterministic validation; it is not available as a recommendation.",
      500,
    );
  }

  const validatedWorkflow = {
    ...workflowResult,
    responsePlanningResult: {
      ...responsePlanningResult,
      validation,
    },
  };
  const realPlan = currentPlan(currentState);
  return WhatIfSimulationResultSchema.parse({
    simulationId,
    scenario,
    incidentId,
    stateVersion: currentState.stateVersion,
    currentState,
    hypotheticalState,
    currentPlan: realPlan,
    currentPlanValidationValid:
      realPlan === null
        ? null
        : validatePlan(realPlan, currentState).valid,
    currentActions:
      realPlan === null
        ? []
        : realPlan.actions.map((reference) => {
            const action = currentState.planActions.find(
              (candidate) =>
                candidate.id === reference.actionId &&
                candidate.sequence === reference.sequence,
            );
            if (action === undefined) {
              throw new WhatIfSimulationError(
                "WHAT_IF_STATE_INVALID",
                "The current response plan references missing operational data.",
                422,
              );
            }
            return action;
          }),
    workflowResult: validatedWorkflow,
    changes,
    createdAt: timestamp,
  });
}
