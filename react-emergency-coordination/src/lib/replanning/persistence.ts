import type { ResponsePlan } from "../../domain/response-plan/schema";
import type { StateChange } from "../../domain/state-change/schema";
import type { EmergencyState } from "../../domain/emergency-state/schema";
import {
  replanEmergencyResponse,
  type ReplanningOptions,
} from "./replanner";
import type { ReplanningResult } from "./schema";

export type ReplanningPersistenceDependencies = {
  readonly getStateVersion: (incidentId: string) => Promise<number | null>;
  readonly getPlan: (planId: string) => Promise<ResponsePlan | null>;
  readonly createPlan: (plan: ResponsePlan) => Promise<void>;
  readonly createPlanAction: (action: NonNullable<ReplanningResult["revisedPlanActions"]>[number]) => Promise<void>;
  readonly updatePlan: (
    planId: string,
    expectedStatus: ResponsePlan["status"],
    status: ResponsePlan["status"],
    updatedAt: string,
  ) => Promise<ResponsePlan | null>;
  readonly createStateChange: (change: StateChange) => Promise<unknown>;
};

export class ReplanningPersistenceError extends Error {
  constructor(
    readonly code:
      | "REPLANNING_NOT_PERSISTABLE"
      | "STATE_VERSION_CONFLICT"
      | "DATABASE_UNAVAILABLE"
      | "DATABASE_ERROR"
      | "PERSISTENCE_FAILED",
    message: string,
    readonly completedWrites: readonly string[] = [],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ReplanningPersistenceError";
  }
}

function databaseUnavailable(error: unknown): boolean {
  return (
    !process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    (error instanceof TypeError && /fetch|network/i.test(error.message))
  );
}

function planChange(
  planId: string,
  previousStatus: ResponsePlan["status"] | null,
  nextStatus: ResponsePlan["status"],
  timestamp: string,
  suffix: string,
): StateChange {
  return {
    id: `${planId}:replanning:${suffix}`,
    entityType: "PLAN",
    entityId: planId,
    changeType: previousStatus === null ? "CREATED" : "STATUS_CHANGED",
    description:
      previousStatus === null
        ? `Revised response plan ${planId} generated.`
        : `Response plan ${planId} superseded by replanning.`,
    previousValue: previousStatus,
    newValue: nextStatus,
    occurredAt: timestamp,
    detectedAt: timestamp,
  };
}

async function defaultDependencies(): Promise<ReplanningPersistenceDependencies> {
  const [versions, plans, actions, changes] = await Promise.all([
    import("../supabase/services/emergency-states"),
    import("../supabase/services/response-plans"),
    import("../supabase/services/plan-actions"),
    import("../supabase/services/state-changes"),
  ]);
  return {
    getStateVersion: versions.getEmergencyStateVersion,
    getPlan: plans.getCompleteResponsePlanById,
    createPlan: async (plan) => {
      await plans.createResponsePlan({
        id: plan.id,
        incidentId: plan.incidentId,
        stateVersion: plan.stateVersion,
        status: plan.status,
        priority: plan.priority,
        summary: plan.summary,
        rationale: plan.rationale,
        source: plan.source,
        generatedAt: plan.generatedAt,
        updatedAt: plan.updatedAt,
        alternatives: plan.alternatives,
        dependencies: plan.dependencies,
      });
    },
    createPlanAction: async (action) => {
      await actions.createPlanAction(action);
    },
    updatePlan: async (planId, expectedStatus, status, updatedAt) => {
      const record = await plans.transitionResponsePlan(
        planId,
        expectedStatus,
        { status, updatedAt },
      );
      return record === null ? null : await plans.getCompleteResponsePlanById(planId);
    },
    createStateChange: changes.createStateChange,
  };
}

