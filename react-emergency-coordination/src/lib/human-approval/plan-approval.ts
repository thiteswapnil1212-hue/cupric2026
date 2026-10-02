import {
  HumanDecisionSchema,
  type HumanDecision,
} from "../../domain/human-decision/schema";
import type { EmergencyState } from "../../domain/emergency-state/schema";
import {
  ResponsePlanSchema,
  type ResponsePlan,
} from "../../domain/response-plan/schema";
import { validatePlan } from "../emergency-engine/plan-validator";

export type PlanApprovalErrorCode =
  | "PLAN_NOT_PENDING_APPROVAL"
  | "PLAN_STALE"
  | "PLAN_INVALID"
  | "APPROVAL_NOT_ALLOWED"
  | "REJECTION_REASON_REQUIRED"
  | "MODIFICATION_NOT_ALLOWED"
  | "MODIFIED_PLAN_INVALID"
  | "EXECUTION_NOT_APPROVED"
  | "SUBMISSION_NOT_ALLOWED";

export type PlanApprovalError = {
  code: PlanApprovalErrorCode;
  message: string;
};

export type DecisionMetadata = Omit<
  HumanDecision,
  "planId" | "decision" | "status" | "modifiedPlanId"
> & {
  currentState?: EmergencyState;
  currentIncidentId?: string;
  currentStateVersion?: number;
};

export type PlanApprovalResult = {
  success: true;
  plan: ResponsePlan;
  decision?: HumanDecision;
};

export type PlanApprovalFailure = {
  success: false;
  error: PlanApprovalError;
};

export type PlanApprovalOperationResult =
  | PlanApprovalResult
  | PlanApprovalFailure;

function failure(
  code: PlanApprovalErrorCode,
  message: string,
): PlanApprovalFailure {
  return { success: false, error: { code, message } };
}

function decisionMetadata(
  plan: ResponsePlan,
  metadata: DecisionMetadata,
  decision: HumanDecision["decision"],
  modifiedPlanId: string | null,
): HumanDecision | PlanApprovalFailure {
  if (metadata.incidentId !== plan.incidentId) {
    return failure(
      "PLAN_INVALID",
      "Human decision incidentId must match the response plan incidentId.",
    );
  }

  const parsed = HumanDecisionSchema.safeParse({
    id: metadata.id,
    planId: plan.id,
    incidentId: plan.incidentId,
    decision,
    status: "RECORDED",
    coordinatorId: metadata.coordinatorId,
    reason: metadata.reason,
    modifiedPlanId,
    decidedAt: metadata.decidedAt,
    recordedAt: metadata.recordedAt,
  });

  if (!parsed.success) {
    return failure(
      "PLAN_INVALID",
      "Decision metadata does not satisfy the HumanDecision schema.",
    );
  }

  return parsed.data;
}

function validatePlanStructure(plan: ResponsePlan): PlanApprovalFailure | null {
  if (!ResponsePlanSchema.safeParse(plan).success) {
    return failure("PLAN_INVALID", "ResponsePlan structure is invalid.");
  }

  return null;
}

function validateAgainstCurrentState(
  plan: ResponsePlan,
  metadata: Pick<
    DecisionMetadata,
    "currentState" | "currentIncidentId" | "currentStateVersion"
  >,
  invalidCode: PlanApprovalErrorCode = "PLAN_INVALID",
): PlanApprovalFailure | null {
  const structureFailure = validatePlanStructure(plan);
  if (structureFailure !== null) {
    return structureFailure.error.code === "PLAN_INVALID"
      ? failure(invalidCode, structureFailure.error.message)
      : structureFailure;
  }

  const currentIncidentId =
    metadata.currentState?.incident.id ?? metadata.currentIncidentId;
  const currentStateVersion =
    metadata.currentState?.stateVersion ?? metadata.currentStateVersion;

  if (
    currentIncidentId !== undefined &&
    currentIncidentId !== plan.incidentId
  ) {
    return failure(
      invalidCode,
      "ResponsePlan incidentId does not match the current incident.",
    );
  }

  if (
    currentStateVersion !== undefined &&
    currentStateVersion !== plan.stateVersion
  ) {
    return failure(
      "PLAN_STALE",
      "ResponsePlan stateVersion does not match the current state version.",
    );
  }

  if (metadata.currentState !== undefined) {
    const validation = validatePlan(plan, metadata.currentState);
    if (!validation.valid) {
      const stale = validation.errors.some(
        (issue) =>
          issue.code === "PLAN_STATE_VERSION_STALE" ||
          issue.code === "PLAN_STATE_VERSION_FUTURE",
      );
      return failure(
        stale ? "PLAN_STALE" : invalidCode,
        stale
          ? "ResponsePlan is not valid for the current emergency state version."
          : "ResponsePlan failed deterministic plan validation.",
      );
    }
  }

  return null;
}

