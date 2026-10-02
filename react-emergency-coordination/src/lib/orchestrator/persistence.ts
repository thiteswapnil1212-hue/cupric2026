import "server-only";

import {
  AgentRunSchema,
  type AgentRun,
  type AgentRunStatus,
  type AgentType,
} from "../../domain/agent-run/schema";
import {
  EmergencyStateSchema,
  type EmergencyState,
} from "../../domain/emergency-state/schema";
import {
  PlanActionSchema,
  type PlanAction,
} from "../../domain/plan-action/schema";
import {
  ResponsePlanSchema,
  type ResponsePlan,
} from "../../domain/response-plan/schema";
import { ResourceRoutingAgentError } from "../agents/resource-routing/agent";
import { ResourceRoutingAssessmentSchema } from "../agents/resource-routing/schema";
import { RiskAssessmentAgentError } from "../agents/risk-assessment/agent";
import { RiskAssessmentSchema } from "../agents/risk-assessment/schema";
import {
  ResponsePlanningAgentError,
  type ResponsePlanningResult,
} from "../agents/response-planning/agent";
import { validatePlan } from "../emergency-engine/plan-validator";
import {
  createAgentRun,
  getAgentRunById,
  getResponsePlanById,
  listPlanActionsForPlan,
} from "../supabase/services";
import { createPlanAction } from "../supabase/services/plan-actions";
import {
  createResponsePlan,
  getCompleteResponsePlanById,
  type CreateResponsePlanInput,
} from "../supabase/services/response-plans";
import { getEmergencyStateVersion } from "../supabase/services/emergency-states";
import {
  ReactOrchestrationError,
  ReactOrchestrationInputError,
  ReactOrchestrationOutputError,
  ReactOrchestrationPersistenceError,
  ReactOrchestrationStageError,
} from "./errors";
import {
  runReactOrchestration,
  type OrchestrationStageCompletedEvent,
  type OrchestrationStageFailedEvent,
  type ReactOrchestrationObserver,
} from "./orchestrator";
import {
  ReactOrchestrationResultSchema,
  type ReactAgentStage,
  type ReactOrchestrationResult,
} from "./schema";

export type PersistedReactOrchestrationResult = {
  orchestration: ReactOrchestrationResult;
  agentRuns: readonly AgentRun[];
  responsePlan: ResponsePlan;
  planActions: readonly PlanAction[];
};

const stageAgentTypes: Record<OrchestrationStageCompletedEvent["stage"], AgentType> = {
  "risk-assessment": "RISK_ASSESSMENT",
  "resource-routing": "RESOURCE_ROUTING",
  "response-planning": "RESPONSE_PLANNING",
};

const timeoutAgentCodes = new Set([
  "RISK_ASSESSMENT_GEMINI_TIMEOUT",
  "RESOURCE_ROUTING_GEMINI_TIMEOUT",
  "RESPONSE_PLANNING_GEMINI_TIMEOUT",
]);

const invalidOutputAgentCodes = new Set([
  "RISK_ASSESSMENT_INVALID_STRUCTURED_OUTPUT",
  "RISK_ASSESSMENT_SCHEMA_VALIDATION_FAILED",
  "RISK_ASSESSMENT_FACT_CONFLICT",
  "RESOURCE_ROUTING_INVALID_STRUCTURED_OUTPUT",
  "RESOURCE_ROUTING_SCHEMA_VALIDATION_FAILED",
  "RESOURCE_ROUTING_FACT_CONFLICT",
  "RESOURCE_ROUTING_UNKNOWN_RESOURCE",
  "RESOURCE_ROUTING_UNKNOWN_FACILITY",
  "RESOURCE_ROUTING_UNKNOWN_ROUTE",
  "RESOURCE_ROUTING_DUPLICATE_REFERENCE",
  "RESPONSE_PLANNING_ASSESSMENT_INVALID",
  "RESPONSE_PLANNING_FACT_CONFLICT",
  "RESPONSE_PLANNING_INVALID_STRUCTURED_OUTPUT",
  "RESPONSE_PLANNING_SCHEMA_VALIDATION_FAILED",
  "RESPONSE_PLANNING_OUTPUT_INVALID",
  "RESPONSE_PLANNING_PRIMARY_PLAN_INVALID",
]);

