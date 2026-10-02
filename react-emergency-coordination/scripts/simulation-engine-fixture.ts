import assert from "node:assert/strict";
import type { EmergencyState } from "../src/domain/emergency-state/schema";
import type { PlanAction } from "../src/domain/plan-action/schema";
import type { ResponsePlan } from "../src/domain/response-plan/schema";
import { executeApprovedPlan } from "../src/lib/simulation/engine";

const timestamp = "2026-01-01T00:00:00.000Z";

function action(
  id: string,
  sequence: number,
  overrides: Partial<PlanAction> = {},
): PlanAction {
  return {
    id,
    planId: "plan-1",
    sequence,
    type: "OTHER",
    status: "PENDING",
    description: `Simulate ${id}.`,
    priority: "NORMAL",
    resourceIds: [],
    facilityIds: [],
    routeIds: [],
    targetLocation: { latitude: 18, longitude: 73 },
    estimatedDurationMinutes: 10,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function baseState(actions: readonly PlanAction[]): EmergencyState {
  return {
    incident: {
      id: "incident-1",
      title: "Test incident",
      description: "Simulation fixture incident.",
      type: "FIRE",
      status: "ACTIVE",
      severity: "HIGH",
      priority: "HIGH",
      location: { latitude: 18, longitude: 73, address: "Test address" },
      affectedPopulation: 20,
      hazards: [],
      reportedAt: timestamp,
      updatedAt: timestamp,
    },
    resources: [
      {
        id: "resource-1",
        name: "Rescue unit",
        type: "RESCUE_TEAM",
        status: "AVAILABLE",
        location: { latitude: 18, longitude: 73 },
        capacity: 4,
        currentAssignmentId: null,
        capabilities: [],
        updatedAt: timestamp,
      },
      {
        id: "resource-2",
        name: "Medical unit",
        type: "MEDICAL_TEAM",
        status: "AVAILABLE",
        location: { latitude: 18, longitude: 73 },
        capacity: 4,
        currentAssignmentId: null,
        capabilities: [],
        updatedAt: timestamp,
      },
    ],
    facilities: [
      {
        id: "facility-1",
        name: "Shelter",
        type: "SHELTER",
        status: "OPERATIONAL",
        location: { latitude: 18, longitude: 73, address: "Shelter address" },
        totalCapacity: 100,
        availableCapacity: 100,
        capabilities: [],
        updatedAt: timestamp,
      },
    ],
    routes: [
      {
        id: "route-open",
        name: "Open route",
        status: "OPEN",
        distanceKm: 5,
        estimatedTravelMinutes: 10,
        origin: { latitude: 18, longitude: 73 },
        destination: { latitude: 18.1, longitude: 73.1 },
        blockedReason: null,
        updatedAt: timestamp,
      },
      {
        id: "route-partial",
        name: "Partially blocked route",
        status: "PARTIALLY_BLOCKED",
        distanceKm: 5,
        estimatedTravelMinutes: 15,
        origin: { latitude: 18, longitude: 73 },
        destination: { latitude: 18.1, longitude: 73.1 },
        blockedReason: "One lane unavailable",
        updatedAt: timestamp,
      },
      {
        id: "route-blocked",
        name: "Blocked route",
        status: "BLOCKED",
        distanceKm: 5,
        estimatedTravelMinutes: 10,
        origin: { latitude: 18, longitude: 73 },
        destination: { latitude: 18.1, longitude: 73.1 },
        blockedReason: "Flooding",
        updatedAt: timestamp,
      },
    ],
    planActions: [...actions],
    activePlan: null,
    stateVersion: 1,
    updatedAt: timestamp,
  };
}

function plan(
  actions: readonly PlanAction[],
  status: ResponsePlan["status"] = "APPROVED",
): ResponsePlan {
  return {
    id: "plan-1",
    incidentId: "incident-1",
    stateVersion: 1,
    status,
    priority: "HIGH",
    summary: "Simulation plan",
    rationale: "Fixture plan.",
    generatedAt: timestamp,
    updatedAt: timestamp,
    actions: actions.map(({ id, sequence }) => ({ actionId: id, sequence })),
    alternatives: [],
    dependencies: {
      resourceIds: [],
      facilityIds: [],
      routeIds: [],
    },
  };
}

const actions = [
  action("action-2", 2, {
    type: "DISPATCH_RESOURCE",
    resourceIds: ["resource-2"],
    routeIds: ["route-partial"],
  }),
  action("action-1", 1, {
    type: "ASSIGN_RESOURCE",
    resourceIds: ["resource-1"],
  }),
  action("action-3", 3, {
    type: "SHELTER_PEOPLE",
    facilityIds: ["facility-1"],
    capacityDemand: 20,
  }),
];
const state = baseState(actions);
const approvedPlan = plan(actions);
const originalState = structuredClone(state);
const originalPlan = structuredClone(approvedPlan);

const first = executeApprovedPlan(state, approvedPlan);
assert.equal(first.success, true);
if (!first.success) throw new Error("Expected approved plan to execute.");
assert.deepEqual(first.executedActions, ["action-1", "action-2", "action-3"]);
assert.equal(first.state.stateVersion, 2);
assert.equal(first.state.activePlan?.status, "COMPLETED");
assert.equal(first.state.resources.find((entry) => entry.id === "resource-1")?.status, "ASSIGNED");
assert.equal(first.state.resources.find((entry) => entry.id === "resource-2")?.status, "DISPATCHED");
assert.equal(first.state.facilities[0].availableCapacity, 80);
assert.equal(first.events[1].success, true);
assert.ok(first.stateChanges.some((change) => change.changeType === "CAPACITY_CHANGED"));
assert.deepEqual(state, originalState);
assert.deepEqual(approvedPlan, originalPlan);

const repeated = executeApprovedPlan(state, approvedPlan);
assert.deepEqual(first, executeApprovedPlan(state, approvedPlan));
const alreadyExecuted = executeApprovedPlan(first.state, approvedPlan);
assert.equal(alreadyExecuted.success, false);
assert.equal(
  alreadyExecuted.success
    ? ""
    : alreadyExecuted.error.code,
  "PLAN_ALREADY_EXECUTED",
);
assert.deepEqual(repeated, first);

for (const status of [
  "DRAFT",
  "PENDING_APPROVAL",
  "REJECTED",
  "MODIFIED",
  "COMPLETED",
] as const) {
  const result = executeApprovedPlan(state, plan(actions, status));
  assert.equal(result.success, false);
  if (!result.success) assert.equal(result.error.code, "PLAN_NOT_EXECUTABLE");
}

const stale = executeApprovedPlan(
  { ...state, stateVersion: 2 },
  approvedPlan,
);
assert.equal(stale.success, false);
if (!stale.success) assert.equal(stale.error.code, "PLAN_STALE");

const invalidPlan = { ...approvedPlan, summary: "" } as ResponsePlan;
const invalid = executeApprovedPlan(state, invalidPlan);
assert.equal(invalid.success, false);
if (!invalid.success) assert.equal(invalid.error.code, "PLAN_INVALID");

const unavailableState = {
  ...state,
  resources: state.resources.map((resource) =>
    resource.id === "resource-1"
      ? { ...resource, status: "UNAVAILABLE" as const }
      : resource,
  ),
};
const unavailable = executeApprovedPlan(
  unavailableState,
  approvedPlan,
);
assert.equal(unavailable.success, false);
if (!unavailable.success) assert.equal(unavailable.error.code, "PLAN_INVALID");

const insufficient = executeApprovedPlan(
  {
    ...state,
    facilities: state.facilities.map((facility) => ({
      ...facility,
      availableCapacity: 10,
    })),
  },
  approvedPlan,
);
assert.equal(insufficient.success, false);
if (!insufficient.success) assert.equal(insufficient.error.code, "PLAN_INVALID");

const blockedAction = action("blocked-action", 1, {
  routeIds: ["route-blocked"],
});
const blocked = executeApprovedPlan(
  baseState([blockedAction]),
  plan([blockedAction]),
);
assert.equal(blocked.success, false);
if (!blocked.success) assert.equal(blocked.error.code, "PLAN_INVALID");

const partialAction = action("partial-action", 1, {
  routeIds: ["route-partial"],
});
const partial = executeApprovedPlan(
  baseState([partialAction]),
  plan([partialAction]),
);
assert.equal(partial.success, true);

const firstFailure = action("first-failure", 1, {
  resourceIds: ["missing-resource"],
});
const subsequent = action("subsequent", 2);
const stopped = executeApprovedPlan(
  baseState([firstFailure, subsequent]),
  plan([firstFailure, subsequent]),
);
assert.equal(stopped.success, false);
if (!stopped.success) {
  assert.equal(stopped.failedAction, null);
  assert.deepEqual(stopped.executedActions, []);
  assert.deepEqual(stopped.remainingActions, ["first-failure", "subsequent"]);
}

console.log("Simulation engine fixture passed.");
