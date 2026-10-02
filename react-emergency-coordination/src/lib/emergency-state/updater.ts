import type { Facility } from "../../domain/facility/schema";
import type { Incident } from "../../domain/incident/schema";
import type { Resource } from "../../domain/resource/schema";
import type { Route } from "../../domain/route/schema";
import type { StateChange } from "../../domain/state-change/schema";
import { loadEmergencyState } from "./loader";
import {
  createStateChange,
  getFacilityById,
  getIncidentById,
  getResourceById,
  getRouteById,
  updateFacility,
  updateIncident,
  updateResource,
  updateRoute,
} from "../supabase/services";
import { incrementEmergencyStateVersion } from "../supabase/services/emergency-states";

type ResourceUpdate = {
  entityType: "RESOURCE";
  entityId: string;
  updates: Partial<Pick<Resource, "status" | "currentAssignmentId">>;
};

type FacilityUpdate = {
  entityType: "FACILITY";
  entityId: string;
  updates: Partial<
    Pick<Facility, "status" | "totalCapacity" | "availableCapacity">
  >;
};

type RouteUpdate = {
  entityType: "ROUTE";
  entityId: string;
  updates: Partial<Pick<Route, "status" | "blockedReason">>;
};

type IncidentUpdate = {
  entityType: "INCIDENT";
  entityId: string;
  updates: Partial<
    Pick<Incident, "severity" | "status" | "affectedPopulation">
  >;
};

export type EmergencyStateUpdate =
  | ResourceUpdate
  | FacilityUpdate
  | RouteUpdate
  | IncidentUpdate;

export type EmergencyStateUpdateStage =
  | "load"
  | "entity-write"
  | "state-change-write"
  | "version-increment"
  | "reload";

export class EmergencyStateUpdateError extends Error {
  readonly stage: EmergencyStateUpdateStage;
  readonly cause: unknown;

  constructor(stage: EmergencyStateUpdateStage, cause: unknown) {
    super(
      `Emergency state update failed during ${stage}; earlier writes may already be persisted.`,
    );
    this.name = "EmergencyStateUpdateError";
    this.stage = stage;
    this.cause = cause;
  }
}

type StateChangeValue = Record<string, string | number | null>;

type AppliedChange = {
  entityType: StateChange["entityType"];
  entityId: string;
  changeType: StateChange["changeType"];
  description: string;
  previousValue: StateChangeValue;
  newValue: StateChangeValue;
};

async function atStage<T>(
  stage: EmergencyStateUpdateStage,
  action: () => Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch (cause) {
    throw new EmergencyStateUpdateError(stage, cause);
  }
}

function assertOperation(operation: EmergencyStateUpdate): void {
  if (operation.entityId.trim().length === 0) {
    throw new TypeError("entityId must be a non-empty string.");
  }
  if (Object.values(operation.updates).every((value) => value === undefined)) {
    throw new TypeError("At least one update field must be supplied.");
  }
}

async function applyResourceUpdate(
  incidentId: string,
  operation: ResourceUpdate,
): Promise<AppliedChange | null> {
  const resource = await getResourceById(operation.entityId);
  if (resource === null) {
    throw new Error(`Resource not found: ${operation.entityId}`);
  }

  const updates: Partial<Pick<Resource, "status" | "currentAssignmentId">> = {};
  const previousValue: StateChangeValue = {};
  const newValue: StateChangeValue = {};

  if (
    operation.updates.status !== undefined &&
    operation.updates.status !== resource.status
  ) {
    updates.status = operation.updates.status;
    previousValue.status = resource.status;
    newValue.status = operation.updates.status;
  }
  if (
    operation.updates.currentAssignmentId !== undefined &&
    operation.updates.currentAssignmentId !== resource.currentAssignmentId
  ) {
    updates.currentAssignmentId = operation.updates.currentAssignmentId;
    previousValue.currentAssignmentId = resource.currentAssignmentId;
    newValue.currentAssignmentId = operation.updates.currentAssignmentId;
  }

  if (Object.keys(updates).length === 0) return null;

  const updated = await updateResource(resource.id, {
    ...updates,
    updatedAt: new Date().toISOString(),
  });
  if (updated === null) {
    throw new Error(`Resource not found during update: ${resource.id}`);
  }

  return {
    entityType: "RESOURCE",
    entityId: resource.id,
    changeType: updates.status === undefined ? "UPDATED" : "STATUS_CHANGED",
    description: `Updated resource ${resource.id}.`,
    previousValue,
    newValue,
  };
}

async function applyFacilityUpdate(
  operation: FacilityUpdate,
): Promise<AppliedChange | null> {
  const facility = await getFacilityById(operation.entityId);
  if (facility === null) {
    throw new Error(`Facility not found: ${operation.entityId}`);
  }

  const updates: Partial<
    Pick<Facility, "status" | "totalCapacity" | "availableCapacity">
  > = {};
  const previousValue: StateChangeValue = {};
  const newValue: StateChangeValue = {};

  if (
    operation.updates.status !== undefined &&
    operation.updates.status !== facility.status
  ) {
    updates.status = operation.updates.status;
    previousValue.status = facility.status;
    newValue.status = operation.updates.status;
  }
  if (
    operation.updates.totalCapacity !== undefined &&
    operation.updates.totalCapacity !== facility.totalCapacity
  ) {
    updates.totalCapacity = operation.updates.totalCapacity;
    previousValue.totalCapacity = facility.totalCapacity;
    newValue.totalCapacity = operation.updates.totalCapacity;
  }
  if (
    operation.updates.availableCapacity !== undefined &&
    operation.updates.availableCapacity !== facility.availableCapacity
  ) {
    updates.availableCapacity = operation.updates.availableCapacity;
    previousValue.availableCapacity = facility.availableCapacity;
    newValue.availableCapacity = operation.updates.availableCapacity;
  }

  if (Object.keys(updates).length === 0) return null;

  const updated = await updateFacility(facility.id, {
    ...updates,
    updatedAt: new Date().toISOString(),
  });
  if (updated === null) {
    throw new Error(`Facility not found during update: ${facility.id}`);
  }

  return {
    entityType: "FACILITY",
    entityId: facility.id,
    changeType: updates.status !== undefined ? "STATUS_CHANGED" : "CAPACITY_CHANGED",
    description: `Updated facility ${facility.id}.`,
    previousValue,
    newValue,
  };
}