function stableAgentRunId(
  incidentId: string,
  stateVersion: number,
  agentType: AgentType,
): string {
  return `react-orchestration:${incidentId}:${stateVersion}:${agentType}`;
}

function getAgentErrorCode(
  stage: OrchestrationStageFailedEvent["stage"],
  cause: unknown,
): string {
  if (
    stage === "risk-assessment" &&
    cause instanceof RiskAssessmentAgentError
  ) {
    return cause.code;
  }
  if (
    stage === "resource-routing" &&
    cause instanceof ResourceRoutingAgentError
  ) {
    return cause.code;
  }
  if (
    stage === "response-planning" &&
    cause instanceof ResponsePlanningAgentError
  ) {
    return cause.code;
  }
  return "UNEXPECTED_AGENT_ERROR";
}

function failedRunStatus(errorCode: string): AgentRunStatus {
  if (timeoutAgentCodes.has(errorCode)) return "TIMED_OUT";
  if (invalidOutputAgentCodes.has(errorCode)) {
    return "INVALID_OUTPUT";
  }
  return "FAILED";
}

function outputForCompletedStage(
  event: OrchestrationStageCompletedEvent,
): NonNullable<AgentRun["output"]> {
  switch (event.stage) {
    case "risk-assessment":
      return RiskAssessmentSchema.parse(event.output);
    case "resource-routing":
      return ResourceRoutingAssessmentSchema.parse(event.output);
    case "response-planning":
      return {
        responsePlanId: ResponsePlanSchema.parse(event.output.plan).id,
        actionIds: event.output.actions
          .map((action) => PlanActionSchema.parse(action))
          .sort((left, right) => left.sequence - right.sequence)
          .map((action) => action.id),
      };
  }
}

function createCompletedAgentRun(
  incidentId: string,
  stateVersion: number,
  event: OrchestrationStageCompletedEvent,
): AgentRun {
  const agentType = stageAgentTypes[event.stage];
  return {
    id: stableAgentRunId(incidentId, stateVersion, agentType),
    incidentId,
    agentType,
    status: "COMPLETED",
    stateVersion,
    startedAt: event.timing.startedAt,
    completedAt: event.timing.completedAt,
    durationMs: Math.round(event.timing.durationMs),
    output: outputForCompletedStage(event),
    errorMessage: null,
  };
}

function createFailedAgentRun(
  incidentId: string,
  stateVersion: number,
  event: OrchestrationStageFailedEvent,
): AgentRun {
  const agentType = stageAgentTypes[event.stage];
  const errorCode = getAgentErrorCode(event.stage, event.cause);
  return {
    id: stableAgentRunId(incidentId, stateVersion, agentType),
    incidentId,
    agentType,
    status: failedRunStatus(errorCode),
    stateVersion,
    startedAt: event.timing.startedAt,
    completedAt: event.timing.completedAt,
    durationMs: Math.round(event.timing.durationMs),
    output: null,
    errorMessage: `${agentType} failed (${errorCode}).`,
  };
}

function safeParseAgentRun(
  candidate: AgentRun,
  stage: OrchestrationStageFailedEvent["stage"],
  completedWrites: readonly string[],
  completedStages: readonly ReactAgentStage[],
): AgentRun {
  const validation = AgentRunSchema.safeParse(candidate);
  if (!validation.success) {
    throw new ReactOrchestrationPersistenceError({
      message: "AgentRun payload failed domain validation before persistence.",
      operation: "agent-run",
      stage,
      cause: validation.error,
      completedWrites,
      partialWritePossible: false,
      completedStages,
    });
  }
  return validation.data;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "undefined";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0),
  );
  return `{${entries
    .map(
      ([key, entry]) =>
        `${JSON.stringify(key)}:${canonicalJson(entry)}`,
    )
    .join(",")}}`;
}

