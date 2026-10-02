import type { EmergencyState } from "../../domain/emergency-state/schema";
import type { ResponsePlan } from "../../domain/response-plan/schema";
import type {
  EmergencyStateConsistencyIssueCode,
} from "./consistency";
import { validateEmergencyStateConsistency } from "./consistency";
import { listCompleteActiveResponsePlansForIncident } from "../supabase/services/response-plans";

export type ActiveEmergencyPlanStatus = "NONE" | "ACTIVE" | "STALE" | "INVALID";

export type ActiveEmergencyPlanIssueCode =
  | EmergencyStateConsistencyIssueCode
  | "MULTIPLE_ACTIVE_PLANS";

export type ActiveEmergencyPlanIssue = {
  code: ActiveEmergencyPlanIssueCode;
  message: string;
  entityType: "STATE" | "PLAN" | "INCIDENT" | "RESOURCE" | "FACILITY" | "ROUTE";
  entityId: string | null;
};

export type ActiveEmergencyPlanResult = {
  plan: ResponsePlan | null;
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
      : warnings.some((issue) => issue.code === "ACTIVE_PLAN_STALE")
        ? "STALE"
        : "ACTIVE";

  return {
    plan,
    status,
    errors,
    warnings,
  };
}

function comparePersistedPlans(left: ResponsePlan, right: ResponsePlan): number {
  const updatedAtDifference =
    Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  if (updatedAtDifference !== 0) return updatedAtDifference;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

/**
 * Retrieves the latest complete active-status plan for this state.
 */
export async function getActiveEmergencyPlan(
  state: EmergencyState,
): Promise<ActiveEmergencyPlanResult> {
  const activePlans = (
    await listCompleteActiveResponsePlansForIncident(state.incident.id)
  ).sort(comparePersistedPlans);
  const plan = activePlans[0];

  if (plan === undefined) return emptyResult();

  const assessedPlan = assessActiveEmergencyPlan(state, plan);
  if (activePlans.length === 1) return assessedPlan;

  return {
    ...assessedPlan,
    warnings: [
      ...assessedPlan.warnings,
      consistencyIssue(
        "MULTIPLE_ACTIVE_PLANS",
        `${activePlans.length} active-status plans exist; the latest updated plan was selected, with id as the tie-breaker.`,
        plan.id,
      ),
    ],
  };
}
