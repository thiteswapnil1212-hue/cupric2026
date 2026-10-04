import assert from "node:assert/strict";
import type { EmergencyState } from "../src/domain/emergency-state/schema";
import {
  createRouteBlockedScenario,
  WHAT_IF_SCENARIOS,
  WhatIfScenarioSchema,
  type WhatIfScenario,
} from "../src/domain/what-if/schema";
import type { WhatIfSimulationResult } from "../src/lib/what-if/schema";
import { createDeterministicAssessments } from "../src/lib/agents/deterministic-fallback";
import type { AutoAiWorkflowDependencies } from "../src/lib/agents/auto-ai-workflow";
import { ResponsePlanningOutputSchema, type ResponsePlanningOutput } from "../src/lib/agents/response-planning/schema";
import { runResponsePlanning } from "../src/lib/agents/response-planning/agent";
import type { GenerateStructuredJsonOptions } from "../src/lib/ai/gemini";
import type { GeminiGenerationMetadata } from "../src/lib/ai/gemini-contract";
import { validatePlan } from "../src/lib/emergency-engine/plan-validator";
import { getDemoState } from "../src/lib/demo/fixtures";
import {
  applyWhatIfScenario,
  runWhatIfSimulation,
} from "../src/lib/what-if/service";
import { POST as handleWhatIfRequest } from "../src/app/api/demo/what-if/route";

const original = getDemoState("initial").state;
const pristineOriginal = structuredClone(original);
const aiMetadata: GeminiGenerationMetadata = {
  selectedModel: "gemini-3.8-flash",
  attemptedModels: ["gemini-3.8-flash"],
  fallbackUsed: false,
  finalProviderFailure: null,
};

function proposalFor(state: EmergencyState): ResponsePlanningOutput {
  const accessPairs = state.resources.flatMap((resource) =>
    (resource.type === "RESCUE_TEAM" || resource.type === "AMBULANCE") &&
    resource.status === "AVAILABLE" &&
    resource.currentAssignmentId === null
      ? state.routes
          .filter(
            (route) =>
              route.status === "OPEN" &&
              route.origin.latitude === resource.location.latitude &&
              route.origin.longitude === resource.location.longitude &&
              route.destination.latitude === state.incident.location.latitude &&
              route.destination.longitude === state.incident.location.longitude,
          )
          .map((route) => ({ resource, route }))
      : [],
  );
  const rescue = accessPairs.find(
    ({ resource }) => resource.type === "RESCUE_TEAM",
  );
  const ambulance = accessPairs.find(
    ({ resource }) => resource.type === "AMBULANCE",
  );
  const facility = state.facilities.find(
    (candidate) =>
      (candidate.status === "OPERATIONAL" || candidate.status === "LIMITED") &&
      candidate.availableCapacity > 0 &&
      candidate.capabilities.some((capability) =>
        /emergency care|medical|trauma/i.test(capability),
      ) &&
      state.routes.some(
        (route) =>
          route.status === "OPEN" &&
          route.origin.latitude === state.incident.location.latitude &&
          route.origin.longitude === state.incident.location.longitude &&
          route.destination.latitude === candidate.location.latitude &&
          route.destination.longitude === candidate.location.longitude,
      ),
  );
  assert.ok(rescue);
  assert.ok(ambulance);
  assert.ok(facility);
  const facilityRoute = state.routes.find(
    (route) =>
      route.status === "OPEN" &&
      route.origin.latitude === state.incident.location.latitude &&
      route.origin.longitude === state.incident.location.longitude &&
      route.destination.latitude === facility.location.latitude &&
      route.destination.longitude === facility.location.longitude,
  );
  assert.ok(facilityRoute);
  const primaryPairs = new Set([
    `${rescue.resource.id}:${rescue.route.id}`,
    `${ambulance.resource.id}:${ambulance.route.id}`,
  ]);
  const alternative = accessPairs.find(
    ({ resource, route }) =>
      !primaryPairs.has(`${resource.id}:${route.id}`),
  );
  const location = {
    latitude: state.incident.location.latitude,
    longitude: state.incident.location.longitude,
  };
  return ResponsePlanningOutputSchema.parse({
    primaryPlan: {
      summary: "Coordinate feasible rescue, ambulance, and facility response.",
      rationale: "The plan uses only currently available resources and routes.",
      priority: "URGENT",
      actions: [
        {
          sequence: 1,
          type: "DISPATCH_RESOURCE",
          description: `Dispatch ${rescue.resource.name} via ${rescue.route.name}.`,
          priority: "URGENT",
          resourceIds: [rescue.resource.id],
          facilityIds: [],
          routeIds: [rescue.route.id],
          capacityDemand: null,
          targetLocation: location,
          estimatedDurationMinutes: rescue.route.estimatedTravelMinutes,
        },
        {
          sequence: 2,
          type: "DISPATCH_RESOURCE",
          description: `Dispatch ${ambulance.resource.name} via ${ambulance.route.name}.`,
          priority: "URGENT",
          resourceIds: [ambulance.resource.id],
          facilityIds: [],
          routeIds: [ambulance.route.id],
          capacityDemand: null,
          targetLocation: location,
          estimatedDurationMinutes: ambulance.route.estimatedTravelMinutes,
        },
        {
          sequence: 3,
          type: "NOTIFY_FACILITY",
          description: `Allocate recorded capacity at ${facility.name}.`,
          priority: "HIGH",
          resourceIds: [],
          facilityIds: [facility.id],
          routeIds: [facilityRoute.id],
          capacityDemand: Math.min(
            state.incident.affectedPopulation,
            facility.availableCapacity,
          ),
          targetLocation: {
            latitude: facility.location.latitude,
            longitude: facility.location.longitude,
          },
          estimatedDurationMinutes: facilityRoute.estimatedTravelMinutes,
        },
      ],
    },
    alternatives: alternative
      ? [
          {
            summary: `Use ${alternative.resource.name} via ${alternative.route.name}.`,
            rationale: "This resource and route are currently feasible.",
            resourceIds: [alternative.resource.id],
            facilityIds: [],
            routeIds: [alternative.route.id],
          },
        ]
      : [],
    constraints: ["Use only recorded availability, route status, and capacity."],
    reasoning: "Structured fixture plan based on the supplied cloned state.",
    confidence: 1,
  });
}

