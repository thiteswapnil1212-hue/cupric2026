import type { EmergencyState } from "../../domain/emergency-state/schema";
import type { ResponsePlan } from "../../domain/response-plan/schema";
import type {
  EmergencyStateConsistencyIssue,
  EmergencyStateConsistencyIssueCode,
} from "./consistency";
import { validateEmergencyStateConsistency } from "./consistency";
import {
  listResponsePlansForIncident,
  type ResponsePlanRecord,
} from "../supabase/services";

export type ActiveEmergencyPlanStatus = "NONE" | "ACTIVE" | "STALE" | "INVALID";

export type ActiveEmergencyPlanIssueCode =
  | EmergencyStateConsistencyIssueCode
  | "MULTIPLE_ACTIVE_PLANS"
  | "ACTIVE_PLAN_DEPENDENCIES_UNAVAILABLE"
  | "ACTIVE_PLAN_DOMAIN_FIELDS_UNAVAILABLE";

export type ActiveEmergencyPlanIssue = {
  code: ActiveEmergencyPlanIssueCode;
  message: string;
  entityType: "STATE" | "PLAN" | "INCIDENT" | "RESOURCE" | "FACILITY" | "ROUTE";
  entityId: string | null;
};

export type ActiveEmergencyPlanResult = {
  plan: ResponsePlan | null;
  persistedPlan: ResponsePlanRecord | null;
  status: ActiveEmergencyPlanStatus;
  errors: readonly ActiveEmergencyPlanIssue[];
  warnings: readonly ActiveEmergencyPlanIssue[];
};

const activePlanStatuses: readonly ResponsePlan["status"][] = [
  "PENDING_APPROVAL",
  "APPROVED",
  "MODIFIED",
  "EXECUTING",
];

function isActivePlanStatus(status: ResponsePlan["status"]): boolean {
  return activePlanStatuses.includes(status);
}

function isStaleWarning(issue: EmergencyStateConsistencyIssue): boolean {
  return issue.code === "ACTIVE_PLAN_STALE";
}

function consistencyIssue(
  code: ActiveEmergencyPlanIssueCode,
  message: string,
  entityId: string | null,
  entityType: ActiveEmergencyPlanIssue["entityType"] = "PLAN",
): ActiveEmergencyPlanIssue {
  return { code, message, entityType, entityId };
}

function emptyResult(): ActiveEmergencyPlanResult {
  return {
    plan: null,
    persistedPlan: null,
    status: "NONE",
    errors: [],
    warnings: [],
  };
}

/** Assesses a complete domain plan against the supplied current EmergencyState. */
export function assessActiveEmergencyPlan(
  state: EmergencyState,
  plan: ResponsePlan | null,
): ActiveEmergencyPlanResult {
  if (plan === null || !isActivePlanStatus(plan.status)) {
    return emptyResult();
  }

  const consistency = validateEmergencyStateConsistency({
    ...state,
    activePlan: plan,
  });
  const errors = consistency.errors.map((issue) => ({ ...issue }));
  const warnings = consistency.warnings.map((issue) => ({ ...issue }));
  const status: ActiveEmergencyPlanStatus =
    errors.length > 0
      ? "INVALID"
      : warnings.some((issue) => isStaleWarning(issue))
        ? "STALE"
        : "ACTIVE";

  return {
    plan,
    persistedPlan: null,
    status,
    errors,
    warnings,
  };
}

function comparePersistedPlans(
  left: ResponsePlanRecord,
  right: ResponsePlanRecord,
): number {
  const updatedAtDifference =
    Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  if (updatedAtDifference !== 0) return updatedAtDifference;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

/**
 * Retrieves the latest active-status plan metadata for this state.
 * The current table does not persist fields required to construct ResponsePlan,
 * so `plan` remains null and the incomplete persistence is reported as warnings.
 */
export async function getActiveEmergencyPlan(
  state: EmergencyState,
): Promise<ActiveEmergencyPlanResult> {
  const records = await listResponsePlansForIncident(state.incident.id);
  const activeRecords = records
    .filter((record) => isActivePlanStatus(record.status))
    .sort(comparePersistedPlans);
  const record = activeRecords[0];

  if (record === undefined) return emptyResult();

  const stateConsistency = validateEmergencyStateConsistency({
    ...state,
    activePlan: null,
  });
  const errors: ActiveEmergencyPlanIssue[] = stateConsistency.errors.map(
    (issue) => ({ ...issue }),
  );
  const warnings: ActiveEmergencyPlanIssue[] = stateConsistency.warnings.map(
    (issue) => ({ ...issue }),
  );

  if (record.incidentId !== state.incident.id) {
    errors.push(
      consistencyIssue(
        "ACTIVE_PLAN_INCIDENT_MISMATCH",
        "Persisted active plan incidentId does not match the EmergencyState incident id.",
        record.id,
      ),
    );
  }
  if (record.stateVersion > state.stateVersion) {
    errors.push(
      consistencyIssue(
        "ACTIVE_PLAN_FUTURE_VERSION",
        "Persisted active plan stateVersion cannot exceed EmergencyState stateVersion.",
        record.id,
      ),
    );
  } else if (record.stateVersion < state.stateVersion) {
    warnings.push(
      consistencyIssue(
        "ACTIVE_PLAN_STALE",
        "Persisted active plan was generated for an older EmergencyState version.",
        record.id,
      ),
    );
  }

  warnings.push(
    consistencyIssue(
      "ACTIVE_PLAN_DEPENDENCIES_UNAVAILABLE",
      "Persisted response plan dependency metadata is not available for consistency checks.",
      record.id,
    ),
    consistencyIssue(
      "ACTIVE_PLAN_DOMAIN_FIELDS_UNAVAILABLE",
      "Persisted response plan does not include actions, alternatives, or dependencies; no complete ResponsePlan was constructed.",
      record.id,
    ),
  );

  if (activeRecords.length > 1) {
    warnings.push(
      consistencyIssue(
        "MULTIPLE_ACTIVE_PLANS",
        `${activeRecords.length} active-status plans exist; the latest updated plan was selected, with id as the tie-breaker.`,
        record.id,
      ),
    );
  }

  const status: ActiveEmergencyPlanStatus =
    errors.length > 0
      ? "INVALID"
      : record.stateVersion < state.stateVersion
        ? "STALE"
        : "ACTIVE";

  return {
    plan: null,
    persistedPlan: record,
    status,
    errors,
    warnings,
  };
}