function sameAgentRun(expected: AgentRun, actual: AgentRun): boolean {
  return (
    expected.id === actual.id &&
    expected.incidentId === actual.incidentId &&
    expected.agentType === actual.agentType &&
    expected.status === actual.status &&
    expected.stateVersion === actual.stateVersion &&
    Date.parse(expected.startedAt) === Date.parse(actual.startedAt) &&
    (expected.completedAt === null
      ? actual.completedAt === null
      : actual.completedAt !== null &&
        Date.parse(expected.completedAt) === Date.parse(actual.completedAt)) &&
    expected.durationMs === actual.durationMs &&
    canonicalJson(expected.output) === canonicalJson(actual.output) &&
    expected.errorMessage === actual.errorMessage
  );
}

async function persistAgentRun(
  run: AgentRun,
  stage: OrchestrationStageFailedEvent["stage"],
  savedRuns: AgentRun[],
  completedStages: readonly ReactAgentStage[],
  failureCause?: unknown,
): Promise<void> {
  let insertAcknowledged = false;
  try {
    const persisted = await createAgentRun(run);
    insertAcknowledged = true;
    const validation = AgentRunSchema.safeParse(persisted);
    if (!validation.success || !sameAgentRun(run, validation.data)) {
      const cause = validation.success
        ? new Error("Persisted AgentRun does not match the submitted record.")
        : validation.error;
      throw new ReactOrchestrationPersistenceError({
        message: `Persisted ${stage} AgentRun differs from the requested record.`,
        operation: "agent-run",
        stage,
        cause,
        completedWrites: [...savedRuns.map((saved) => saved.id), run.id],
        partialWritePossible: false,
        completedStages,
      });
    }
    savedRuns.push(validation.data);
  } catch (cause) {
    if (cause instanceof ReactOrchestrationPersistenceError) throw cause;
    throw new ReactOrchestrationPersistenceError({
      message: `Could not persist the ${run.status.toLowerCase()} ${stage} AgentRun.`,
      operation: "agent-run",
      stage,
      cause:
        failureCause === undefined
          ? cause
          : new AggregateError(
              [cause, failureCause],
              "AgentRun persistence and agent execution both failed.",
            ),
      completedWrites: [
        ...savedRuns.map((saved) => saved.id),
        ...(insertAcknowledged ? [run.id] : []),
      ],
      partialWritePossible: !insertAcknowledged,
      completedStages,
    });
  }
}

async function persistFailedAgentRun(
  incidentId: string,
  stateVersion: number,
  event: OrchestrationStageFailedEvent,
  savedRuns: AgentRun[],
  completedStages: readonly ReactAgentStage[],
): Promise<void> {
  const candidate = createFailedAgentRun(incidentId, stateVersion, event);
  const run = safeParseAgentRun(
    candidate,
    event.stage,
    savedRuns.map((saved) => saved.id),
    completedStages,
  );
  await persistAgentRun(
    run,
    event.stage,
    savedRuns,
    completedStages,
    event.cause,
  );
}

function createObserver(
  incidentId: string,
  stateVersion: number,
  savedRuns: AgentRun[],
  completedStages: ReactAgentStage[],
): ReactOrchestrationObserver {
  return {
    onStageCompleted: async (event) => {
      if (
        event.stage === "response-planning" &&
        (event.output.plan.incidentId !== incidentId ||
          event.output.plan.stateVersion !== stateVersion)
      ) {
        const issues = [
          `Expected incidentId ${incidentId} and stateVersion ${stateVersion}.`,
          `Received incidentId ${event.output.plan.incidentId} and stateVersion ${event.output.plan.stateVersion}.`,
        ];
        const failure = new ResponsePlanningAgentError(
          "RESPONSE_PLANNING_OUTPUT_INVALID",
          "Response planning output did not preserve incident identity and state version.",
          issues,
        );
        await persistFailedAgentRun(
          incidentId,
          stateVersion,
          { stage: event.stage, cause: failure, timing: event.timing },
          savedRuns,
          completedStages,
        );
        throw new ReactOrchestrationOutputError(
          "Response planning output did not preserve the input incident identity and state version.",
          issues,
          undefined,
          {
            failureCategory: "RESPONSE_PLANNING_FAILED",
            failedStage: "response-planning",
            completedStages,
            completedWrites: savedRuns.map((run) => run.id),
            partialPersistence: savedRuns.length > 0,
            recommendation: "REGENERATE_PLAN",
          },
        );
      }

      completedStages.push(event.stage);
      const candidate = createCompletedAgentRun(
        incidentId,
        stateVersion,
        event,
      );
      const run = safeParseAgentRun(
        candidate,
        event.stage,
        savedRuns.map((saved) => saved.id),
        completedStages,
      );
      await persistAgentRun(run, event.stage, savedRuns, completedStages);
    },
    onStageFailed: async (event) => {
      await persistFailedAgentRun(
        incidentId,
        stateVersion,
        event,
        savedRuns,
        completedStages,
      );
    },
  };
}