function successfulWorkflowDependencies(): AutoAiWorkflowDependencies {
  return {
    riskAssessment: async (state) =>
      createDeterministicAssessments(state).riskAssessment,
    resourceRouting: async (state) =>
      createDeterministicAssessments(state).resourceRoutingAssessment,
    responsePlanning: async (state, risk, routing, planId) =>
      runResponsePlanning(state, risk, routing, {
        planId,
        generateStructuredJson: async <T>(
          options: GenerateStructuredJsonOptions<T>,
        ) => {
          options.onMetadata?.(aiMetadata);
          return options.schema.parse(proposalFor(state));
        },
      }),
  };
}

function failedWorkflowDependencies(
  category: "PROVIDER_UNAVAILABLE",
): AutoAiWorkflowDependencies {
  const metadata: GeminiGenerationMetadata = {
    selectedModel: null,
    attemptedModels: [
      "gemini-3.8-flash",
      "gemini-3.7-flash",
      "gemini-2.5-flash",
    ],
    fallbackUsed: true,
    finalProviderFailure: {
      code: "GEMINI_AI_UNAVAILABLE",
      category,
      httpStatus: 503,
    },
  };
  return {
    riskAssessment: async () => {
      throw Object.assign(new Error("sanitized fixture failure"), {
        code: "RISK_ASSESSMENT_GEMINI_UNAVAILABLE",
        geminiGeneration: metadata,
      });
    },
    resourceRouting: async () => {
      throw new Error("Resource routing must not run after risk failure.");
    },
    responsePlanning: async () => {
      throw new Error("Response planning must not run after risk failure.");
    },
  };
}

async function runScenario(
  scenario: WhatIfScenario,
  dependencies = successfulWorkflowDependencies(),
): Promise<WhatIfSimulationResult> {
  return runWhatIfSimulation(original.incident.id, scenario, {
    loadState: async () => original,
    workflowDependencies: dependencies,
    now: () => new Date("2026-10-04T00:00:00.000Z"),
  });
}

