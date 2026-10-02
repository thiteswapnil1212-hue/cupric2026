import "server-only";

import {
  EmergencyStateSchema,
  type EmergencyState,
} from "../../domain/emergency-state/schema";
import { runResourceRoutingAssessment } from "../agents/resource-routing/agent";
import { runRiskAssessment } from "../agents/risk-assessment/agent";
import { runResponsePlanning } from "../agents/response-planning/agent";
import {
  ReactOrchestrationError,
  ReactOrchestrationInputError,
  ReactOrchestrationOutputError,
  ReactOrchestrationStageError,
  ReactOrchestrationUnexpectedError,
} from "./errors";
import {
  runReactAgentPipeline,
  type ReactOrchestrationObserver,
} from "./pipeline";
import {
  ReactOrchestrationResultSchema,
  type OrchestratorStageTiming,
  type ReactOrchestrationResult,
} from "./schema";

export type { ReactOrchestrationObserver } from "./pipeline";
export type {
  OrchestrationStageCompletedEvent,
  OrchestrationStageFailedEvent,
} from "./pipeline";

function formatIssues(
  issues: readonly { path: PropertyKey[]; message: string }[],
): string[] {
  return issues.map((issue) => {
    const path = issue.path.map(String).join(".") || "state";
    return `${path}: ${issue.message}`;
  });
}

export async function runReactOrchestration(
  emergencyState: EmergencyState,
  observer?: ReactOrchestrationObserver,
): Promise<ReactOrchestrationResult> {
  const stateValidation = EmergencyStateSchema.safeParse(emergencyState);
  if (!stateValidation.success) {
    throw new ReactOrchestrationInputError(
      "REACT orchestration requires a valid EmergencyState.",
      formatIssues(stateValidation.error.issues),
      stateValidation.error,
    );
  }

  const state = stateValidation.data;
  const startedAt = new Date().toISOString();
  const totalStartedAt = performance.now();
  const pipeline = await runReactAgentPipeline(
    state,
    {
      riskAssessment: runRiskAssessment,
      resourceRouting: runResourceRoutingAssessment,
      responsePlanning: runResponsePlanning,
    },
    observer,
  );
  if (!pipeline.success) {
    const { failure } = pipeline;
    if (failure.kind === "observer-failure") {
      if (failure.cause instanceof ReactOrchestrationError) {
        throw failure.cause;
      }
      throw new ReactOrchestrationUnexpectedError(failure.completedStages);
    }
    throw new ReactOrchestrationStageError(
      failure.stage,
      failure.cause,
      failure.completedStages,
    );
  }

  const stageTimings: OrchestratorStageTiming[] = [...pipeline.stageTimings];
  if (
    pipeline.responsePlanning.plan.incidentId !== state.incident.id ||
    pipeline.responsePlanning.plan.stateVersion !== state.stateVersion
  ) {
    throw new ReactOrchestrationOutputError(
      "Response planning output did not preserve the input incident identity and state version.",
      [
        `Expected incidentId ${state.incident.id} and stateVersion ${state.stateVersion}.`,
        `Received incidentId ${pipeline.responsePlanning.plan.incidentId} and stateVersion ${pipeline.responsePlanning.plan.stateVersion}.`,
      ],
      undefined,
      {
        failureCategory: "RESPONSE_PLANNING_FAILED",
        failedStage: "response-planning",
        completedStages: pipeline.completedStages.filter(
          (stage) => stage !== "response-planning",
        ),
        recommendation: "REGENERATE_PLAN",
      },
    );
  }

  if (!pipeline.responsePlanning.validation.valid) {
    throw new ReactOrchestrationOutputError(
      "Response planning returned a candidate that failed deterministic PlanValidator checks.",
      pipeline.responsePlanning.validation.errors.map(
        (issue) => `${issue.code}: ${issue.message}`,
      ),
      undefined,
      {
        failureCategory: "PLAN_VALIDATION_FAILED",
        failedStage: "response-planning",
        completedStages: pipeline.completedStages,
        usablePlanExists: false,
        recommendation: "REGENERATE_PLAN",
      },
    );
  }

  const result = {
    status: "COMPLETED" as const,
    incidentId: state.incident.id,
    stateVersion: state.stateVersion,
    usablePlanExists: true as const,
    recovery: {
      failureCategory: null,
      retryable: false,
      failedStage: null,
      completedStages: pipeline.completedStages,
      completedWrites: [],
      usablePlanExists: true,
      partialPersistence: false,
      recommendation: "NONE",
    } as const,
    completedStages: pipeline.completedStages,
    riskAssessment: pipeline.riskAssessment,
    resourceRoutingAssessment: pipeline.resourceRoutingAssessment,
    responsePlanning: pipeline.responsePlanning,
    execution: {
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Math.max(0, performance.now() - totalStartedAt),
      stageTimings,
    },
  };

  const resultValidation = ReactOrchestrationResultSchema.safeParse(result);
  if (!resultValidation.success) {
    throw new ReactOrchestrationOutputError(
      "REACT orchestration result did not match the required schema.",
      formatIssues(resultValidation.error.issues),
      resultValidation.error,
      {
        failureCategory: "UNEXPECTED_ERROR",
        failedStage: null,
        completedStages: pipeline.completedStages,
        usablePlanExists: false,
        recommendation: "ABORT",
      },
    );
  }

  return resultValidation.data;
}
