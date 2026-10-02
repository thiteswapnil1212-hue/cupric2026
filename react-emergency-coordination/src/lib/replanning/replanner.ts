import {
  EmergencyStateSchema,
  type EmergencyState,
} from "../../domain/emergency-state/schema";
import {
  ResponsePlanSchema,
  type ResponsePlan,
} from "../../domain/response-plan/schema";
import type { ResourceRoutingAssessment } from "../agents/resource-routing/schema";
import type { RiskAssessment } from "../agents/risk-assessment/schema";
import { detectEmergencyStateChanges } from "../change-detection/detector";
import type { ChangeDetectionSuccess } from "../change-detection/schema";
import { validateEmergencyStateConsistency } from "../emergency-state/consistency";
import {
  runReactAgentPipeline,
  type ReactOrchestrationAgents,
} from "../orchestrator/pipeline";
import { validatePlan, type PlanValidationResult } from "../emergency-engine/plan-validator";
import {
  replanningError,
  type ReplanningError,
} from "./errors";
import type {
  ReplanningResult,
  ReplanningStatus,
  ReplanningTiming,
} from "./schema";

export type ReplanningAgents = ReactOrchestrationAgents<EmergencyState>;

export type ReplanningOptions = {
  readonly activePlan?: ResponsePlan;
  readonly agents?: ReplanningAgents;
};

type ReplanningContext = {
  readonly previousState: EmergencyState;
  readonly currentState: EmergencyState;
  readonly activePlan: ResponsePlan;
  readonly changeDetection: ChangeDetectionSuccess;
};

function timing(startedAt: string, startedAtMs: number, stages: ReplanningTiming["stages"]): ReplanningTiming {
  return {
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs: Math.max(0, performance.now() - startedAtMs),
    stages,
  };
}

function baseResult(
  context: ReplanningContext,
  status: ReplanningStatus,
  startedAt: string,
  startedAtMs: number,
  stages: ReplanningTiming["stages"],
  values: {
    readonly reassessmentPerformed: boolean;
    readonly riskAssessment: RiskAssessment | null;
    readonly resourceRoutingAssessment: ResourceRoutingAssessment | null;
    readonly revisedPlan: ResponsePlan | null;
    readonly validation: PlanValidationResult | null;
    readonly previousPlanSuperseded: boolean;
    readonly error: ReplanningError | null;
  },
): ReplanningResult {
  return {
    success:
      status === "NOT_REQUIRED" || status === "PENDING_HUMAN_APPROVAL",
    status,
    incidentId: context.currentState.incident.id,
    previousPlanId: context.activePlan.id,
    previousPlanStateVersion: context.activePlan.stateVersion,
    currentStateVersion: context.currentState.stateVersion,
    changeClassification: context.changeDetection.classification,
    affectedDependencies: context.changeDetection.affectedDependencies,
    changeRecords: context.changeDetection.changes,
    reassessmentPerformed: values.reassessmentPerformed,
    riskAssessment: values.riskAssessment,
    resourceRoutingAssessment: values.resourceRoutingAssessment,
    revisedPlan: values.revisedPlan,
    validation: values.validation,
    previousPlanSuperseded: values.previousPlanSuperseded,
    previousPlanSupersessionPersisted: false,
    timing: timing(startedAt, startedAtMs, stages),
    error: values.error,
  };
}

function invalidResult(
  previousState: EmergencyState,
  currentState: EmergencyState,
  activePlan: ResponsePlan | null,
  startedAt: string,
  startedAtMs: number,
  error: ReplanningError,
): ReplanningResult {
  const fallbackPlan = activePlan ?? currentState.activePlan ?? previousState.activePlan;
  const fallbackClassification = "PLAN_AFFECTED_REASSESSMENT_REQUIRED" as const;
  return {
    success: false,
    status: "FAILED",
    incidentId: currentState.incident.id,
    previousPlanId: fallbackPlan?.id ?? "",
    previousPlanStateVersion: fallbackPlan?.stateVersion ?? previousState.stateVersion,
    currentStateVersion: currentState.stateVersion,
    changeClassification: fallbackClassification,
    affectedDependencies: [],
    changeRecords: [],
    reassessmentPerformed: false,
    riskAssessment: null,
    resourceRoutingAssessment: null,
    revisedPlan: null,
    validation: null,
    previousPlanSuperseded: false,
    previousPlanSupersessionPersisted: false,
    timing: timing(startedAt, startedAtMs, []),
    error,
  };
}