export async function persistReplanningResult(
  result: ReplanningResult,
  injectedDependencies?: ReplanningPersistenceDependencies,
): Promise<ReplanningResult> {
  const revisedPlan = result.revisedPlan;
  const actions = result.revisedPlanActions;
  if (
    !result.success ||
    result.status !== "PENDING_HUMAN_APPROVAL" ||
    revisedPlan === null ||
    actions === null ||
    actions === undefined
  ) {
    throw new ReplanningPersistenceError(
      "REPLANNING_NOT_PERSISTABLE",
      "Only a validated revised plan awaiting human approval can be persisted.",
    );
  }
  if (
    revisedPlan.incidentId !== result.incidentId ||
    revisedPlan.stateVersion !== result.currentStateVersion ||
    revisedPlan.id === result.previousPlanId ||
    actions.length !== revisedPlan.actions.length ||
    actions.some((action, index) => {
      const reference = revisedPlan.actions[index];
      return (
        reference === undefined ||
        action.planId !== revisedPlan.id ||
        action.id !== reference.actionId ||
        action.sequence !== reference.sequence
      );
    })
  ) {
    throw new ReplanningPersistenceError(
      "REPLANNING_NOT_PERSISTABLE",
      "Revised plan and action records do not match the validated replanning result.",
    );
  }

  let deps: ReplanningPersistenceDependencies;
  let currentVersion: number | null;
  let previousPlan: ResponsePlan | null;
  try {
    deps = injectedDependencies ?? await defaultDependencies();
    currentVersion = await deps.getStateVersion(result.incidentId);
    previousPlan = await deps.getPlan(result.previousPlanId);
  } catch (cause) {
    if (cause instanceof ReplanningPersistenceError) throw cause;
    throw new ReplanningPersistenceError(
      databaseUnavailable(cause) ? "DATABASE_UNAVAILABLE" : "DATABASE_ERROR",
      databaseUnavailable(cause)
        ? "Supabase is unavailable while loading replanning persistence state."
        : "Supabase failed to load replanning persistence state.",
      [],
      { cause },
    );
  }
  if (currentVersion !== result.currentStateVersion) {
    throw new ReplanningPersistenceError(
      "STATE_VERSION_CONFLICT",
      "Emergency state changed before the revised plan could be persisted.",
    );
  }
  if (
    previousPlan === null ||
    previousPlan.incidentId !== result.incidentId ||
    previousPlan.stateVersion !== result.previousPlanStateVersion
  ) {
    throw new ReplanningPersistenceError(
      "STATE_VERSION_CONFLICT",
      "The previous response plan no longer matches the replanning result.",
    );
  }

  const completedWrites: string[] = [];
  try {
    await deps.createPlan(revisedPlan);
    completedWrites.push(`response-plan:${revisedPlan.id}`);
    for (const action of actions) {
      await deps.createPlanAction(action);
      completedWrites.push(`plan-action:${action.id}`);
    }
    const verifiedVersion = await deps.getStateVersion(result.incidentId);
    if (verifiedVersion !== result.currentStateVersion) {
      throw new ReplanningPersistenceError(
        "STATE_VERSION_CONFLICT",
        "Emergency state changed while the revised plan was being persisted.",
        completedWrites,
      );
    }
    const superseded = await deps.updatePlan(
      previousPlan.id,
      previousPlan.status,
      "SUPERSEDED",
      revisedPlan.updatedAt,
    );
    if (superseded === null) {
      throw new Error(`Previous ResponsePlan ${previousPlan.id} was not found.`);
    }
    completedWrites.push(`response-plan:${previousPlan.id}`);
    await deps.createStateChange(
      planChange(
        revisedPlan.id,
        null,
        "PENDING_APPROVAL",
        revisedPlan.updatedAt,
        "created",
      ),
    );
    await deps.createStateChange(
      planChange(
        previousPlan.id,
        previousPlan.status,
        "SUPERSEDED",
        revisedPlan.updatedAt,
        "superseded",
      ),
    );
  } catch (cause) {
    throw new ReplanningPersistenceError(
      databaseUnavailable(cause) ? "DATABASE_UNAVAILABLE" : "PERSISTENCE_FAILED",
      databaseUnavailable(cause)
        ? "Supabase is unavailable; some revised-plan writes may already be committed."
        : "Revised plan persistence failed; some writes may already be committed.",
      completedWrites,
      { cause },
    );
  }

  return { ...result, previousPlanSupersessionPersisted: true };
}

export async function replanAndPersistEmergencyResponse(
  previousState: EmergencyState,
  currentState: EmergencyState,
  options: ReplanningOptions = {},
  injectedDependencies?: ReplanningPersistenceDependencies,
): Promise<ReplanningResult> {
  const result = await replanEmergencyResponse(
    previousState,
    currentState,
    options,
  );
  if (result.status !== "PENDING_HUMAN_APPROVAL") return result;
  return persistReplanningResult(result, injectedDependencies);
}
