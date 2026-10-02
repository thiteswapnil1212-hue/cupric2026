import assert from "node:assert/strict";
import type { EmergencyState } from "../src/domain/emergency-state/schema";
import type { PlanAction } from "../src/domain/plan-action/schema";
import type { ResponsePlan } from "../src/domain/response-plan/schema";
import type { ResourceRoutingAssessment } from "../src/lib/agents/resource-routing/schema";
import type { RiskAssessment } from "../src/lib/agents/risk-assessment/schema";
import type { ResponsePlanningResult } from "../src/lib/agents/response-planning/agent";
import { detectEmergencyStateChanges } from "../src/lib/change-detection/detector";
import { validatePlan } from "../src/lib/emergency-engine/plan-validator";
import {
  replanEmergencyResponse,
  type ReplanningAgents,
} from "../src/lib/replanning/replanner";

const timestamp = "2026-01-01T00:00:00.000Z";

function action(id: string, overrides: Partial<PlanAction> = {}): PlanAction {
  return {
    id,
    planId: "old-plan",
    sequence: 1,
    type: "OTHER",
    status: "PENDING",
    description: "Existing operational action.",
    priority: "NORMAL",
    resourceIds: [],
    facilityIds: [],
    routeIds: ["route-1"],
    targetLocation: { latitude: 18, longitude: 73 },
    estimatedDurationMinutes: 10,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

const oldAction = action("old-action");
const oldPlan: ResponsePlan = {
  id: "old-plan",
  incidentId: "incident-1",
  stateVersion: 1,
  status: "APPROVED",
  priority: "HIGH",
  summary: "Existing plan",
  rationale: "Fixture plan.",
  generatedAt: timestamp,
  updatedAt: timestamp,
  actions: [{ actionId: oldAction.id, sequence: oldAction.sequence }],
  alternatives: [],
  dependencies: { resourceIds: ["resource-1"], facilityIds: [], routeIds: ["route-1"] },
};

function makeState(version: number, changes: Partial<EmergencyState> = {}): EmergencyState {
  return {
    incident: {
      id: "incident-1",
      title: "Incident",
      description: "Replanning fixture.",
      type: "FIRE",
      status: "ACTIVE",
      severity: "MODERATE",
      priority: "NORMAL",
      location: { latitude: 18, longitude: 73, address: "Address" },
      affectedPopulation: 35,
      hazards: ["smoke"],
      reportedAt: timestamp,
      updatedAt: timestamp,
    },
    resources: [
      {
        id: "resource-1",
        name: "Rescue team",
        type: "RESCUE_TEAM",
        status: "AVAILABLE",
        location: { latitude: 18, longitude: 73 },
        capacity: 4,
        currentAssignmentId: null,
        capabilities: [],
        updatedAt: timestamp,
      },
    ],
    facilities: [],
    routes: [
      {
        id: "route-1",
        name: "Active route",
        status: "OPEN",
        distanceKm: 5,
        estimatedTravelMinutes: 10,
        origin: { latitude: 18, longitude: 73 },
        destination: { latitude: 18.1, longitude: 73.1 },
        blockedReason: null,
        updatedAt: timestamp,
      },
      {
        id: "route-3",
        name: "Unrelated route",
        status: "OPEN",
        distanceKm: 5,
        estimatedTravelMinutes: 10,
        origin: { latitude: 18, longitude: 73 },
        destination: { latitude: 18.1, longitude: 73.1 },
        blockedReason: null,
        updatedAt: timestamp,
      },
    ],
    planActions: [oldAction],
    activePlan: oldPlan,
    stateVersion: version,
    updatedAt: timestamp,
    ...changes,
  };
}

const previous = makeState(1);
const current = makeState(2, {
  routes: previous.routes.map((route) =>
    route.id === "route-1"
      ? { ...route, status: "BLOCKED", blockedReason: "Flooding" }
      : route,
  ),
});

const riskAssessment: RiskAssessment = {
  severity: "MODERATE",
  urgency: "HIGH",
  priority: 4,
  affectedPopulation: 35,
  hazardFactors: ["smoke"],
  riskFactors: ["route disruption"],
  keyConcerns: ["route disruption"],
  reasoning: "Current route conditions require reassessment.",
  confidence: 0.9,
};

const routingAssessment: ResourceRoutingAssessment = {
  resources: [
    {
      resourceId: "resource-1",
      status: "AVAILABLE",
      availability: "AVAILABLE",
      capacity: 4,
      capabilityMatch: [],
      notes: ["Available for reassessment."],
    },
  ],
  facilities: [],
  routes: [
    {
      routeId: "route-1",
      status: "BLOCKED",
      distanceKm: 5,
      estimatedTravelMinutes: 10,
      usability: "BLOCKED",
      notes: ["Route is blocked."],
    },
    {
      routeId: "route-3",
      status: "OPEN",
      distanceKm: 5,
      estimatedTravelMinutes: 10,
      usability: "USABLE",
      notes: ["Route remains usable."],
    },
  ],
  constraints: ["Route disruption"],
  reasoning: "Routing facts reflect the current state.",
};

function revisedAction(planId: string): PlanAction {
  return {
    id: `${planId}-action`,
    planId,
    sequence: 1,
    type: "OTHER",
    status: "PENDING",
    description: "Use the alternate route.",
    priority: "HIGH",
    resourceIds: [],
    facilityIds: [],
    routeIds: ["route-3"],
    targetLocation: { latitude: 18, longitude: 73 },
    estimatedDurationMinutes: 12,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function agents(
  calls: string[],
  mode: "success" | "risk-failure" | "routing-failure" | "planning-failure" | "invalid-plan" = "success",
): ReplanningAgents {
  return {
    async riskAssessment() {
      calls.push("risk");
      if (mode === "risk-failure") throw new Error("risk stage failed");
      return riskAssessment;
    },
    async resourceRouting() {
      calls.push("routing");
      if (mode === "routing-failure") throw new Error("routing stage failed");
      return routingAssessment;
    },
    async responsePlanning(state): Promise<ResponsePlanningResult> {
      calls.push("planning");
      if (mode === "planning-failure") throw new Error("planning stage failed");
      const planId = mode === "invalid-plan" ? "old-plan" : "revised-plan";
      const generatedAction = revisedAction(planId);
      const generatedPlan: ResponsePlan = {
        id: planId,
        incidentId: state.incident.id,
        stateVersion: state.stateVersion,
        status: "DRAFT",
        priority: "HIGH",
        summary: "Revised plan",
        rationale: "Adapted to current conditions.",
        generatedAt: timestamp,
        updatedAt: timestamp,
        actions: [{ actionId: generatedAction.id, sequence: 1 }],
        alternatives: [],
        dependencies: { resourceIds: [], facilityIds: [], routeIds: ["route-3"] },
      };
      const validation = validatePlan(generatedPlan, {
        ...state,
        planActions: [...state.planActions, generatedAction],
      });
      return {
        plan: generatedPlan,
        actions: [generatedAction],
        alternatives: [],
        constraints: [],
        reasoning: "Replanned deterministically for fixture.",
        confidence: 0.9,
        validation,
      };
    },
  };
}

async function main(): Promise<void> {
  const unchanged = makeState(2);
  const calls: string[] = [];
  const notRequired = await replanEmergencyResponse(previous, unchanged, {
    activePlan: oldPlan,
    agents: agents(calls),
  });
  assert.equal(notRequired.status, "NOT_REQUIRED");
  assert.deepEqual(calls, []);

  const unrelatedRoute = makeState(2, {
    routes: previous.routes.map((route) =>
      route.id === "route-3"
        ? { ...route, status: "BLOCKED", blockedReason: "Flooding" }
        : route,
    ),
  });
  assert.equal(
    (await replanEmergencyResponse(previous, unrelatedRoute, { activePlan: oldPlan, agents: agents([]) })).status,
    "NOT_REQUIRED",
  );

  for (const changedState of [
    current,
    makeState(2, {
      routes: previous.routes.map((route) =>
        route.id === "route-1"
          ? { ...route, status: "PARTIALLY_BLOCKED", blockedReason: "One lane closed" }
          : route,
      ),
    }),
    makeState(2, {
      resources: previous.resources.map((resource) => ({
        ...resource,
        status: "UNAVAILABLE" as const,
      })),
    }),
    makeState(2, {
      incident: { ...previous.incident, affectedPopulation: 50 },
    }),
    makeState(2, {
      incident: { ...previous.incident, severity: "CRITICAL" },
    }),
    makeState(2, {
      incident: { ...previous.incident, priority: "URGENT" },
    }),
  ]) {
    const result = await replanEmergencyResponse(previous, changedState, {
      activePlan: oldPlan,
      agents: agents([]),
    });
    assert.equal(result.status, "PENDING_HUMAN_APPROVAL");
  }

  const invalidPrevious = await replanEmergencyResponse(
    { ...previous, stateVersion: 0 },
    current,
    { activePlan: oldPlan, agents: agents([]) },
  );
  assert.equal(invalidPrevious.status, "FAILED");

  const invalidCurrent = await replanEmergencyResponse(
    current,
    { ...current, incident: { ...current.incident, title: "" } } as EmergencyState,
    { activePlan: oldPlan, agents: agents([]) },
  );
  assert.equal(invalidCurrent.status, "FAILED");

  const mismatch = await replanEmergencyResponse(
    previous,
    {
      ...current,
      incident: { ...current.incident, id: "incident-2" },
      activePlan: null,
    },
    { activePlan: oldPlan, agents: agents([]) },
  );
  assert.equal(mismatch.error?.code, "STATE_INCIDENT_MISMATCH");

  const invalidVersion = await replanEmergencyResponse(previous, previous, {
    activePlan: oldPlan,
    agents: agents([]),
  });
  assert.equal(invalidVersion.error?.code, "STATE_VERSION_INVALID");

  const missingPlanWithoutState = await replanEmergencyResponse(
    { ...previous, activePlan: null },
    { ...current, activePlan: null },
    { agents: agents([]) },
  );
  assert.equal(missingPlanWithoutState.error?.code, "ACTIVE_PLAN_MISSING");

  for (const mode of ["risk-failure", "routing-failure", "planning-failure"] as const) {
    const stageCalls: string[] = [];
    const failed = await replanEmergencyResponse(previous, current, {
      activePlan: oldPlan,
      agents: agents(stageCalls, mode),
    });
    assert.equal(failed.status, "FAILED");
    assert.equal(failed.previousPlanSuperseded, false);
    if (mode === "risk-failure") assert.deepEqual(stageCalls, ["risk"]);
    if (mode === "routing-failure") assert.deepEqual(stageCalls, ["risk", "routing"]);
    if (mode === "planning-failure") assert.deepEqual(stageCalls, ["risk", "routing", "planning"]);
  }

  const invalidRevision = await replanEmergencyResponse(previous, current, {
    activePlan: oldPlan,
    agents: agents([], "invalid-plan"),
  });
  assert.equal(invalidRevision.status, "VALIDATION_FAILED");
  assert.equal(invalidRevision.previousPlanSuperseded, false);

  const originalPlan = structuredClone(oldPlan);
  const successful = await replanEmergencyResponse(previous, current, {
    activePlan: oldPlan,
    agents: agents([]),
  });
  assert.equal(successful.status, "PENDING_HUMAN_APPROVAL");
  assert.equal(successful.previousPlanSuperseded, true);
  assert.equal(successful.previousPlanSupersessionPersisted, false);
  assert.notEqual(successful.revisedPlan?.id, oldPlan.id);
  assert.equal(successful.revisedPlan?.stateVersion, current.stateVersion);
  assert.equal(successful.revisedPlan?.status, "PENDING_APPROVAL");
  assert.deepEqual(oldPlan, originalPlan);

  assert.equal(
    successful.revisedPlan === null ||
      successful.revisedPlan.status === "PENDING_APPROVAL",
    true,
  );

  const repeatedA = await replanEmergencyResponse(previous, current, {
    activePlan: oldPlan,
    agents: agents([]),
  });
  const repeatedB = await replanEmergencyResponse(previous, current, {
    activePlan: oldPlan,
    agents: agents([]),
  });
  assert.equal(repeatedA.status, repeatedB.status);
  assert.equal(repeatedA.changeClassification, repeatedB.changeClassification);
  assert.deepEqual(repeatedA.changeRecords, repeatedB.changeRecords);

  const detection = detectEmergencyStateChanges({
    previousState: previous,
    currentState: current,
    activePlan: oldPlan,
  });
  assert.equal(detection.success, true);
  assert.equal(successful.changeRecords.length, detection.success ? detection.changes.length : -1);

  console.log("Replanning fixture passed (28 scenarios).");
}

void main();
