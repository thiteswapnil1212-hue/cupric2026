import "server-only";

import {
  EmergencyStateSchema,
  type EmergencyState,
} from "../../domain/emergency-state/schema";
import {
  runResourceRoutingAssessment,
} from "../agents/resource-routing/agent";
import {
  runRiskAssessment,
} from "../agents/risk-assessment/agent";
import {
  runResponsePlanning,
} from "../agents/response-planning/agent";
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
  durationMs: number;
};

async function runStage<T>(
  stage: ReactAgentStage,
  execute: () => Promise<T>,
): Promise<TimedResult<T>> {
  const startedAt = performance.now();
  let value: T;
  try {
    value = await execute();
  } catch (cause) {
    throw new ReactOrchestrationStageError(stage, cause);
  }
  return {
    value,
    durationMs: Math.max(0, performance.now() - startedAt),
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

  const riskResult = await runStage("risk-assessment", () =>
    runRiskAssessment(state),
  );
  stageTimings.push({
    stage: "risk-assessment",
    durationMs: riskResult.durationMs,
  });

  const routingResult = await runStage("resource-routing", () =>
    runResourceRoutingAssessment(state),
  );
  stageTimings.push({
    stage: "resource-routing",
    durationMs: routingResult.durationMs,
  });

  const planningResult = await runStage("response-planning", () =>
    runResponsePlanning(state, riskResult.value, routingResult.value),
  );
  stageTimings.push({
    stage: "response-planning",
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