function persistenceFailure(
  message: string,
  operation: "agent-run" | "response-plan" | "plan-action" | "verification",
  stage: OrchestrationStageFailedEvent["stage"] | null,
  cause: unknown,
  completedWrites: readonly string[],
  partialWritePossible: boolean,
  completedStages: readonly ReactAgentStage[] = [],
  usablePlanExists = false,
): ReactOrchestrationPersistenceError {
  return new ReactOrchestrationPersistenceError({
    message,
    operation,
    stage,
    cause,
    completedWrites,
    partialWritePossible,
    completedStages,
    usablePlanExists,
  });
}

function outputFailure(
  message: string,
  issues: readonly string[],
  category: "INVALID_STATE" | "RESPONSE_PLANNING_FAILED" | "PLAN_VALIDATION_FAILED",
  completedStages: readonly ReactAgentStage[],
  completedWrites: readonly string[],
  recommendation: "RELOAD_STATE" | "REGENERATE_PLAN",
  usablePlanExists = false,
): ReactOrchestrationOutputError {
  return new ReactOrchestrationOutputError(
    message,
    issues,
    undefined,
    {
      failureCategory: category,
      failedStage: "response-planning",
      completedStages,
      completedWrites,
      partialPersistence: completedWrites.length > 0,
      usablePlanExists,
      recommendation,
    },
  );
}

async function assertAgentRunIdsAvailable(
  incidentId: string,
  stateVersion: number,
): Promise<void> {
  const entries: readonly [AgentType, string][] = [
    ["RISK_ASSESSMENT", stableAgentRunId(incidentId, stateVersion, "RISK_ASSESSMENT")],
    ["RESOURCE_ROUTING", stableAgentRunId(incidentId, stateVersion, "RESOURCE_ROUTING")],
    ["RESPONSE_PLANNING", stableAgentRunId(incidentId, stateVersion, "RESPONSE_PLANNING")],
  ];

  let existingRuns: (AgentRun | null)[];
  try {
    existingRuns = await Promise.all(
      entries.map(([, id]) => getAgentRunById(id)),
    );
  } catch (cause) {
    throw persistenceFailure(
      "Could not check for an existing orchestration AgentRun set.",
      "agent-run",
      null,
      cause,
      [],
      false,
    );
  }

  const existing = existingRuns.flatMap((run, index) =>
    run === null ? [] : [`${entries[index][0]}:${run.id}`],
  );
  if (existing.length > 0) {
    throw persistenceFailure(
      "An AgentRun already exists for this incident and state version; refusing to create duplicate orchestration records.",
      "agent-run",
      null,
      new Error(existing.join(", ")),
      [],
      false,
    );
  }
}

