import type { AgentRun } from "../../domain/agent-run/schema";
import type { EmergencyState } from "../../domain/emergency-state/schema";
import type { HumanDecision } from "../../domain/human-decision/schema";
import type { PlanAction } from "../../domain/plan-action/schema";
import type { ResponsePlan } from "../../domain/response-plan/schema";
import type { StateChange } from "../../domain/state-change/schema";
import { validateEmergencyStateConsistency } from "./consistency";
import { EmergencyStateLoadError } from "./loader";

export type EmergencyStateProviderContext = {
  readonly state: EmergencyState;
  readonly stateChanges: readonly StateChange[];
  readonly agentRuns: readonly AgentRun[];
  readonly humanDecisions: readonly HumanDecision[];
};

export type EmergencyStateProviderErrorCode =
  | "DATABASE_UNAVAILABLE"
  | "DATABASE_ERROR"
  | "PLAN_NOT_FOUND"
  | "INCIDENT_NOT_FOUND"
  | "STATE_NOT_FOUND"
  | "STATE_INVALID"
  | "STATE_VERSION_CONFLICT"
  | "PLAN_TRANSITION_CONFLICT"
  | "PERSISTENCE_FAILED";

export class EmergencyStateProviderError extends Error {
  constructor(
    readonly code: EmergencyStateProviderErrorCode,
    message: string,
    readonly stage: string,
    readonly partialWrites: readonly string[] = [],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "EmergencyStateProviderError";
  }
}

export type EmergencyStateProviderDependencies = {
  readonly getPlan: (planId: string) => Promise<ResponsePlan | null>;
  readonly loadState: (incidentId: string) => Promise<EmergencyState>;
  readonly listPlanActions: (planId: string) => Promise<PlanAction[]>;
  readonly listStateChanges: (incidentId: string) => Promise<StateChange[]>;
  readonly listAgentRuns: (incidentId: string) => Promise<AgentRun[]>;
  readonly listPlans: (incidentId: string) => Promise<readonly { id: string }[]>;
  readonly listHumanDecisions: (planId: string) => Promise<HumanDecision[]>;
  readonly updatePlan: (
    expectedStatus: ResponsePlan["status"],
    plan: ResponsePlan,
  ) => Promise<ResponsePlan | null>;
  readonly createPlan: (plan: ResponsePlan) => Promise<void>;
  readonly createPlanAction: (action: PlanAction) => Promise<void>;
  readonly createDecision: (decision: HumanDecision) => Promise<void>;
  readonly createStateChange: (change: StateChange) => Promise<void>;
};

export interface EmergencyStateProvider {
  getPlan(planId: string): Promise<ResponsePlan | null>;
  getStateForPlan(
    plan: ResponsePlan,
  ): Promise<EmergencyStateProviderContext | null>;
  persistPlan(plan: ResponsePlan): Promise<void>;
  persistDecision(
    previousPlan: ResponsePlan,
    plan: ResponsePlan,
    decision: HumanDecision,
  ): Promise<void>;
  persistModifiedPlan(
    previousPlan: ResponsePlan,
    revisedPlan: ResponsePlan,
    decision: HumanDecision,
    actions: readonly PlanAction[],
  ): Promise<void>;
}

function toProviderError(
  error: unknown,
  stage: string,
  usesDefaultSupabase: boolean,
): EmergencyStateProviderError {
  if (error instanceof EmergencyStateProviderError) return error;
  if (error instanceof EmergencyStateLoadError) {
    const code =
      error.code === "INCIDENT_NOT_FOUND"
        ? "INCIDENT_NOT_FOUND"
        : error.code === "STATE_NOT_FOUND"
          ? "STATE_NOT_FOUND"
          : error.code === "STATE_VERSION_CONFLICT"
            ? "STATE_VERSION_CONFLICT"
            : error.code === "INVALID_PERSISTED_STATE"
              ? "STATE_INVALID"
              : error.code === "DATABASE_UNAVAILABLE"
                ? "DATABASE_UNAVAILABLE"
                : "DATABASE_ERROR";
    return new EmergencyStateProviderError(code, error.message, stage, [], { cause: error });
  }
  if (
    (usesDefaultSupabase &&
      (!process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
        !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim())) ||
    (error instanceof TypeError && /fetch|network/i.test(error.message))
  ) {
    return new EmergencyStateProviderError(
      "DATABASE_UNAVAILABLE",
      "Supabase configuration is unavailable.",
      stage,
      [],
      { cause: error },
    );
  }
  return new EmergencyStateProviderError(
    "DATABASE_ERROR",
    "Supabase operation failed.",
    stage,
    [],
    { cause: error },
  );
}

