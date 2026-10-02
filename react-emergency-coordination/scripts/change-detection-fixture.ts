import assert from "node:assert/strict";
import type { EmergencyState } from "../src/domain/emergency-state/schema";
import type { PlanAction } from "../src/domain/plan-action/schema";
import type { ResponsePlan } from "../src/domain/response-plan/schema";
import { detectEmergencyStateChanges } from "../src/lib/change-detection/detector";

const timestamp = "2026-01-01T00:00:00.000Z";

function action(
  id: string,
  overrides: Partial<PlanAction> = {},
): PlanAction {
  return {
    id,
    planId: "plan-1",
    sequence: 1,
    type: "OTHER",
    status: "PENDING",
    description: "Simulation action.",
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

function plan(actions: readonly PlanAction[]): ResponsePlan {
  return {
    id: "plan-1",
    incidentId: "incident-1",
    stateVersion: 1,
    status: "APPROVED",
    priority: "HIGH",
    summary: "Current plan",
    rationale: "Fixture plan.",
    generatedAt: timestamp,
    updatedAt: timestamp,
    actions: actions.map((entry) => ({ actionId: entry.id, sequence: entry.sequence })),
    alternatives: [],
    dependencies: {
      resourceIds: [...new Set(actions.flatMap((entry) => entry.resourceIds))],
      facilityIds: [...new Set(actions.flatMap((entry) => entry.facilityIds))],
      routeIds: [...new Set(actions.flatMap((entry) => entry.routeIds))],
    },
  };
}

function state(actions: readonly PlanAction[]): EmergencyState {
  return {
    incident: {
      id: "incident-1",
      title: "Incident",
      description: "Change detection fixture.",
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
      {
        id: "resource-2",
        name: "Unrelated team",
        type: "RESCUE_TEAM",
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
        name: "Hospital A",
        type: "HOSPITAL",
        status: "OPERATIONAL",
        location: { latitude: 18, longitude: 73, address: "Hospital A" },
        totalCapacity: 50,
        availableCapacity: 20,
        capabilities: [],
        updatedAt: timestamp,
      },
      {
        id: "facility-2",
        name: "Hospital B",
        type: "HOSPITAL",
        status: "OPERATIONAL",
        location: { latitude: 18, longitude: 73, address: "Hospital B" },
        totalCapacity: 50,
        availableCapacity: 20,
        capabilities: [],
        updatedAt: timestamp,
      },
    ],
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
    planActions: [...actions],
    activePlan: null,
    stateVersion: 1,
    updatedAt: timestamp,
  };
}

function detect(
  previousState: EmergencyState,
  currentState: EmergencyState,
  activePlan: ResponsePlan,
) {
  const result = detectEmergencyStateChanges({
    previousState,
    currentState,
    activePlan,
  });
  assert.equal(result.success, true);
  return result as Extract<typeof result, { success: true }>;
}

const routeAction = action("route-action");
const resourceAction = action("resource-action", {
  sequence: 2,
  resourceIds: ["resource-1"],
});
const facilityAction = action("facility-action", {
  sequence: 3,
  facilityIds: ["facility-1"],
  routeIds: [],
  capacityDemand: 10,
});
const actions = [routeAction, resourceAction, facilityAction];
const previous = state(actions);
const activePlan = plan(actions);
const originalPrevious = structuredClone(previous);
const originalPlan = structuredClone(activePlan);

assert.equal(detect(previous, structuredClone(previous), activePlan).classification, "NO_MATERIAL_CHANGE");

const unrelatedRoute = structuredClone(previous);
unrelatedRoute.routes[1] = { ...unrelatedRoute.routes[1], status: "BLOCKED", blockedReason: "Flooding" };
assert.equal(detect(previous, unrelatedRoute, activePlan).classification, "MATERIAL_CHANGE_NOT_AFFECTING_PLAN");
assert.equal(detect(previous, unrelatedRoute, activePlan).requiresReassessment, false);

const blockedRoute = structuredClone(previous);
blockedRoute.routes[0] = { ...blockedRoute.routes[0], status: "BLOCKED", blockedReason: "Flooding" };
assert.equal(detect(previous, blockedRoute, activePlan).requiresReassessment, true);

const partialRoute = structuredClone(previous);
partialRoute.routes[0] = { ...partialRoute.routes[0], status: "PARTIALLY_BLOCKED", blockedReason: "One lane closed" };
assert.equal(detect(previous, partialRoute, activePlan).requiresReassessment, true);

const reopenedRoute = structuredClone(blockedRoute);
reopenedRoute.routes[0] = { ...reopenedRoute.routes[0], status: "OPEN", blockedReason: null };
assert.equal(detect(blockedRoute, reopenedRoute, activePlan).requiresReassessment, true);

const unrelatedResource = structuredClone(previous);
unrelatedResource.resources[1] = { ...unrelatedResource.resources[1], status: "UNAVAILABLE" };
assert.equal(detect(previous, unrelatedResource, activePlan).requiresReassessment, false);

const unavailableResource = structuredClone(previous);
unavailableResource.resources[0] = { ...unavailableResource.resources[0], status: "UNAVAILABLE" };
assert.equal(detect(previous, unavailableResource, activePlan).requiresReassessment, true);

const assignedResource = structuredClone(previous);
assignedResource.resources[0] = {
  ...assignedResource.resources[0],
  status: "ASSIGNED",
  currentAssignmentId: "resource-action",
};
assert.equal(detect(previous, assignedResource, activePlan).requiresReassessment, true);

const unrelatedFacility = structuredClone(previous);
unrelatedFacility.facilities[1] = { ...unrelatedFacility.facilities[1], availableCapacity: 1 };
assert.equal(detect(previous, unrelatedFacility, activePlan).requiresReassessment, false);

const sufficientFacility = structuredClone(previous);
sufficientFacility.facilities[0] = { ...sufficientFacility.facilities[0], availableCapacity: 18 };
assert.equal(detect(previous, sufficientFacility, activePlan).requiresReassessment, false);

const insufficientFacility = structuredClone(previous);
insufficientFacility.facilities[0] = { ...insufficientFacility.facilities[0], availableCapacity: 5 };
assert.equal(detect(previous, insufficientFacility, activePlan).requiresReassessment, true);

const populationChanged = structuredClone(previous);
populationChanged.incident = { ...populationChanged.incident, affectedPopulation: 50 };
assert.equal(detect(previous, populationChanged, activePlan).requiresReassessment, true);

const severityChanged = structuredClone(previous);
severityChanged.incident = { ...severityChanged.incident, severity: "CRITICAL" };
assert.equal(detect(previous, severityChanged, activePlan).requiresReassessment, true);

const priorityChanged = structuredClone(previous);
priorityChanged.incident = { ...priorityChanged.incident, priority: "URGENT" };
assert.equal(detect(previous, priorityChanged, activePlan).requiresReassessment, true);

const metadataChanged = structuredClone(previous);
metadataChanged.incident = { ...metadataChanged.incident, title: "Renamed incident" };
assert.equal(detect(previous, metadataChanged, activePlan).classification, "NO_MATERIAL_CHANGE");

const mismatch = detectEmergencyStateChanges({
  previousState: previous,
  currentState: { ...previous, incident: { ...previous.incident, id: "incident-2" } },
  activePlan,
});
assert.equal(mismatch.success, false);
if (!mismatch.success) assert.equal(mismatch.error.code, "STATE_INCIDENT_MISMATCH");

const olderVersion = detectEmergencyStateChanges({
  previousState: previous,
  currentState: { ...previous, stateVersion: 0 },
  activePlan,
});
assert.equal(olderVersion.success, false);
if (!olderVersion.success) assert.equal(olderVersion.error.code, "STATE_VERSION_INVALID");

const missingPlan = detectEmergencyStateChanges({
  previousState: previous,
  currentState: previous,
  activePlan: null,
});
assert.equal(missingPlan.success, false);
if (!missingPlan.success) assert.equal(missingPlan.error.code, "ACTIVE_PLAN_MISSING");

const inconsistent = detectEmergencyStateChanges({
  previousState: previous,
  currentState: previous,
  activePlan: { ...activePlan, dependencies: { ...activePlan.dependencies, routeIds: ["missing-route"] } },
});
assert.equal(inconsistent.success, false);
if (!inconsistent.success) assert.equal(inconsistent.error.code, "DEPENDENCY_INCONSISTENT");

const simultaneous = structuredClone(previous);
simultaneous.incident = { ...simultaneous.incident, affectedPopulation: 50 };
simultaneous.routes[0] = { ...simultaneous.routes[0], status: "BLOCKED", blockedReason: "Flooding" };
simultaneous.resources[0] = { ...simultaneous.resources[0], status: "UNAVAILABLE" };
const simultaneousResult = detect(previous, simultaneous, activePlan);
assert.equal(simultaneousResult.changes.length, 4);
assert.equal(simultaneousResult.affectedDependencies.length, 3);
assert.deepEqual(simultaneousResult, detect(previous, simultaneous, activePlan));
assert.deepEqual(previous, originalPrevious);
assert.deepEqual(activePlan, originalPlan);

console.log("Change detection fixture passed.");