async function defaultAgents(): Promise<ReplanningAgents> {
  const [
    { runRiskAssessment },
    { runResourceRoutingAssessment },
    { runResponsePlanning },
  ] = await Promise.all([
    import("../agents/risk-assessment/agent"),
    import("../agents/resource-routing/agent"),
    import("../agents/response-planning/agent"),
  ]);
  return {
    riskAssessment: runRiskAssessment,
    resourceRouting: runResourceRoutingAssessment,
    responsePlanning: runResponsePlanning,
  };
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Reassessment stage failed.";
}

function validationFailure(
  validation: PlanValidationResult,
  context: ReplanningContext,
  startedAt: string,
  startedAtMs: number,
  stages: ReplanningTiming["stages"],
  code: "REVISED_PLAN_INVALID" | "REVISED_PLAN_STALE",
): ReplanningResult {
  return baseResult(context, "VALIDATION_FAILED", startedAt, startedAtMs, stages, {
    reassessmentPerformed: true,
    riskAssessment: null,
    resourceRoutingAssessment: null,
    revisedPlan: null,
    validation,
    previousPlanSuperseded: false,
    error: replanningError(
      code,
      validation.errors.map((issue) => `${issue.code}: ${issue.message}`).join(" "),
      "response-planning",
    ),
  });
}