function createTransitionedPlan(
  plan: ResponsePlan,
  status: ResponsePlan["status"],
  updatedAt: string,
): ResponsePlan {
  return { ...plan, status, updatedAt };
}

export function submitPlanForApproval(
  plan: ResponsePlan,
): PlanApprovalOperationResult {
  const validationFailure = validatePlanStructure(plan);
  if (validationFailure !== null) return validationFailure;
  if (plan.status !== "DRAFT") {
    return failure(
      "SUBMISSION_NOT_ALLOWED",
      "Only a DRAFT response plan can be submitted for approval.",
    );
  }

  return {
    success: true,
    plan: createTransitionedPlan(plan, "PENDING_APPROVAL", plan.updatedAt),
  };
}

export function approvePlan(
  plan: ResponsePlan,
  metadata: DecisionMetadata,
): PlanApprovalOperationResult {
  if (plan.status !== "PENDING_APPROVAL") {
    return failure(
      "APPROVAL_NOT_ALLOWED",
      "Only a PENDING_APPROVAL response plan can be approved.",
    );
  }

  const validationFailure = validateAgainstCurrentState(plan, metadata);
  if (validationFailure !== null) return validationFailure;

  const decision = decisionMetadata(plan, metadata, "APPROVE", null);
  if (!("decision" in decision)) return decision;

  return {
    success: true,
    plan: createTransitionedPlan(plan, "APPROVED", metadata.decidedAt),
    decision,
  };
}

export function rejectPlan(
  plan: ResponsePlan,
  metadata: DecisionMetadata,
): PlanApprovalOperationResult {
  if (plan.status !== "PENDING_APPROVAL") {
    return failure(
      "PLAN_NOT_PENDING_APPROVAL",
      "Only a PENDING_APPROVAL response plan can be rejected.",
    );
  }
  if (metadata.reason.trim().length === 0) {
    return failure("REJECTION_REASON_REQUIRED", "A rejection reason is required.");
  }

  const validationFailure = validateAgainstCurrentState(plan, metadata);
  if (validationFailure !== null) return validationFailure;

  const decision = decisionMetadata(plan, metadata, "REJECT", null);
  if (!("decision" in decision)) return decision;

  return {
    success: true,
    plan: createTransitionedPlan(plan, "REJECTED", metadata.decidedAt),
    decision,
  };
}

export function modifyPlan(
  plan: ResponsePlan,
  modifiedPlan: ResponsePlan,
  metadata: DecisionMetadata,
): PlanApprovalOperationResult {
  if (plan.status !== "PENDING_APPROVAL") {
    return failure(
      "MODIFICATION_NOT_ALLOWED",
      "Only a PENDING_APPROVAL response plan can be modified.",
    );
  }
  if (modifiedPlan.incidentId !== plan.incidentId) {
    return failure(
      "MODIFIED_PLAN_INVALID",
      "A modified response plan must preserve incidentId.",
    );
  }
  if (modifiedPlan.stateVersion !== plan.stateVersion) {
    return failure(
      "PLAN_STALE",
      "A modified response plan must preserve the original stateVersion.",
    );
  }

  const validationFailure = validateAgainstCurrentState(
    modifiedPlan,
    metadata,
    "MODIFIED_PLAN_INVALID",
  );
  if (validationFailure !== null) return validationFailure;

  const decision = decisionMetadata(plan, metadata, "MODIFY", modifiedPlan.id);
  if (!("decision" in decision)) return decision;

  return {
    success: true,
    plan: createTransitionedPlan(modifiedPlan, "MODIFIED", metadata.decidedAt),
    decision,
  };
}

export function canExecuteApprovedPlan(
  plan: ResponsePlan,
  context: Pick<
    DecisionMetadata,
    "currentState" | "currentIncidentId" | "currentStateVersion"
  > = {},
): boolean {
  if (plan.status !== "APPROVED") return false;
  return validateAgainstCurrentState(plan, context) === null;
}
