import type { EmergencyState } from "../../domain/emergency-state/schema";
import type { ResponsePlan } from "../../domain/response-plan/schema";

export const changeDetectionClassifications = [
  "NO_MATERIAL_CHANGE",
  "MATERIAL_CHANGE_NOT_AFFECTING_PLAN",
  "PLAN_AFFECTED_REASSESSMENT_REQUIRED",
] as const;

export type ChangeDetectionClassification =
  (typeof changeDetectionClassifications)[number];

export type ChangeEntityType =
  | "INCIDENT"
  | "RESOURCE"
  | "FACILITY"
  | "ROUTE"
  | "PLAN";

export type ChangeType =
  | "SEVERITY_CHANGED"
  | "PRIORITY_CHANGED"
  | "AFFECTED_POPULATION_CHANGED"
  | "HAZARDS_CHANGED"
  | "INCIDENT_STATUS_CHANGED"
  | "RESOURCE_STATUS_CHANGED"
  | "RESOURCE_ASSIGNMENT_CHANGED"
  | "FACILITY_STATUS_CHANGED"
  | "FACILITY_CAPACITY_CHANGED"
  | "ROUTE_STATUS_CHANGED"
  | "ROUTE_BLOCKED_REASON_CHANGED"
  | "PLAN_STATUS_CHANGED"
  | "PLAN_VERSION_CHANGED";

export type ChangeValue = string | number | boolean | readonly string[] | null;

export type DetectedChange = {
  readonly entityType: ChangeEntityType;
  readonly entityId: string;
  readonly changeType: ChangeType;
  readonly previousValue: ChangeValue;
  readonly currentValue: ChangeValue;
  readonly operationalImpact: "NONE" | "POTENTIAL" | "REASSESSMENT_REQUIRED";
};

export type AffectedDependency = {
  readonly entityType: Exclude<ChangeEntityType, "INCIDENT" | "PLAN"> | "INCIDENT";
  readonly entityId: string;
  readonly reason: string;
};

export type ChangeDetectionErrorCode =
  | "STATE_VERSION_INVALID"
  | "STATE_INCIDENT_MISMATCH"
  | "ACTIVE_PLAN_MISSING"
  | "ACTIVE_PLAN_INVALID"
  | "DEPENDENCY_INCONSISTENT"
  | "INVALID_CHANGE_CONTEXT";

export type ChangeDetectionError = {
  readonly code: ChangeDetectionErrorCode;
  readonly message: string;
};

export type ChangeDetectionSuccess = {
  readonly success: true;
  readonly previousStateVersion: number;
  readonly currentStateVersion: number;
  readonly changes: readonly DetectedChange[];
  readonly affectedEntityIds: Readonly<Record<ChangeEntityType, readonly string[]>>;
  readonly affectedDependencies: readonly AffectedDependency[];
  readonly requiresReassessment: boolean;
  readonly classification: ChangeDetectionClassification;
  readonly reason: string;
};

export type ChangeDetectionFailure = {
  readonly success: false;
  readonly error: ChangeDetectionError;
};

export type ChangeDetectionResult =
  | ChangeDetectionSuccess
  | ChangeDetectionFailure;

export type ChangeDetectionContext = {
  readonly previousState: EmergencyState;
  readonly currentState: EmergencyState;
  readonly activePlan: ResponsePlan | null;
};