function planChange(
  plan: ResponsePlan,
  previousStatus: ResponsePlan["status"],
  occurredAt: string,
  suffix: string,
): StateChange {
  return {
    id: `${plan.id}:${suffix}`,
    entityType: "PLAN",
    entityId: plan.id,
    changeType: "STATUS_CHANGED",
    description: `Response plan ${plan.id} status changed to ${plan.status}.`,
    previousValue: previousStatus,
    newValue: plan.status,
    occurredAt,
    detectedAt: occurredAt,
  };
}

async function defaultDependencies(): Promise<EmergencyStateProviderDependencies> {
  const [
    loader,
    services,
    plans,
    actions,
    decisions,
    changes,
  ] = await Promise.all([
    import("./loader"),
    import("../supabase/services"),
    import("../supabase/services/response-plans"),
    import("../supabase/services/plan-actions"),
    import("../supabase/services/human-decisions"),
    import("../supabase/services/state-changes"),
  ]);
  return {
    getPlan: (id) => plans.getCompleteResponsePlanById(id),
    loadState: (id) => loader.loadEmergencyState(id),
    listPlanActions: actions.listPlanActionsForPlan,
    listStateChanges: changes.listStateChangesForIncident,
    listAgentRuns: services.listAgentRunsForIncident,
    listPlans: services.listResponsePlansForIncident,
    listHumanDecisions: decisions.listHumanDecisionsForPlan,
    updatePlan: async (expectedStatus, plan) =>
      plans.transitionResponsePlan(plan.id, expectedStatus, {
        status: plan.status,
        updatedAt: plan.updatedAt,
      }).then((record) => record === null ? null : plan),
    createPlan: async (plan) => {
      await plans.createResponsePlan({
        id: plan.id,
        incidentId: plan.incidentId,
        stateVersion: plan.stateVersion,
        status: plan.status,
        priority: plan.priority,
        summary: plan.summary,
        rationale: plan.rationale,
        generatedAt: plan.generatedAt,
        updatedAt: plan.updatedAt,
        alternatives: plan.alternatives,
        dependencies: plan.dependencies,
      });
    },
    createPlanAction: async (action) => {
      await actions.createPlanAction(action);
    },
    createDecision: async (decision) => {
      await decisions.createHumanDecision(decision);
    },
    createStateChange: async (change) => {
      await changes.createStateChange(change);
    },
  };
}