async function main() {
  const timestamp = "2026-10-04T00:00:00.000Z";
  const scenarios = Object.fromEntries(
    WHAT_IF_SCENARIOS.map((scenario) => [scenario.type, scenario]),
  ) as Record<WhatIfScenario["type"], WhatIfScenario>;

  const routeR2Scenario = createRouteBlockedScenario("R2");
  assert.equal(routeR2Scenario.label, "Route R2 becomes blocked");
  assert.equal(WhatIfScenarioSchema.safeParse(routeR2Scenario).success, true);
  assert.equal(
    WhatIfScenarioSchema.safeParse({
      ...routeR2Scenario,
      label: "Route R1 becomes blocked",
    }).success,
    false,
  );

  const routeResult = await runScenario(scenarios.ROUTE_BLOCKED);
  const activePlanBaseline = await runWhatIfSimulation(
    original.incident.id,
    scenarios.ROUTE_BLOCKED,
    {
      baselineState: original,
      workflowDependencies: successfulWorkflowDependencies(),
      now: () => new Date("2026-10-04T00:00:00.000Z"),
    },
  );
  assert.equal(activePlanBaseline.currentPlan?.id, original.activePlan?.id);
  assert.equal(activePlanBaseline.currentPlan?.status, "PENDING_APPROVAL");
  assert.equal(activePlanBaseline.currentActions.length, original.activePlan?.actions.length);
  assert.deepEqual(activePlanBaseline.currentState.activePlan, original.activePlan);
  for (const status of ["APPROVED", "COMPLETED", "REJECTED"] as const) {
    const terminalPlanBaseline = await runWhatIfSimulation(
      original.incident.id,
      scenarios.ROUTE_BLOCKED,
      {
        baselineState: {
          ...original,
          activePlan: { ...original.activePlan!, status },
        },
        workflowDependencies: successfulWorkflowDependencies(),
        now: () => new Date(timestamp),
      },
    );
    assert.equal(terminalPlanBaseline.currentPlan?.id, original.activePlan?.id);
    assert.equal(terminalPlanBaseline.currentPlan?.status, status);
    assert.equal(
      terminalPlanBaseline.currentActions.length,
      original.activePlan?.actions.length,
    );
  }
  assert.equal(
    original.routes.find((route) => route.id === "R1")?.status,
    "OPEN",
  );
  assert.equal(
    routeResult.hypotheticalState.routes.find((route) => route.id === "R1")
      ?.status,
    "BLOCKED",
  );
  assert.equal(routeResult.hypotheticalState.stateVersion, original.stateVersion);
  assert.equal(routeResult.workflowResult.responsePlanningResult.plan.source, "GEMINI");
  assert.equal(
    routeResult.workflowResult.responsePlanningResult.validation.valid,
    true,
  );
  assert.equal(
    routeResult.workflowResult.responsePlanningResult.plan.dependencies.routeIds.includes(
      "R2",
    ),
    true,
  );
  assert.equal(
    validatePlan(routeResult.workflowResult.responsePlanningResult.plan, {
      ...routeResult.hypotheticalState,
      planActions: [
        ...routeResult.hypotheticalState.planActions,
        ...routeResult.workflowResult.responsePlanningResult.actions,
      ],
    }).valid,
    true,
  );

  const hospitalResult = await runScenario(scenarios.FACILITY_UNAVAILABLE);
  assert.equal(
    original.facilities.find((facility) => facility.id === "FAC-HOSP-A")
      ?.status,
    "OPERATIONAL",
  );
  assert.equal(
    hospitalResult.hypotheticalState.facilities.find(
      (facility) => facility.id === "FAC-HOSP-A",
    )?.status,
    "UNAVAILABLE",
  );
  assert.deepEqual(
    hospitalResult.workflowResult.responsePlanningResult.plan.dependencies.facilityIds,
    ["FAC-HOSP-B"],
  );

  const ambulanceResult = await runScenario(scenarios.RESOURCE_UNAVAILABLE);
  assert.equal(
    original.resources.find((resource) => resource.id === "RES-AMB-01")
      ?.status,
    "AVAILABLE",
  );
  assert.equal(
    ambulanceResult.hypotheticalState.resources.find(
      (resource) => resource.id === "RES-AMB-01",
    )?.status,
    "UNAVAILABLE",
  );
  assert.equal(
    ambulanceResult.workflowResult.responsePlanningResult.plan.dependencies.resourceIds.includes(
      "RES-AMB-01",
    ),
    false,
  );
  assert.equal(
    ambulanceResult.workflowResult.responsePlanningResult.plan.dependencies.resourceIds.includes(
      "RES-AMB-02",
    ),
    true,
  );

  const populationResult = await runScenario(
    scenarios.AFFECTED_POPULATION_INCREASE,
  );
  assert.equal(original.incident.affectedPopulation, 35);
  assert.equal(
    populationResult.hypotheticalState.incident.affectedPopulation,
    45,
  );
  assert.equal(
    populationResult.workflowResult.riskAssessment.affectedPopulation,
    45,
  );

  const fallbackResult = await runScenario(
    scenarios.ROUTE_BLOCKED,
    failedWorkflowDependencies("PROVIDER_UNAVAILABLE"),
  );
  assert.equal(
    fallbackResult.workflowResult.responsePlanningResult.plan.source,
    "DETERMINISTIC_FALLBACK",
  );
  assert.deepEqual(
    fallbackResult.workflowResult.responsePlanningResult.generation
      ?.modelsAttempted,
    ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-2.5-flash"],
  );
  assert.equal(
    fallbackResult.workflowResult.responsePlanningResult.validation.valid,
    true,
  );
  assert.equal(
    fallbackResult.workflowResult.responsePlanningResult.generation
      ?.fallbackValidation?.valid,
    true,
  );

  const invalidPlan = {
    ...routeResult.workflowResult.responsePlanningResult.plan,
    dependencies: {
      ...routeResult.workflowResult.responsePlanningResult.plan.dependencies,
      routeIds: ["UNKNOWN-ROUTE"],
    },
  };
  assert.equal(
    validatePlan(invalidPlan, {
      ...routeResult.hypotheticalState,
      planActions: [
        ...routeResult.hypotheticalState.planActions,
        ...routeResult.workflowResult.responsePlanningResult.actions,
      ],
    }).valid,
    false,
  );

  const beforeFailedRun = structuredClone(original);
  await assert.rejects(
    runWhatIfSimulation(original.incident.id, scenarios.ROUTE_BLOCKED, {
      loadState: async () => original,
      workflowDependencies: {
        riskAssessment: async () => {
          throw new Error("non-AI fixture failure");
        },
        resourceRouting: async () => {
          throw new Error("must not run");
        },
        responsePlanning: async () => {
          throw new Error("must not run");
        },
      },
      now: () => new Date(timestamp),
    }),
  );
  assert.deepEqual(original, beforeFailedRun);

  const firstRepeat = await runScenario(scenarios.ROUTE_BLOCKED);
  const secondRepeat = await runScenario(scenarios.ROUTE_BLOCKED);
  assert.deepEqual(original, beforeFailedRun);
  assert.equal(firstRepeat.hypotheticalState.stateVersion, original.stateVersion);
  assert.equal(secondRepeat.hypotheticalState.stateVersion, original.stateVersion);
  assert.notEqual(firstRepeat.simulationId, secondRepeat.simulationId);

  const routeOnlyClone = applyWhatIfScenario(
    original,
    scenarios.ROUTE_BLOCKED,
    timestamp,
  );
  assert.deepEqual(original.routes, getDemoState("initial").state.routes);
  assert.equal(
    routeOnlyClone.hypotheticalState.routes.find((route) => route.id === "R1")
      ?.status,
    "BLOCKED",
  );

  const rejectedClientState = await handleWhatIfRequest(
    new Request("http://localhost/api/demo/what-if", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        incidentId: original.incident.id,
        scenario: scenarios.ROUTE_BLOCKED,
        baselineState: original,
        state: original,
        apiKey: "not-accepted",
        model: "client-selected-model",
      }),
    }),
  );
  assert.equal(rejectedClientState.status, 400);
  const rejectedBody = await rejectedClientState.text();
  assert.equal(rejectedBody.includes("not-accepted"), false);
  assert.equal(rejectedBody.includes("client-selected-model"), false);
  assert.deepEqual(original, pristineOriginal);

  console.log(
    "What-If fixture passed: isolated four-scenario simulations, Gemini provenance, deterministic fallback, validation, API input rejection, failure isolation, and repeatability.",
  );
}

void main();