export async function replanEmergencyResponse(
  previousState: EmergencyState,
  currentState: EmergencyState,
  options: ReplanningOptions = {},
): Promise<ReplanningResult> {
  const startedAt = new Date().toISOString();
  const startedAtMs = performance.now();
  const activePlan = options.activePlan ?? currentState.activePlan ?? previousState.activePlan;

  const previousValidation = EmergencyStateSchema.safeParse(previousState);
  const currentValidation = EmergencyStateSchema.safeParse(currentState);
  if (!previousValidation.success || !currentValidation.success) {
    return invalidResult(
      previousState,
      currentState,
      activePlan,
      startedAt,
      startedAtMs,
      replanningError("INVALID_REPLANNING_REQUEST", "Both EmergencyState inputs must be valid."),
    );
  }
  if (activePlan === null) {
    return invalidResult(
      previousState,
      currentState,
      activePlan,
      startedAt,
      startedAtMs,
      replanningError("ACTIVE_PLAN_MISSING", "An active ResponsePlan is required."),
    );
  }
  if (!ResponsePlanSchema.safeParse(activePlan).success) {
    return invalidResult(
      previousState,
      currentState,
      activePlan,
      startedAt,
      startedAtMs,
      replanningError("ACTIVE_PLAN_INVALID", "The active ResponsePlan is invalid."),
    );
  }
  if (previousState.incident.id !== currentState.incident.id || activePlan.incidentId !== currentState.incident.id) {
    return invalidResult(
      previousState,
      currentState,
      activePlan,
      startedAt,
      startedAtMs,
      replanningError("STATE_INCIDENT_MISMATCH", "States and active plan must belong to the same incident."),
    );
  }
  if (currentState.stateVersion <= previousState.stateVersion) {
    return invalidResult(
      previousState,
      currentState,
      activePlan,
      startedAt,
      startedAtMs,
      replanningError("STATE_VERSION_INVALID", "Current stateVersion must be greater than previous stateVersion."),
    );
  }
  const consistency = validateEmergencyStateConsistency(currentState);
  if (!consistency.valid) {
    return invalidResult(
      previousState,
      currentState,
      activePlan,
      startedAt,
      startedAtMs,
      replanningError("INVALID_REPLANNING_REQUEST", "Current EmergencyState is inconsistent."),
    );
  }

  const changeDetection = detectEmergencyStateChanges({
    previousState,
    currentState,
    activePlan,
  });
  if (changeDetection.success === false) {
    return invalidResult(
      previousState,
      currentState,
      activePlan,
      startedAt,
      startedAtMs,
      replanningError("CHANGE_DETECTION_FAILED", changeDetection.error.message, "change-detection"),
    );
  }
  const context: ReplanningContext = {
    previousState,
    currentState,
    activePlan,
    changeDetection,
  };
  const detectionStages: ReplanningTiming["stages"] = [
    { stage: "change-detection", durationMs: Math.max(0, performance.now() - startedAtMs) },
  ];
  if (changeDetection.classification !== "PLAN_AFFECTED_REASSESSMENT_REQUIRED") {
    return baseResult(context, "NOT_REQUIRED", startedAt, startedAtMs, detectionStages, {
      reassessmentPerformed: false,
      riskAssessment: null,
      resourceRoutingAssessment: null,
      revisedPlan: null,
      validation: null,
      previousPlanSuperseded: false,
      error: null,
    });
  }

  let agents: ReplanningAgents;
  try {
    agents = options.agents ?? (await defaultAgents());
  } catch {
    return baseResult(context, "FAILED", startedAt, startedAtMs, detectionStages, {
      reassessmentPerformed: false,
      riskAssessment: null,
      resourceRoutingAssessment: null,
      revisedPlan: null,
      validation: null,
      previousPlanSuperseded: false,
      error: replanningError("REASSESSMENT_FAILED", "Reassessment agents could not be loaded."),
    });
  }

  const pipeline = await runReactAgentPipeline(currentState, agents);
  if (pipeline.success === false) {
    return baseResult(context, "FAILED", startedAt, startedAtMs, detectionStages, {
      reassessmentPerformed: true,
      riskAssessment: null,
      resourceRoutingAssessment: null,
      revisedPlan: null,
      validation: null,
      previousPlanSuperseded: false,
      error: replanningError(
        pipeline.failure.stage === "response-planning"
          ? "PLAN_GENERATION_FAILED"
          : "REASSESSMENT_FAILED",
        failureMessage(pipeline.failure.cause),
        pipeline.failure.stage,
      ),
    });
  }

  const generated = pipeline.responsePlanning;
  const revisedPlan = {
    ...generated.plan,
    status: "PENDING_APPROVAL" as const,
  };
  if (revisedPlan.id === activePlan.id || revisedPlan.incidentId !== currentState.incident.id) {
    return validationFailure(
      {
        valid: false,
        errors: [
          {
            code: "PLAN_INVALID",
            message: "Revised plan identity or incident does not match replanning requirements.",
          },
        ],
        warnings: [],
      },
      context,
      startedAt,
      startedAtMs,
      detectionStages,
      "REVISED_PLAN_INVALID",
    );
  }
  if (revisedPlan.stateVersion !== currentState.stateVersion) {
    return validationFailure(
      {
        valid: false,
        errors: [
          {
            code: "PLAN_STATE_VERSION_STALE",
            message: "Revised plan stateVersion does not match current stateVersion.",
          },
        ],
        warnings: [],
      },
      context,
      startedAt,
      startedAtMs,
      detectionStages,
      "REVISED_PLAN_STALE",
    );
  }
  const validation = validatePlan(revisedPlan, {
    ...currentState,
    planActions: [...currentState.planActions, ...generated.actions],
  });
  if (!validation.valid) {
    return validationFailure(
      validation,
      context,
      startedAt,
      startedAtMs,
      detectionStages,
      "REVISED_PLAN_INVALID",
    );
  }

  return baseResult(context, "PENDING_HUMAN_APPROVAL", startedAt, startedAtMs, detectionStages, {
    reassessmentPerformed: true,
    riskAssessment: pipeline.riskAssessment,
    resourceRoutingAssessment: pipeline.resourceRoutingAssessment,
    revisedPlan: ResponsePlanSchema.parse(revisedPlan),
    validation,
    previousPlanSuperseded: true,
    error: null,
  });
}