export function createSupabaseEmergencyStateProvider(
  dependencies?: EmergencyStateProviderDependencies,
): EmergencyStateProvider {
  let dependencyPromise: Promise<EmergencyStateProviderDependencies> | null = null;
  const getDependencies = async () => {
    if (dependencies !== undefined) return dependencies;
    dependencyPromise ??= defaultDependencies();
    return dependencyPromise;
  };

  return {
    async getPlan(planId) {
      try {
        return await (await getDependencies()).getPlan(planId);
      } catch (error) {
        throw toProviderError(error, "load-plan", dependencies === undefined);
      }
    },

    async getStateForPlan(plan) {
      try {
        const deps = await getDependencies();
        const [state, actions, stateChanges, agentRuns, plans] = await Promise.all([
          deps.loadState(plan.incidentId),
          deps.listPlanActions(plan.id),
          deps.listStateChanges(plan.incidentId),
          deps.listAgentRuns(plan.incidentId),
          deps.listPlans(plan.incidentId),
        ]);
        if (state.incident.id !== plan.incidentId) {
          throw new EmergencyStateProviderError(
            "STATE_INVALID",
            "Loaded emergency state belongs to another incident.",
            "load-state",
          );
        }
        if (actions.length !== plan.actions.length || plan.actions.some((reference) => {
          const action = actions.find((candidate) => candidate.id === reference.actionId);
          return action === undefined || action.planId !== plan.id || action.sequence !== reference.sequence;
        })) {
          throw new EmergencyStateProviderError(
            "STATE_INVALID",
            "Response plan action references do not match persisted PlanAction records.",
            "load-plan-actions",
          );
        }
        const stateWithPlanActions: EmergencyState = {
          ...state,
          planActions: [
            ...state.planActions.filter((action) => action.planId !== plan.id),
            ...actions,
          ],
          activePlan: state.activePlan?.id === plan.id ? plan : state.activePlan,
        };
        const consistency = validateEmergencyStateConsistency(stateWithPlanActions);
        if (!consistency.valid) {
          throw new EmergencyStateProviderError(
            "STATE_INVALID",
            "Persisted emergency state failed domain consistency validation.",
            "validate-state",
          );
        }
        const humanDecisions = (
          await Promise.all(plans.map(({ id }) => deps.listHumanDecisions(id)))
        ).flat();
        return { state: stateWithPlanActions, stateChanges, agentRuns, humanDecisions };
      } catch (error) {
        throw toProviderError(error, "load-state", dependencies === undefined);
      }
    },

    async persistPlan(plan) {
      if (plan.status !== "PENDING_APPROVAL") {
        throw new EmergencyStateProviderError(
          "STATE_INVALID",
          "Only a domain-submitted PENDING_APPROVAL plan can be persisted.",
          "persist-plan",
        );
      }
      const writes: string[] = [];
      try {
        const deps = await getDependencies();
        const saved = await deps.updatePlan("DRAFT", plan);
        if (saved === null) {
          throw new EmergencyStateProviderError(
            "PLAN_TRANSITION_CONFLICT",
            "Response plan is no longer in DRAFT status.",
            "update-plan",
          );
        }
        writes.push(`response-plan:${plan.id}`);
        await deps.createStateChange(
          planChange(plan, "DRAFT", plan.updatedAt, "submitted"),
        );
      } catch (error) {
        const providerError = toProviderError(
          error,
          "persist-plan",
          dependencies === undefined,
        );
        throw new EmergencyStateProviderError(
          providerError.code,
          providerError.message,
          providerError.stage,
          writes,
          { cause: providerError },
        );
      }
    },

    async persistDecision(previousPlan, plan, decision) {
      if (
        previousPlan.status !== "PENDING_APPROVAL" ||
        previousPlan.id !== plan.id ||
        previousPlan.id !== decision.planId ||
        previousPlan.incidentId !== decision.incidentId ||
        decision.status !== "RECORDED" ||
        (decision.decision === "APPROVE" && plan.status !== "APPROVED") ||
        (decision.decision === "REJECT" && plan.status !== "REJECTED")
      ) {
        throw new EmergencyStateProviderError(
          "STATE_INVALID",
          "Plan and human-decision records do not match the domain transition.",
          "persist-decision",
        );
      }
      const writes: string[] = [];
      try {
        const deps = await getDependencies();
        const saved = await deps.updatePlan(previousPlan.status, plan);
        if (saved === null) {
          throw new EmergencyStateProviderError(
            "PLAN_TRANSITION_CONFLICT",
            "Response plan status changed before the decision could be persisted.",
            "update-plan",
          );
        }
        writes.push(`response-plan:${plan.id}`);
        await deps.createDecision(decision);
        writes.push(`human-decision:${decision.id}`);
        await deps.createStateChange(
          planChange(plan, previousPlan.status, decision.recordedAt, `decision:${decision.id}`),
        );
      } catch (error) {
        const providerError = toProviderError(
          error,
          "persist-decision",
          dependencies === undefined,
        );
        throw new EmergencyStateProviderError(
          providerError.code,
          providerError.message,
          providerError.stage,
          writes,
          { cause: providerError },
        );
      }
    },

    async persistModifiedPlan(previousPlan, revisedPlan, decision, actions) {
      if (
        previousPlan.status !== "PENDING_APPROVAL" ||
        revisedPlan.status !== "PENDING_APPROVAL" ||
        decision.decision !== "MODIFY" ||
        decision.planId !== previousPlan.id ||
        decision.modifiedPlanId !== revisedPlan.id ||
        decision.incidentId !== revisedPlan.incidentId ||
        actions.length !== revisedPlan.actions.length ||
        revisedPlan.actions.some((reference) =>
          !actions.some(
            (action) =>
              action.id === reference.actionId &&
              action.planId === revisedPlan.id &&
              action.sequence === reference.sequence,
          ),
        )
      ) {
        throw new EmergencyStateProviderError(
          "STATE_INVALID",
          "Modified plan, actions, and human decision do not match the validated transition.",
          "persist-modified-plan",
        );
      }
      const writes: string[] = [];
      try {
        const deps = await getDependencies();
        await deps.createPlan(revisedPlan);
        writes.push(`response-plan:${revisedPlan.id}`);
        for (const action of actions) {
          await deps.createPlanAction(action);
          writes.push(`plan-action:${action.id}`);
        }
        const superseded = { ...previousPlan, status: "SUPERSEDED" as const, updatedAt: decision.recordedAt };
        const savedPreviousPlan = await deps.updatePlan(
          previousPlan.status,
          superseded,
        );
        if (savedPreviousPlan === null) {
          throw new EmergencyStateProviderError(
            "PLAN_TRANSITION_CONFLICT",
            "Previous response plan status changed before modification could be persisted.",
            "supersede-plan",
          );
        }
        writes.push(`response-plan:${previousPlan.id}`);
        await deps.createDecision(decision);
        writes.push(`human-decision:${decision.id}`);
        await deps.createStateChange(
          planChange(revisedPlan, "MODIFIED", decision.recordedAt, `modified:${decision.id}`),
        );
        await deps.createStateChange(
          planChange(superseded, "PENDING_APPROVAL", decision.recordedAt, `superseded:${decision.id}`),
        );
      } catch (error) {
        const providerError = toProviderError(
          error,
          "persist-modified-plan",
          dependencies === undefined,
        );
        throw new EmergencyStateProviderError(
          providerError.code,
          providerError.message,
          providerError.stage,
          writes,
          { cause: providerError },
        );
      }
    },
  };
}
