import { EmergencyStateSchema } from "../../domain/emergency-state/schema";
import { ResponsePlanSchema, type ResponsePlan } from "../../domain/response-plan/schema";
import type { EmergencyState } from "../../domain/emergency-state/schema";
import {
  type AffectedDependency,
  type ChangeDetectionContext,
  type ChangeDetectionResult,
  type ChangeEntityType,
  type ChangeValue,
  type ChangeType,
  type DetectedChange,
} from "./schema";

function failure(
  code:
    | "STATE_VERSION_INVALID"
    | "STATE_INCIDENT_MISMATCH"
    | "ACTIVE_PLAN_MISSING"
    | "ACTIVE_PLAN_INVALID"
    | "DEPENDENCY_INCONSISTENT"
    | "INVALID_CHANGE_CONTEXT",
  message: string,
): ChangeDetectionResult {
  return { success: false, error: { code, message } };
}

function equalStringArrays(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function equalNullableString(
  left: string | null,
  right: string | null,
): boolean {
  return left === right;
}

function addChange(
  changes: DetectedChange[],
  entityType: ChangeEntityType,
  entityId: string,
  changeType: ChangeType,
  previousValue: ChangeValue,
  currentValue: ChangeValue,
): void {
  changes.push({
    entityType,
    entityId,
    changeType,
    previousValue,
    currentValue,
    operationalImpact: "NONE",
  });
}

function findById<T extends { id: string }>(
  entities: readonly T[],
  id: string,
): T | null {
  return entities.find((entity) => entity.id === id) ?? null;
}

function planActionIds(plan: ResponsePlan): Set<string> {
  return new Set(plan.actions.map((action) => action.actionId));
}

function dependencyIds(
  plan: ResponsePlan,
  state: EmergencyState,
  entityType: "resourceIds" | "facilityIds" | "routeIds",
): Set<string> {
  const ids = new Set(plan.dependencies[entityType]);
  const actionIds = planActionIds(plan);
  for (const action of state.planActions) {
    if (actionIds.has(action.id)) {
      for (const id of action[entityType]) ids.add(id);
    }
  }
  return ids;
}

function validateDependencyReferences(
  plan: ResponsePlan,
  previousState: EmergencyState,
  currentState: EmergencyState,
): string | null {
  for (const actionReference of plan.actions) {
    const action = currentState.planActions.find(
      (candidate) =>
        candidate.id === actionReference.actionId &&
        candidate.sequence === actionReference.sequence,
    );
    if (action === undefined || action.planId !== plan.id) {
      return `Plan action ${actionReference.actionId} is not consistently represented in current EmergencyState.`;
    }
  }

  const checks: readonly [
    "resourceIds" | "facilityIds" | "routeIds",
    readonly { id: string }[],
    readonly { id: string }[],
  ][] = [
    ["resourceIds", previousState.resources, currentState.resources],
    ["facilityIds", previousState.facilities, currentState.facilities],
    ["routeIds", previousState.routes, currentState.routes],
  ];
  for (const [field, previousEntities, currentEntities] of checks) {
    for (const id of plan.dependencies[field]) {
      if (
        findById(previousEntities, id) === null &&
        findById(currentEntities, id) === null
      ) {
        return `Plan dependency ${id} is not present in either state snapshot.`;
      }
    }
  }
  return null;
}

function markImpacts(
  changes: DetectedChange[],
  plan: ResponsePlan,
  previousState: EmergencyState,
  currentState: EmergencyState,
): AffectedDependency[] {
  const resources = dependencyIds(plan, currentState, "resourceIds");
  const facilities = dependencyIds(plan, currentState, "facilityIds");
  const routes = dependencyIds(plan, currentState, "routeIds");
  const demands = new Map<string, number>();

  for (const actionReference of plan.actions) {
    const action = currentState.planActions.find(
      (candidate) =>
        candidate.id === actionReference.actionId &&
        candidate.sequence === actionReference.sequence,
    );
    if (
      action !== undefined &&
      action.capacityDemand !== undefined &&
      action.capacityDemand !== null &&
      action.facilityIds.length === 1
    ) {
      demands.set(
        action.facilityIds[0],
        (demands.get(action.facilityIds[0]) ?? 0) + action.capacityDemand,
      );
    }
  }

  const affectedByEntity = new Map<string, AffectedDependency>();
  for (const change of changes) {
    let reason: string | null = null;
    if (change.entityType === "INCIDENT") {
      reason = "Core incident conditions changed.";
    } else if (
      change.entityType === "RESOURCE" &&
      resources.has(change.entityId)
    ) {
      reason = "A resource used by the active plan changed operational state.";
    } else if (
      change.entityType === "ROUTE" &&
      routes.has(change.entityId)
    ) {
      reason = "A route used by the active plan changed usability.";
    } else if (
      change.entityType === "FACILITY" &&
      facilities.has(change.entityId)
    ) {
      const demand = demands.get(change.entityId) ?? 0;
      const previousFacility = findById(previousState.facilities, change.entityId);
      const currentFacility = findById(currentState.facilities, change.entityId);
      const crossedDemandThreshold =
        demand > 0 &&
        previousFacility !== null &&
        currentFacility !== null &&
        previousFacility.availableCapacity >= demand &&
        currentFacility.availableCapacity < demand;
      if (
        change.changeType === "FACILITY_STATUS_CHANGED" ||
        crossedDemandThreshold
      ) {
        reason =
          change.changeType === "FACILITY_STATUS_CHANGED"
            ? "A facility used by the active plan changed operational status."
            : "A facility dependency no longer has enough capacity for the active plan.";
      }
    } else if (change.entityType === "PLAN") {
      reason = "The active plan identity or lifecycle changed.";
    }

    if (reason !== null) {
      change.operationalImpact = "REASSESSMENT_REQUIRED";
      affectedByEntity.set(`${change.entityType}:${change.entityId}`, {
        entityType: change.entityType === "INCIDENT" ? "INCIDENT" : change.entityType,
        entityId: change.entityId,
        reason,
      });
    }
  }
  return [...affectedByEntity.values()].sort((left, right) =>
    `${left.entityType}:${left.entityId}`.localeCompare(
      `${right.entityType}:${right.entityId}`,
    ),
  );
}

export function detectEmergencyStateChanges(
  context: ChangeDetectionContext,
): ChangeDetectionResult {
  const { previousState, currentState, activePlan } = context;
  if (activePlan === null) {
    return failure("ACTIVE_PLAN_MISSING", "An active ResponsePlan is required.");
  }
  if (
    !EmergencyStateSchema.safeParse(previousState).success ||
    !EmergencyStateSchema.safeParse(currentState).success
  ) {
    return failure("INVALID_CHANGE_CONTEXT", "Both EmergencyState snapshots must be valid.");
  }
  if (!ResponsePlanSchema.safeParse(activePlan).success) {
    return failure("ACTIVE_PLAN_INVALID", "The active ResponsePlan is invalid.");
  }
  if (previousState.incident.id !== currentState.incident.id) {
    return failure("STATE_INCIDENT_MISMATCH", "State snapshots must represent the same incident.");
  }
  if (activePlan.incidentId !== currentState.incident.id) {
    return failure("STATE_INCIDENT_MISMATCH", "Active plan incidentId does not match current incident.");
  }
  if (
    !Number.isSafeInteger(previousState.stateVersion) ||
    !Number.isSafeInteger(currentState.stateVersion) ||
    currentState.stateVersion < previousState.stateVersion
  ) {
    return failure(
      "STATE_VERSION_INVALID",
      "Current stateVersion must be a safe integer no older than previous stateVersion.",
    );
  }
  const consistencyError = validateDependencyReferences(
    activePlan,
    previousState,
    currentState,
  );
  if (consistencyError !== null) {
    return failure("DEPENDENCY_INCONSISTENT", consistencyError);
  }

  const changes: DetectedChange[] = [];
  const previousIncident = previousState.incident;
  const currentIncident = currentState.incident;
  if (previousIncident.severity !== currentIncident.severity) {
    addChange(changes, "INCIDENT", currentIncident.id, "SEVERITY_CHANGED", previousIncident.severity, currentIncident.severity);
  }
  if (previousIncident.priority !== currentIncident.priority) {
    addChange(changes, "INCIDENT", currentIncident.id, "PRIORITY_CHANGED", previousIncident.priority, currentIncident.priority);
  }
  if (previousIncident.affectedPopulation !== currentIncident.affectedPopulation) {
    addChange(changes, "INCIDENT", currentIncident.id, "AFFECTED_POPULATION_CHANGED", previousIncident.affectedPopulation, currentIncident.affectedPopulation);
  }
  if (!equalStringArrays(previousIncident.hazards, currentIncident.hazards)) {
    addChange(changes, "INCIDENT", currentIncident.id, "HAZARDS_CHANGED", previousIncident.hazards, currentIncident.hazards);
  }
  if (previousIncident.status !== currentIncident.status) {
    addChange(changes, "INCIDENT", currentIncident.id, "INCIDENT_STATUS_CHANGED", previousIncident.status, currentIncident.status);
  }

  const previousResources = new Map(previousState.resources.map((resource) => [resource.id, resource]));
  for (const currentResource of currentState.resources) {
    const previousResource = previousResources.get(currentResource.id);
    if (previousResource === undefined) continue;
    if (previousResource.status !== currentResource.status) {
      addChange(changes, "RESOURCE", currentResource.id, "RESOURCE_STATUS_CHANGED", previousResource.status, currentResource.status);
    }
    if (previousResource.currentAssignmentId !== currentResource.currentAssignmentId) {
      addChange(changes, "RESOURCE", currentResource.id, "RESOURCE_ASSIGNMENT_CHANGED", previousResource.currentAssignmentId, currentResource.currentAssignmentId);
    }
  }

  const previousFacilities = new Map(previousState.facilities.map((facility) => [facility.id, facility]));
  for (const currentFacility of currentState.facilities) {
    const previousFacility = previousFacilities.get(currentFacility.id);
    if (previousFacility === undefined) continue;
    if (previousFacility.status !== currentFacility.status) {
      addChange(changes, "FACILITY", currentFacility.id, "FACILITY_STATUS_CHANGED", previousFacility.status, currentFacility.status);
    }
    if (previousFacility.availableCapacity !== currentFacility.availableCapacity) {
      addChange(changes, "FACILITY", currentFacility.id, "FACILITY_CAPACITY_CHANGED", previousFacility.availableCapacity, currentFacility.availableCapacity);
    }
  }

  const previousRoutes = new Map(previousState.routes.map((route) => [route.id, route]));
  for (const currentRoute of currentState.routes) {
    const previousRoute = previousRoutes.get(currentRoute.id);
    if (previousRoute === undefined) continue;
    if (previousRoute.status !== currentRoute.status) {
      addChange(changes, "ROUTE", currentRoute.id, "ROUTE_STATUS_CHANGED", previousRoute.status, currentRoute.status);
    }
    if (!equalNullableString(previousRoute.blockedReason, currentRoute.blockedReason)) {
      addChange(changes, "ROUTE", currentRoute.id, "ROUTE_BLOCKED_REASON_CHANGED", previousRoute.blockedReason, currentRoute.blockedReason);
    }
  }

  if (previousState.activePlan?.status !== currentState.activePlan?.status) {
    addChange(changes, "PLAN", activePlan.id, "PLAN_STATUS_CHANGED", previousState.activePlan?.status ?? null, currentState.activePlan?.status ?? null);
  }
  if (previousState.activePlan?.stateVersion !== currentState.activePlan?.stateVersion) {
    addChange(changes, "PLAN", activePlan.id, "PLAN_VERSION_CHANGED", previousState.activePlan?.stateVersion ?? null, currentState.activePlan?.stateVersion ?? null);
  }

  const affectedDependencies = markImpacts(
    changes,
    activePlan,
    previousState,
    currentState,
  );
  const requiresReassessment = affectedDependencies.length > 0;
  const classification =
    changes.length === 0
      ? "NO_MATERIAL_CHANGE"
      : requiresReassessment
        ? "PLAN_AFFECTED_REASSESSMENT_REQUIRED"
        : "MATERIAL_CHANGE_NOT_AFFECTING_PLAN";
  const affectedEntityIds = {
    INCIDENT: [...new Set(changes.filter((change) => change.entityType === "INCIDENT").map((change) => change.entityId))].sort(),
    RESOURCE: [...new Set(changes.filter((change) => change.entityType === "RESOURCE").map((change) => change.entityId))].sort(),
    FACILITY: [...new Set(changes.filter((change) => change.entityType === "FACILITY").map((change) => change.entityId))].sort(),
    ROUTE: [...new Set(changes.filter((change) => change.entityType === "ROUTE").map((change) => change.entityId))].sort(),
    PLAN: [...new Set(changes.filter((change) => change.entityType === "PLAN").map((change) => change.entityId))].sort(),
  } as const;
  return {
    success: true,
    previousStateVersion: previousState.stateVersion,
    currentStateVersion: currentState.stateVersion,
    changes,
    affectedEntityIds,
    affectedDependencies,
    requiresReassessment,
    classification,
    reason:
      classification === "NO_MATERIAL_CHANGE"
        ? "No operational domain fields changed."
        : requiresReassessment
          ? affectedDependencies.map((dependency) => dependency.reason).join(" ")
          : "Operational changes were detected, but none affect the active plan.",
  };
}
