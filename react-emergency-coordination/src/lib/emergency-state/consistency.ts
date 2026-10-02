import { z } from "zod";
import type { EmergencyState } from "../../domain/emergency-state/schema";

export type EmergencyStateConsistencyEntityType =
  | "STATE"
  | "INCIDENT"
  | "RESOURCE"
  | "FACILITY"
  | "ROUTE"
  | "PLAN";

export type EmergencyStateConsistencyIssueCode =
  | "INCIDENT_IDENTITY_INVALID"
  | "ACTIVE_PLAN_INCIDENT_MISMATCH"
  | "ACTIVE_PLAN_FUTURE_VERSION"
  | "ACTIVE_PLAN_STALE"
  | "PLAN_RESOURCE_DEPENDENCY_MISSING"
  | "PLAN_FACILITY_DEPENDENCY_MISSING"
  | "PLAN_ROUTE_DEPENDENCY_MISSING"
  | "RESOURCE_ASSIGNMENT_UNVERIFIABLE"
  | "RESOURCE_ASSIGNMENT_REQUIRED"
  | "FACILITY_CAPACITY_INVALID"
  | "ROUTE_STATUS_REASON_MISMATCH"
  | "RESOURCE_ID_DUPLICATE"
  | "FACILITY_ID_DUPLICATE"
  | "ROUTE_ID_DUPLICATE"
  | "STATE_VERSION_INVALID"
  | "STATE_UPDATED_AT_INVALID"
  | "ENTITY_UPDATED_AT_INVALID"
  | "ENTITY_UPDATED_AFTER_STATE";

export type EmergencyStateConsistencyIssue = {
  code: EmergencyStateConsistencyIssueCode;
  message: string;
  entityType: EmergencyStateConsistencyEntityType;
  entityId: string | null;
};

export type EmergencyStateConsistencyResult = {
  valid: boolean;
  errors: readonly EmergencyStateConsistencyIssue[];
  warnings: readonly EmergencyStateConsistencyIssue[];
};

const isoDateTimeSchema = z.iso.datetime();