async function applyRouteUpdate(
  operation: RouteUpdate,
): Promise<AppliedChange | null> {
  const route = await getRouteById(operation.entityId);
  if (route === null) {
    throw new Error(`Route not found: ${operation.entityId}`);
  }

  const updates: Partial<Pick<Route, "status" | "blockedReason">> = {};
  const previousValue: StateChangeValue = {};
  const newValue: StateChangeValue = {};

  if (
    operation.updates.status !== undefined &&
    operation.updates.status !== route.status
  ) {
    updates.status = operation.updates.status;
    previousValue.status = route.status;
    newValue.status = operation.updates.status;
  }
  if (
    operation.updates.blockedReason !== undefined &&
    operation.updates.blockedReason !== route.blockedReason
  ) {
    updates.blockedReason = operation.updates.blockedReason;
    previousValue.blockedReason = route.blockedReason;
    newValue.blockedReason = operation.updates.blockedReason;
  }

  if (Object.keys(updates).length === 0) return null;

  const updated = await updateRoute(route.id, {
    ...updates,
    updatedAt: new Date().toISOString(),
  });
  if (updated === null) {
    throw new Error(`Route not found during update: ${route.id}`);
  }

  return {
    entityType: "ROUTE",
    entityId: route.id,
    changeType: "ROUTE_CHANGED",
    description: `Updated route ${route.id}.`,
    previousValue,
    newValue,
  };
}

async function applyIncidentUpdate(
  incidentId: string,
  operation: IncidentUpdate,
): Promise<AppliedChange | null> {
  if (operation.entityId !== incidentId) {
    throw new Error("Incident updates must target the EmergencyState incident.");
  }

  const incident = await getIncidentById(incidentId);
  if (incident === null) {
    throw new Error(`Incident not found: ${incidentId}`);
  }

  const updates: Partial<
    Pick<Incident, "severity" | "status" | "affectedPopulation">
  > = {};
  const previousValue: StateChangeValue = {};
  const newValue: StateChangeValue = {};

  if (
    operation.updates.severity !== undefined &&
    operation.updates.severity !== incident.severity
  ) {
    updates.severity = operation.updates.severity;
    previousValue.severity = incident.severity;
    newValue.severity = operation.updates.severity;
  }
  if (
    operation.updates.status !== undefined &&
    operation.updates.status !== incident.status
  ) {
    updates.status = operation.updates.status;
    previousValue.status = incident.status;
    newValue.status = operation.updates.status;
  }
  if (
    operation.updates.affectedPopulation !== undefined &&
    operation.updates.affectedPopulation !== incident.affectedPopulation
  ) {
    updates.affectedPopulation = operation.updates.affectedPopulation;
    previousValue.affectedPopulation = incident.affectedPopulation;
    newValue.affectedPopulation = operation.updates.affectedPopulation;
  }

  if (Object.keys(updates).length === 0) return null;

  const updated = await updateIncident(incident.id, {
    ...updates,
    updatedAt: new Date().toISOString(),
  });
  if (updated === null) {
    throw new Error(`Incident not found during update: ${incident.id}`);
  }

  const changeType: StateChange["changeType"] =
    updates.severity !== undefined
      ? "SEVERITY_CHANGED"
      : updates.affectedPopulation !== undefined
        ? "POPULATION_CHANGED"
        : "UPDATED";

  return {
    entityType: "INCIDENT",
    entityId: incident.id,
    changeType,
    description: `Updated incident ${incident.id}.`,
    previousValue,
    newValue,
  };
}

async function applyUpdate(
  incidentId: string,
  operation: EmergencyStateUpdate,
): Promise<AppliedChange | null> {
  switch (operation.entityType) {
    case "RESOURCE":
      return applyResourceUpdate(incidentId, operation);
    case "FACILITY":
      return applyFacilityUpdate(operation);
    case "ROUTE":
      return applyRouteUpdate(operation);
    case "INCIDENT":
      return applyIncidentUpdate(incidentId, operation);
  }
}

export async function updateEmergencyState(
  incidentId: string,
  operation: EmergencyStateUpdate,
) {
  assertOperation(operation);

  const currentState = await atStage("load", () => loadEmergencyState(incidentId));
  const appliedChange = await atStage("entity-write", () =>
    applyUpdate(incidentId, operation),
  );

  if (appliedChange === null) return currentState;

  const occurredAt = new Date().toISOString();
  const stateChange: StateChange = {
    id: crypto.randomUUID(),
    ...appliedChange,
    occurredAt,
    detectedAt: occurredAt,
  };

  await atStage("state-change-write", () => createStateChange(stateChange));
  await atStage("version-increment", () =>
    incrementEmergencyStateVersion(incidentId),
  );

  return atStage("reload", () => loadEmergencyState(incidentId));
}