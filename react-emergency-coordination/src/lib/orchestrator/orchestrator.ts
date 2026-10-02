import "server-only";

import {
  EmergencyStateSchema,
  type EmergencyState,
} from "../../domain/emergency-state/schema";
import { runResourceRoutingAssessment } from "../agents/resource-routing/agent";
import type { ResourceRoutingAssessment } from "../agents/resource-routing/schema";
import { runRiskAssessment } from "../agents/risk-assessment/agent";
import type { RiskAssessment } from "../agents/risk-assessment/schema";
import { runResponsePlanning } from "../agents/response-planning/agent";
import type { ResponsePlanningResult } from "../agents/response-planning/agent";
import {
  ReactOrchestrationInputError,
  ReactOrchestrationOutputError,
  ReactOrchestrationStageError,
} from "./errors";
import {
  ReactOrchestrationResultSchema,
  type OrchestratorStageTiming,
  type ReactAgentStage,
  type ReactOrchestrationResult,
} from "./schema";

type TimedResult<T> = {
  value: T;
  startedAt: string;
  completedAt: string;
  durationMs: number;
};

type StageTiming = {
  startedAt: string;
  completedAt: string;
  durationMs: number;
};

export type OrchestrationStageCompletedEvent =
  | {
      stage: "risk-assessment";
      output: RiskAssessment;
      timing: StageTiming;
    }
  | {
      stage: "resource-routing";
      output: ResourceRoutingAssessment;
      timing: StageTiming;
    }
  | {
      stage: "response-planning";
      output: ResponsePlanningResult;
      timing: StageTiming;
    };

export type OrchestrationStageFailedEvent = {
  stage: ReactAgentStage;
  cause: unknown;
  timing: StageTiming;
};

export type ReactOrchestrationObserver = {
  onStageCompleted?: (
    event: OrchestrationStageCompletedEvent,
  ) => Promise<void>;
  onStageFailed?: (event: OrchestrationStageFailedEvent) => Promise<void>;
};

type StageCallbacks<T> = {
  onCompleted: (value: T, timing: StageTiming) => Promise<void>;
  onFailed: (cause: unknown, timing: StageTiming) => Promise<void>;
};

async function runStage<T>(
  stage: ReactAgentStage,
  execute: () => Promise<T>,
  callbacks: StageCallbacks<T>,
): Promise<TimedResult<T>> {
  const startedAt = performance.now();
  const startedAtTimestamp = new Date().toISOString();
  let value: T;
  try {
    value = await execute();
  } catch (cause) {
    const completedAtTimestamp = new Date().toISOString();
    const timing: StageTiming = {
      startedAt: startedAtTimestamp,
      completedAt: completedAtTimestamp,
      durationMs: Math.max(0, performance.now() - startedAt),
    };
    await callbacks.onFailed(cause, timing);
    throw new ReactOrchestrationStageError(stage, cause);
  }
  const completedAtTimestamp = new Date().toISOString();
  const timing: StageTiming = {
    startedAt: startedAtTimestamp,
    completedAt: completedAtTimestamp,
    durationMs: Math.max(0, performance.now() - startedAt),
  };
  await callbacks.onCompleted(value, timing);
  return {
    value,
    ...timing,
  };
}

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
  const stageTimings: OrchestratorStageTiming[] = [];

  const riskResult = await runStage(
    "risk-assessment",
    () => runRiskAssessment(state),
    {
      onCompleted: async (output, timing) =>
        observer?.onStageCompleted?.({
          stage: "risk-assessment",
          output,
          timing,
        }),
      onFailed: async (cause, timing) =>
        observer?.onStageFailed?.({ stage: "risk-assessment", cause, timing }),
    },
  );
  stageTimings.push({
    stage: "risk-assessment",
    startedAt: riskResult.startedAt,
    completedAt: riskResult.completedAt,
    durationMs: riskResult.durationMs,
  });

  const routingResult = await runStage(
    "resource-routing",
    () => runResourceRoutingAssessment(state),
    {
      onCompleted: async (output, timing) =>
        observer?.onStageCompleted?.({
          stage: "resource-routing",
          output,
          timing,
        }),
      onFailed: async (cause, timing) =>
        observer?.onStageFailed?.({ stage: "resource-routing", cause, timing }),
    },
  );
  stageTimings.push({
    stage: "resource-routing",
    startedAt: routingResult.startedAt,
    completedAt: routingResult.completedAt,
    durationMs: routingResult.durationMs,
  });

  const planningResult = await runStage(
    "response-planning",
    () =>
      runResponsePlanning(state, riskResult.value, routingResult.value),
    {
      onCompleted: async (output, timing) =>
        observer?.onStageCompleted?.({
          stage: "response-planning",
          output,
          timing,
        }),
      onFailed: async (cause, timing) =>
        observer?.onStageFailed?.({ stage: "response-planning", cause, timing }),
    },
  );
  stageTimings.push({
    stage: "response-planning",
    startedAt: planningResult.startedAt,
    completedAt: planningResult.completedAt,
    durationMs: planningResult.durationMs,
  });

  if (
    planningResult.value.plan.incidentId !== state.incident.id ||
    planningResult.value.plan.stateVersion !== state.stateVersion
  ) {
    throw new ReactOrchestrationOutputError(
      "Response planning output did not preserve the input incident identity and state version.",
      [
        `Expected incidentId ${state.incident.id} and stateVersion ${state.stateVersion}.`,
        `Received incidentId ${planningResult.value.plan.incidentId} and stateVersion ${planningResult.value.plan.stateVersion}.`,
      ],
    );
  }

  const result = {
    incidentId: state.incident.id,
    stateVersion: state.stateVersion,
    completedStages: [
      "risk-assessment",
      "resource-routing",
      "response-planning",
    ] as const,
    riskAssessment: riskResult.value,
    resourceRoutingAssessment: routingResult.value,
    responsePlanning: planningResult.value,
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
    );
  }

  return resultValidation.data;
}