function validateResponsePlanForPersistence(
  state: EmergencyState,
  orchestration: ReactOrchestrationResult,
  completedWrites: readonly string[],
): { plan: ResponsePlan; actions: PlanAction[] } {
  const outputValidation = ReactOrchestrationResultSchema.safeParse(orchestration);
  if (!outputValidation.success) {
    throw outputFailure(
      "Orchestration output failed schema validation before persistence.",
      outputValidation.error.issues.map((issue) => issue.message),
      "RESPONSE_PLANNING_FAILED",
      orchestration.completedStages,
      completedWrites,
      "REGENERATE_PLAN",
    );
  }

  const responsePlanning: ResponsePlanningResult =
    outputValidation.data.responsePlanning;
  const planValidation = ResponsePlanSchema.safeParse(responsePlanning.plan);
  const actionValidation = responsePlanning.actions.map((action) =>
    PlanActionSchema.safeParse(action),
  );
  if (
    !planValidation.success ||
    actionValidation.some((validation) => !validation.success)
  ) {
    throw outputFailure(
      "Response plan or PlanAction failed domain validation before persistence.",
      !planValidation.success
        ? planValidation.error.issues.map((issue) => issue.message)
        : actionValidation.flatMap((validation) =>
            validation.success
              ? []
              : validation.error.issues.map((issue) => issue.message),
          ),
      "RESPONSE_PLANNING_FAILED",
      orchestration.completedStages,
      completedWrites,
      "REGENERATE_PLAN",
    );
  }

  const plan = planValidation.data;
  const actions = actionValidation.map((validation) => {
    if (!validation.success) {
      throw outputFailure(
        "PlanAction failed domain validation before persistence.",
        validation.error.issues.map((issue) => issue.message),
        "RESPONSE_PLANNING_FAILED",
        orchestration.completedStages,
        completedWrites,
        "REGENERATE_PLAN",
      );
    }
    return validation.data;
  });
  if (
    orchestration.incidentId !== state.incident.id ||
    orchestration.stateVersion !== state.stateVersion ||
    plan.incidentId !== state.incident.id ||
    plan.stateVersion !== state.stateVersion
  ) {
    throw outputFailure(
      "Response plan incident ID or state version does not match the input snapshot.",
      [
        `Expected incidentId ${state.incident.id} and stateVersion ${state.stateVersion}.`,
        `Received incidentId ${plan.incidentId} and stateVersion ${plan.stateVersion}.`,
      ],
      "INVALID_STATE",
      orchestration.completedStages,
      completedWrites,
      "RELOAD_STATE",
    );
  }

  const actionsBySequence = [...actions].sort(
    (left, right) => left.sequence - right.sequence,
  );
  const planActionIds = new Set<string>();
  for (const action of actions) {
    if (action.planId !== plan.id || planActionIds.has(action.id)) {
      throw outputFailure(
        "PlanAction has a conflicting plan ID or duplicate action ID.",
        [`Invalid PlanAction reference ${action.id}.`],
        "PLAN_VALIDATION_FAILED",
        orchestration.completedStages,
        completedWrites,
        "REGENERATE_PLAN",
      );
    }
    planActionIds.add(action.id);
    if (!Number.isInteger(action.estimatedDurationMinutes)) {
      throw outputFailure(
        "PlanAction estimated duration must be an integer supported by the database schema.",
        [`Invalid estimated duration for PlanAction ${action.id}.`],
        "PLAN_VALIDATION_FAILED",
        orchestration.completedStages,
        completedWrites,
        "REGENERATE_PLAN",
      );
    }
  }

  if (
    actionsBySequence.some(
      (action, index) =>
        index > 0 && action.sequence === actionsBySequence[index - 1].sequence,
    ) ||
    plan.actions.length !== actions.length ||
    plan.actions.some(
      (reference, index) =>
        reference.actionId !== actionsBySequence[index]?.id ||
        reference.sequence !== actionsBySequence[index]?.sequence,
    )
  ) {
    throw outputFailure(
      "ResponsePlan action references do not exactly match the ordered PlanAction records.",
      ["ResponsePlan action references and PlanAction sequence do not match."],
      "PLAN_VALIDATION_FAILED",
      orchestration.completedStages,
      completedWrites,
      "REGENERATE_PLAN",
    );
  }

  if (!responsePlanning.validation.valid) {
    throw outputFailure(
      "Response plan failed its deterministic PlanValidator check.",
      responsePlanning.validation.errors.map(
        (issue) => `${issue.code}: ${issue.message}`,
      ),
      "PLAN_VALIDATION_FAILED",
      orchestration.completedStages,
      completedWrites,
      "REGENERATE_PLAN",
    );
  }

  const validation = validatePlan(plan, {
    ...state,
    planActions: [...state.planActions, ...actions],
  });
  if (!validation.valid) {
    throw outputFailure(
      "Response plan failed deterministic PlanValidator checks against the input snapshot.",
      validation.errors.map((issue) => `${issue.code}: ${issue.message}`),
      "PLAN_VALIDATION_FAILED",
      orchestration.completedStages,
      completedWrites,
      "REGENERATE_PLAN",
    );
  }

  return { plan, actions: actionsBySequence };
}

