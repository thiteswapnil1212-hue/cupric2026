import type { ResourceRoutingAssessment } from "../agents/resource-routing/schema";
import type { RiskAssessment } from "../agents/risk-assessment/schema";
import type { ResponsePlanningResult } from "../agents/response-planning/agent";
import type { ReactAgentStage, OrchestratorStageTiming } from "./schema";

type StageTiming = Omit<OrchestratorStageTiming, "stage">;

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

export type ReactOrchestrationAgents<State> = {
  riskAssessment: (state: State) => Promise<RiskAssessment>;
  resourceRouting: (state: State) => Promise<ResourceRoutingAssessment>;
  responsePlanning: (
    state: State,
    riskAssessment: RiskAssessment,
    resourceRoutingAssessment: ResourceRoutingAssessment,
  ) => Promise<ResponsePlanningResult>;
};

export type ReactAgentPipelineFailure = {
  kind: "agent-failure" | "observer-failure";
  stage: ReactAgentStage;
  cause: unknown;
  completedStages: readonly ReactAgentStage[];
};

export type ReactAgentPipelineResult =
  | {
      success: true;
      riskAssessment: RiskAssessment;
      resourceRoutingAssessment: ResourceRoutingAssessment;
      responsePlanning: ResponsePlanningResult;
      completedStages: readonly ReactAgentStage[];
      stageTimings: readonly OrchestratorStageTiming[];
    }
  | {
      success: false;
      failure: ReactAgentPipelineFailure;
    };

type TimedStageResult<T> =
  | {
      success: true;
      value: T;
      timing: StageTiming;
    }
  | {
      success: false;
      cause: unknown;
      timing: StageTiming;
      kind: "agent-failure" | "observer-failure";
    };

async function runStage<T>(
  stage: ReactAgentStage,
  execute: () => Promise<T>,
  observer: ReactOrchestrationObserver | undefined,
): Promise<TimedStageResult<T>> {
  const start = performance.now();
  const startedAt = new Date().toISOString();

  function timing(): StageTiming {
    return {
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Math.max(0, performance.now() - start),
    };
  }

  let value: T;
  try {
    value = await execute();
  } catch (cause) {
    const stageTiming = timing();
    try {
      await observer?.onStageFailed?.({
        stage,
        cause,
        timing: stageTiming,
      });
    } catch (observerCause) {
      return {
        success: false,
        cause: observerCause,
        timing: stageTiming,
        kind: "observer-failure",
      };
    }
    return {
      success: false,
      cause,
      timing: stageTiming,
      kind: "agent-failure",
    };
  }

  const stageTiming = timing();
  return {
    success: true,
    value,
    timing: stageTiming,
  };
}

export async function runReactAgentPipeline<State>(
  state: State,
  agents: ReactOrchestrationAgents<State>,
  observer?: ReactOrchestrationObserver,
): Promise<ReactAgentPipelineResult> {
  const completedStages: ReactAgentStage[] = [];
  const stageTimings: OrchestratorStageTiming[] = [];

  const risk = await runStage(
    "risk-assessment",
    () => agents.riskAssessment(state),
    observer,
  );
  if (risk.success === false) {
    return {
      success: false,
      failure: {
        kind: risk.kind,
        stage: "risk-assessment",
        cause: risk.cause,
        completedStages,
      },
    };
  }
  completedStages.push("risk-assessment");
  stageTimings.push({ stage: "risk-assessment", ...risk.timing });
  try {
    await observer?.onStageCompleted?.({
      stage: "risk-assessment",
      output: risk.value,
      timing: risk.timing,
    });
  } catch (cause) {
    return {
      success: false,
      failure: {
        kind: "observer-failure",
        stage: "risk-assessment",
        cause,
        completedStages,
      },
    };
  }

  const routing = await runStage(
    "resource-routing",
    () => agents.resourceRouting(state),
    observer,
  );
  if (routing.success === false) {
    return {
      success: false,
      failure: {
        kind: routing.kind,
        stage: "resource-routing",
        cause: routing.cause,
        completedStages,
      },
    };
  }
  completedStages.push("resource-routing");
  stageTimings.push({ stage: "resource-routing", ...routing.timing });
  try {
    await observer?.onStageCompleted?.({
      stage: "resource-routing",
      output: routing.value,
      timing: routing.timing,
    });
  } catch (cause) {
    return {
      success: false,
      failure: {
        kind: "observer-failure",
        stage: "resource-routing",
        cause,
        completedStages,
      },
    };
  }

  const planning = await runStage(
    "response-planning",
    () =>
      agents.responsePlanning(state, risk.value, routing.value),
    observer,
  );
  if (planning.success === false) {
    return {
      success: false,
      failure: {
        kind: planning.kind,
        stage: "response-planning",
        cause: planning.cause,
        completedStages,
      },
    };
  }
  completedStages.push("response-planning");
  stageTimings.push({ stage: "response-planning", ...planning.timing });
  try {
    await observer?.onStageCompleted?.({
      stage: "response-planning",
      output: planning.value,
      timing: planning.timing,
    });
  } catch (cause) {
    return {
      success: false,
      failure: {
        kind: "observer-failure",
        stage: "response-planning",
        cause,
        completedStages,
      },
    };
  }

  return {
    success: true,
    riskAssessment: risk.value,
    resourceRoutingAssessment: routing.value,
    responsePlanning: planning.value,
    completedStages,
    stageTimings,
  };
}