export function validateEmergencyStateConsistency(
  state: EmergencyState,
): EmergencyStateConsistencyResult {
  const errors: EmergencyStateConsistencyIssue[] = [];
  const warnings: EmergencyStateConsistencyIssue[] = [];

  function addError(
    code: EmergencyStateConsistencyIssueCode,
    message: string,
    entityType: EmergencyStateConsistencyEntityType,
    entityId: string | null = null,
  ): void {
    errors.push({ code, message, entityType, entityId });
  }

  function addWarning(
    code: EmergencyStateConsistencyIssueCode,
    message: string,
    entityType: EmergencyStateConsistencyEntityType,
    entityId: string | null = null,
  ): void {
    warnings.push({ code, message, entityType, entityId });
  }

  const incident = state.incident;
  if (incident.id.trim().length === 0) {
    addError(
      "INCIDENT_IDENTITY_INVALID",
      "EmergencyState must have exactly one incident with a non-empty root id.",
      "INCIDENT",
      incident.id,
    );
  }

  if (!Number.isSafeInteger(state.stateVersion) || state.stateVersion < 1) {
    addError(
      "STATE_VERSION_INVALID",
      "EmergencyState stateVersion must be an integer greater than or equal to 1.",
      "STATE",
    );
  }

  const stateUpdatedAtResult = isoDateTimeSchema.safeParse(state.updatedAt);
  const stateUpdatedAt = stateUpdatedAtResult.success
    ? Date.parse(state.updatedAt)
    : null;
  if (stateUpdatedAt === null) {
    addError(
      "STATE_UPDATED_AT_INVALID",
      "EmergencyState updatedAt must be a valid ISO datetime.",
      "STATE",
    );
  }

  function checkEntityTimestamp(
    entityType: EmergencyStateConsistencyEntityType,
    entityId: string,
    updatedAt: string,
  ): void {
    const timestampResult = isoDateTimeSchema.safeParse(updatedAt);
    if (!timestampResult.success) {
      addError(
        "ENTITY_UPDATED_AT_INVALID",
        `${entityType} updatedAt must be a valid ISO datetime.`,
        entityType,
        entityId,
      );
      return;
    }

    if (stateUpdatedAt !== null && Date.parse(updatedAt) > stateUpdatedAt) {
      addError(
        "ENTITY_UPDATED_AFTER_STATE",
        `${entityType} was updated after the EmergencyState snapshot timestamp.`,
        entityType,
        entityId,
      );
    }
  }

  checkEntityTimestamp("INCIDENT", incident.id, incident.updatedAt);

  const resourceIds = new Set(state.resources.map((resource) => resource.id));
  const facilityIds = new Set(state.facilities.map((facility) => facility.id));
  const routeIds = new Set(state.routes.map((route) => route.id));

  function checkUniqueIds(
    entities: readonly { id: string }[],
    entityType: "RESOURCE" | "FACILITY" | "ROUTE",
    code: "RESOURCE_ID_DUPLICATE" | "FACILITY_ID_DUPLICATE" | "ROUTE_ID_DUPLICATE",
  ): void {
    const seen = new Set<string>();
    for (const entity of entities) {
      if (seen.has(entity.id)) {
        addError(
          code,
          `${entityType} id ${entity.id} occurs more than once in EmergencyState.`,
          entityType,
          entity.id,
        );
      }
      seen.add(entity.id);
    }
  }

  checkUniqueIds(state.resources, "RESOURCE", "RESOURCE_ID_DUPLICATE");
  checkUniqueIds(state.facilities, "FACILITY", "FACILITY_ID_DUPLICATE");
  checkUniqueIds(state.routes, "ROUTE", "ROUTE_ID_DUPLICATE");

  for (const resource of state.resources) {
    checkEntityTimestamp("RESOURCE", resource.id, resource.updatedAt);

    if (
      resource.currentAssignmentId === null &&
      (resource.status === "ASSIGNED" || resource.status === "DISPATCHED")
    ) {
      addError(
        "RESOURCE_ASSIGNMENT_REQUIRED",
        `${resource.status} resource must have a currentAssignmentId.`,
        "RESOURCE",
        resource.id,
      );
    } else if (resource.currentAssignmentId !== null) {
      addWarning(
        "RESOURCE_ASSIGNMENT_UNVERIFIABLE",
        "The current state does not include enough plan/action linkage to verify this resource assignment.",
        "RESOURCE",
        resource.id,
      );
    }
  }

  for (const facility of state.facilities) {
    checkEntityTimestamp("FACILITY", facility.id, facility.updatedAt);

    if (
      !Number.isFinite(facility.availableCapacity) ||
      !Number.isFinite(facility.totalCapacity) ||
      facility.availableCapacity < 0 ||
      facility.totalCapacity < 0 ||
      facility.availableCapacity > facility.totalCapacity
    ) {
      addError(
        "FACILITY_CAPACITY_INVALID",
        "Facility capacity must satisfy 0 <= availableCapacity <= totalCapacity.",
        "FACILITY",
        facility.id,
      );
    }
  }

  for (const route of state.routes) {
    checkEntityTimestamp("ROUTE", route.id, route.updatedAt);

    const hasBlockedReason =
      typeof route.blockedReason === "string" &&
      route.blockedReason.trim().length > 0;
    const statusReasonMismatch =
      (route.status === "OPEN" && route.blockedReason !== null) ||
      ((route.status === "BLOCKED" || route.status === "CLOSED") &&
        !hasBlockedReason);

    if (statusReasonMismatch) {
      addError(
        "ROUTE_STATUS_REASON_MISMATCH",
        `Route status ${route.status} is inconsistent with blockedReason.`,
        "ROUTE",
        route.id,
      );
    }
  }

  const activePlan = state.activePlan;
  if (activePlan !== null) {
    checkEntityTimestamp("PLAN", activePlan.id, activePlan.updatedAt);

    if (activePlan.incidentId !== incident.id) {
      addError(
        "ACTIVE_PLAN_INCIDENT_MISMATCH",
        "Active plan incidentId must match the EmergencyState incident id.",
        "PLAN",
        activePlan.id,
      );
    }

    if (activePlan.stateVersion > state.stateVersion) {
      addError(
        "ACTIVE_PLAN_FUTURE_VERSION",
        "Active plan stateVersion cannot exceed EmergencyState stateVersion.",
        "PLAN",
        activePlan.id,
      );
    } else if (activePlan.stateVersion < state.stateVersion) {
      addWarning(
        "ACTIVE_PLAN_STALE",
        "Active plan was generated for an older EmergencyState version.",
        "PLAN",
        activePlan.id,
      );
    }

    for (const resourceId of activePlan.dependencies.resourceIds) {
      if (!resourceIds.has(resourceId)) {
        addError(
          "PLAN_RESOURCE_DEPENDENCY_MISSING",
          `Active plan references missing resource ${resourceId}.`,
          "PLAN",
          activePlan.id,
        );
      }
    }
    for (const facilityId of activePlan.dependencies.facilityIds) {
      if (!facilityIds.has(facilityId)) {
        addError(
          "PLAN_FACILITY_DEPENDENCY_MISSING",
          `Active plan references missing facility ${facilityId}.`,
          "PLAN",
          activePlan.id,
        );
      }
    }
    for (const routeId of activePlan.dependencies.routeIds) {
      if (!routeIds.has(routeId)) {
        addError(
          "PLAN_ROUTE_DEPENDENCY_MISSING",
          `Active plan references missing route ${routeId}.`,
          "PLAN",
          activePlan.id,
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}