function sameResponsePlan(expected: ResponsePlan, actual: ResponsePlan): boolean {
  return (
    expected.id === actual.id &&
    expected.incidentId === actual.incidentId &&
    expected.stateVersion === actual.stateVersion &&
    expected.status === actual.status &&
    expected.priority === actual.priority &&
    expected.summary === actual.summary &&
    expected.rationale === actual.rationale &&
    Date.parse(expected.generatedAt) === Date.parse(actual.generatedAt) &&
    Date.parse(expected.updatedAt) === Date.parse(actual.updatedAt) &&
    JSON.stringify(expected.actions) === JSON.stringify(actual.actions) &&
    JSON.stringify(expected.alternatives) === JSON.stringify(actual.alternatives) &&
    JSON.stringify(expected.dependencies) === JSON.stringify(actual.dependencies)
  );
}

function samePlanAction(expected: PlanAction, actual: PlanAction): boolean {
  return (
    expected.id === actual.id &&
    expected.planId === actual.planId &&
    expected.sequence === actual.sequence &&
    expected.type === actual.type &&
    expected.status === actual.status &&
    expected.description === actual.description &&
    expected.priority === actual.priority &&
    JSON.stringify(expected.resourceIds) === JSON.stringify(actual.resourceIds) &&
    JSON.stringify(expected.facilityIds) === JSON.stringify(actual.facilityIds) &&
    JSON.stringify(expected.routeIds) === JSON.stringify(actual.routeIds) &&
    (expected.capacityDemand ?? null) === (actual.capacityDemand ?? null) &&
    JSON.stringify(expected.targetLocation) === JSON.stringify(actual.targetLocation) &&
    expected.estimatedDurationMinutes === actual.estimatedDurationMinutes &&
    Date.parse(expected.createdAt) === Date.parse(actual.createdAt) &&
    Date.parse(expected.updatedAt) === Date.parse(actual.updatedAt)
  );
}

export async function runAndPersistReactOrchestration(
  emergencyState: EmergencyState,
): Promise<PersistedReactOrchestrationResult> {
  const stateValidation = EmergencyStateSchema.safeParse(emergencyState);
  if (!stateValidation.success) {
    const issues = stateValidation.error.issues.map((issue) => {
      const path = issue.path.map(String).join(".") || "state";
      return `${path}: ${issue.message}`;
    });
    throw new ReactOrchestrationInputError(
      "Persistent REACT orchestration requires a valid EmergencyState.",
      issues,
      stateValidation.error,
    );
  }

  const state = stateValidation.data;
  await assertAgentRunIdsAvailable(state.incident.id, state.stateVersion);

  const savedRuns: AgentRun[] = [];
  const completedStages: ReactAgentStage[] = [];
  let orchestration: ReactOrchestrationResult;
  try {
    orchestration = await runReactOrchestration(
      state,
      createObserver(
        state.incident.id,
        state.stateVersion,
        savedRuns,
        completedStages,
      ),
    );
  } catch (cause) {
    if (cause instanceof ReactOrchestrationStageError) {
      if (cause.failure.failedStage === null) throw cause;
      throw new ReactOrchestrationStageError(
        cause.failure.failedStage,
        cause.cause,
        cause.failure.completedStages,
        savedRuns.map((run) => run.id),
      );
    }
    if (cause instanceof ReactOrchestrationError) {
      throw cause;
    }
    throw persistenceFailure(
      "Persistent REACT orchestration failed.",
      "agent-run",
      null,
      cause,
      savedRuns.map((run) => run.id),
      false,
      completedStages,
    );
  }

  const validated = validateResponsePlanForPersistence(
    state,
    orchestration,
    savedRuns.map((run) => run.id),
  );
  let persistedStateVersion: number | null;
  try {
    persistedStateVersion = await getEmergencyStateVersion(state.incident.id);
  } catch (cause) {
    throw persistenceFailure(
      "Could not verify the current persisted EmergencyState version.",
      "verification",
      "response-planning",
      cause,
      savedRuns.map((run) => run.id),
      false,
      completedStages,
    );
  }
  if (persistedStateVersion !== state.stateVersion) {
    throw outputFailure(
      "EmergencyState changed during orchestration; refusing to persist a stale response plan.",
      [
        `Expected persisted state version ${state.stateVersion}.`,
        `Received persisted state version ${String(persistedStateVersion)}.`,
      ],
      "INVALID_STATE",
      completedStages,
      savedRuns.map((run) => run.id),
      "RELOAD_STATE",
    );
  }

  let existingPlan: Awaited<ReturnType<typeof getResponsePlanById>>;
  try {
    existingPlan = await getResponsePlanById(validated.plan.id);
  } catch (cause) {
    throw persistenceFailure(
      "Could not check whether the response plan was already persisted.",
      "response-plan",
      "response-planning",
      cause,
      savedRuns.map((run) => run.id),
      false,
      completedStages,
      true,
    );
  }
  if (existingPlan !== null) {
    throw persistenceFailure(
      "ResponsePlan ID already exists; refusing to create a duplicate plan.",
      "response-plan",
      "response-planning",
      new Error(`ResponsePlan ${validated.plan.id} already exists.`),
      savedRuns.map((run) => run.id),
      false,
      completedStages,
      true,
    );
  }

  const completedWrites = savedRuns.map((run) => run.id);
  const createPlanInput: CreateResponsePlanInput = {
    id: validated.plan.id,
    incidentId: validated.plan.incidentId,
    stateVersion: validated.plan.stateVersion,
    status: validated.plan.status,
    priority: validated.plan.priority,
    summary: validated.plan.summary,
    rationale: validated.plan.rationale,
    generatedAt: validated.plan.generatedAt,
    updatedAt: validated.plan.updatedAt,
    alternatives: validated.plan.alternatives,
    dependencies: validated.plan.dependencies,
  };
  try {
    await createResponsePlan(createPlanInput);
  } catch (cause) {
    throw persistenceFailure(
      "Could not fully persist the ResponsePlan and its alternatives/dependencies.",
      "response-plan",
      "response-planning",
      cause,
      completedWrites,
      true,
      completedStages,
      true,
    );
  }
  completedWrites.push(`response-plan:${validated.plan.id}`);

  const persistedActions: PlanAction[] = [];
  for (const action of validated.actions) {
    try {
      persistedActions.push(await createPlanAction(action));
    } catch (cause) {
      throw persistenceFailure(
        `Could not persist PlanAction ${action.id}; the response plan may be only partially persisted.`,
        "plan-action",
        "response-planning",
        cause,
        [...completedWrites, ...persistedActions.map((saved) => saved.id)],
        true,
        completedStages,
        true,
      );
    }
  }
  completedWrites.push(...persistedActions.map((action) => action.id));

  let persistedPlan: ResponsePlan | null;
  let persistedActionRecords: PlanAction[];
  try {
    [persistedPlan, persistedActionRecords] = await Promise.all([
      getCompleteResponsePlanById(validated.plan.id),
      listPlanActionsForPlan(validated.plan.id),
    ]);
  } catch (cause) {
    throw persistenceFailure(
      "Persisted response plan could not be verified after the writes completed.",
      "verification",
      "response-planning",
      cause,
      completedWrites,
      true,
      completedStages,
      true,
    );
  }
  if (
    persistedPlan === null ||
    !sameResponsePlan(validated.plan, persistedPlan) ||
    persistedActionRecords.length !== validated.actions.length ||
    persistedActionRecords.some((action, index) => {
      const expected = validated.actions[index];
      return expected === undefined || !samePlanAction(expected, action);
    })
  ) {
    throw persistenceFailure(
      "Persisted ResponsePlan or PlanAction records differ from the validated orchestration output.",
      "verification",
      "response-planning",
      new Error("Persisted plan/action verification mismatch."),
      completedWrites,
      false,
      completedStages,
      true,
    );
  }

  return {
    orchestration,
    agentRuns: savedRuns,
    responsePlan: persistedPlan,
    planActions: persistedActionRecords,
  };
}
