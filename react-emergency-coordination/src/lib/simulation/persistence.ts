import type { EmergencyState } from "../../domain/emergency-state/schema";
import type { ResponsePlan } from "../../domain/response-plan/schema";
import type { SimulationResult } from "./schema";
import type { Resource } from "../../domain/resource/schema";
import type { Facility } from "../../domain/facility/schema";
import type { Route } from "../../domain/route/schema";
import type { PlanAction } from "../../domain/plan-action/schema";
import type { StateChange } from "../../domain/state-change/schema";
import { executeApprovedPlan } from "./engine";
import { EmergencyStateLoadError } from "../emergency-state/loader";

export type SimulationPersistenceDependencies = {
  readonly getStateVersion: (incidentId: string) => Promise<number | null>;
  readonly updateResource: (
    id: string,
    updates: Partial<Pick<Resource, "status" | "currentAssignmentId" | "updatedAt">>,
  ) => Promise<Resource | null>;
  readonly updateFacility: (
    id: string,
    updates: Partial<Pick<Facility, "status" | "availableCapacity" | "updatedAt">>,
  ) => Promise<Facility | null>;
  readonly updateRoute: (
    id: string,
    updates: Partial<Pick<Route, "status" | "blockedReason" | "updatedAt">>,
  ) => Promise<Route | null>;
  readonly updatePlanAction: (
    id: string,
    updates: Partial<Pick<PlanAction, "status" | "updatedAt">>,
  ) => Promise<PlanAction | null>;
  readonly updatePlan: (
    expectedStatus: ResponsePlan["status"],
    plan: ResponsePlan,
  ) => Promise<ResponsePlan | null>;
  readonly createStateChange: (change: StateChange) => Promise<unknown>;
  readonly incrementStateVersion: (incidentId: string) => Promise<number>;
};

export type SimulationPersistenceErrorCode =
  | "PLAN_NOT_FOUND"
  | "INCIDENT_NOT_FOUND"
  | "STATE_NOT_FOUND"
  | "STATE_INVALID"
  | "STATE_VERSION_CONFLICT"
  | "PLAN_TRANSITION_CONFLICT"
  | "SIMULATION_FAILED"
  | "DATABASE_UNAVAILABLE"
  | "DATABASE_ERROR"
  | "PERSISTENCE_FAILED";

export class SimulationPersistenceError extends Error {
  constructor(
    readonly code: SimulationPersistenceErrorCode,
    message: string,
    readonly completedWrites: readonly string[] = [],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SimulationPersistenceError";
  }
}

function databaseUnavailable(error: unknown): boolean {
  return (
    !process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    (error instanceof TypeError && /fetch|network/i.test(error.message))
  );
}

function mapLoadError(error: unknown): SimulationPersistenceError {
  if (error instanceof SimulationPersistenceError) return error;
  if (error instanceof EmergencyStateLoadError) {
    if (error.code === "STATE_VERSION_CONFLICT") {
      return new SimulationPersistenceError("STATE_VERSION_CONFLICT", error.message, [], { cause: error });
    }
    if (error.code === "INCIDENT_NOT_FOUND") {
      return new SimulationPersistenceError("INCIDENT_NOT_FOUND", error.message, [], { cause: error });
    }
    if (error.code === "STATE_NOT_FOUND") {
      return new SimulationPersistenceError("STATE_NOT_FOUND", error.message, [], { cause: error });
    }
    if (error.code === "INVALID_PERSISTED_STATE") {
      return new SimulationPersistenceError("STATE_INVALID", error.message, [], { cause: error });
    }
  }
  return new SimulationPersistenceError(
    databaseUnavailable(error) ? "DATABASE_UNAVAILABLE" : "DATABASE_ERROR",
    databaseUnavailable(error)
      ? "Supabase is unavailable or not configured."
      : "Supabase operation failed.",
    [],
    { cause: error },
  );
}

function changed<T extends { id: string }, K extends keyof T>(
  previous: readonly T[],
  next: readonly T[],
  keys: readonly K[],
): { before: T; after: T }[] {
  const beforeById = new Map(
    previous.map((entity) => [entity.id, entity]),
  );
  const result: { before: T; after: T }[] = [];
  for (const after of next) {
    const before = beforeById.get(after.id);
    if (
      before !== undefined &&
      before !== null &&
      keys.some((key) => before[key] !== after[key])
    ) {
      result.push({ before, after });
    }
  }
  return result;
}

export async function persistSimulationResult(
  previousState: EmergencyState,
  result: SimulationResult,
  dependencies: SimulationPersistenceDependencies,
): Promise<EmergencyState> {
  if (!result.success) {
    throw new SimulationPersistenceError(
      "SIMULATION_FAILED",
      `Plan simulation failed (${result.error.code}): ${result.error.message}`,
    );
  }
  if (
    result.state.incident.id !== previousState.incident.id ||
    result.state.stateVersion !== previousState.stateVersion + 1
  ) {
    throw new SimulationPersistenceError(
      "STATE_VERSION_CONFLICT",
      "Simulation output does not advance exactly one version of the source state.",
    );
  }
  const initialVersion = await dependencies.getStateVersion(previousState.incident.id);
  if (initialVersion !== previousState.stateVersion) {
    throw new SimulationPersistenceError(
      "STATE_VERSION_CONFLICT",
      "Emergency state changed before simulation persistence.",
    );
  }

  const completedWrites: string[] = [];
  try {
    for (const { after } of changed(
      previousState.resources,
      result.state.resources,
      ["status", "currentAssignmentId"],
    )) {
      const updated = await dependencies.updateResource(after.id, {
        status: after.status,
        currentAssignmentId: after.currentAssignmentId,
        updatedAt: after.updatedAt,
      });
      if (updated === null) throw new Error(`Resource not found: ${after.id}`);
      completedWrites.push(`resource:${after.id}`);
    }
    for (const { after } of changed(
      previousState.facilities,
      result.state.facilities,
      ["status", "availableCapacity"],
    )) {
      const updated = await dependencies.updateFacility(after.id, {
        status: after.status,
        availableCapacity: after.availableCapacity,
        updatedAt: after.updatedAt,
      });
      if (updated === null) throw new Error(`Facility not found: ${after.id}`);
      completedWrites.push(`facility:${after.id}`);
    }
    for (const { after } of changed(
      previousState.routes,
      result.state.routes,
      ["status", "blockedReason"],
    )) {
      const updated = await dependencies.updateRoute(after.id, {
        status: after.status,
        blockedReason: after.blockedReason,
        updatedAt: after.updatedAt,
      });
      if (updated === null) throw new Error(`Route not found: ${after.id}`);
      completedWrites.push(`route:${after.id}`);
    }
    for (const { after } of changed(
      previousState.planActions,
      result.state.planActions,
      ["status"],
    )) {
      const updated = await dependencies.updatePlanAction(after.id, {
        status: after.status,
        updatedAt: after.updatedAt,
      });
      if (updated === null) throw new Error(`PlanAction not found: ${after.id}`);
      completedWrites.push(`plan-action:${after.id}`);
    }

    const updatedPlan = await dependencies.updatePlan("APPROVED", result.plan);
    if (updatedPlan === null) {
      throw new SimulationPersistenceError(
        "PLAN_TRANSITION_CONFLICT",
        `ResponsePlan ${result.plan.id} is no longer approved.`,
        completedWrites,
      );
    }
    completedWrites.push(`response-plan:${result.plan.id}`);

    for (const stateChange of result.stateChanges) {
      await dependencies.createStateChange(stateChange);
      completedWrites.push(`state-change:${stateChange.id}`);
    }

    const persistedVersion = await dependencies.incrementStateVersion(previousState.incident.id);
    if (persistedVersion !== result.state.stateVersion) {
      throw new SimulationPersistenceError(
        "STATE_VERSION_CONFLICT",
        "Persisted emergency state advanced to an unexpected version.",
        completedWrites,
      );
    }
    return result.state;
  } catch (error) {
    if (error instanceof SimulationPersistenceError) throw error;
    throw new SimulationPersistenceError(
      databaseUnavailable(error) ? "DATABASE_UNAVAILABLE" : "PERSISTENCE_FAILED",
      databaseUnavailable(error)
        ? "Supabase is unavailable while persisting simulation changes."
        : "Simulation succeeded but persistence did not complete.",
      completedWrites,
      { cause: error },
    );
  }
}

export async function executeAndPersistApprovedPlan(
  planId: string,
  expectedStateVersion?: number,
): Promise<SimulationResult> {
  try {
    const [loader, plans, actions, versions, resources, facilities, routes, stateChanges] =
      await Promise.all([
      import("../emergency-state/loader"),
      import("../supabase/services/response-plans"),
      import("../supabase/services/plan-actions"),
      import("../supabase/services/emergency-states"),
      import("../supabase/services/resources"),
      import("../supabase/services/facilities"),
      import("../supabase/services/routes"),
      import("../supabase/services/state-changes"),
    ]);
    const plan = await plans.getCompleteResponsePlanById(planId);
    if (plan === null) {
      throw new SimulationPersistenceError("PLAN_NOT_FOUND", "Response plan was not found.");
    }
    const state = await loader.loadEmergencyState(plan.incidentId);
    if (
      expectedStateVersion !== undefined &&
      expectedStateVersion !== state.stateVersion
    ) {
      throw new SimulationPersistenceError(
        "STATE_VERSION_CONFLICT",
        "The requested state version is stale; reload and retry.",
      );
    }
    const planActions = await actions.listPlanActionsForPlan(plan.id);
    const executionState: EmergencyState = {
      ...state,
      planActions: [
        ...state.planActions.filter((action) => action.planId !== plan.id),
        ...planActions,
      ],
      activePlan: plan,
    };
    const result = executeApprovedPlan(executionState, plan);
    if (!result.success) {
      throw new SimulationPersistenceError(
        "SIMULATION_FAILED",
        `Plan simulation failed (${result.error.code}): ${result.error.message}`,
      );
    }
    const dependencies: SimulationPersistenceDependencies = {
      getStateVersion: versions.getEmergencyStateVersion,
      updateResource: resources.updateResource,
      updateFacility: facilities.updateFacility,
      updateRoute: routes.updateRoute,
      updatePlanAction: actions.updatePlanAction,
      updatePlan: async (expectedStatus, updatedPlan) => {
        const record = await plans.transitionResponsePlan(
          updatedPlan.id,
          expectedStatus,
          { status: updatedPlan.status, updatedAt: updatedPlan.updatedAt },
        );
        return record === null ? null : updatedPlan;
      },
      createStateChange: stateChanges.createStateChange,
      incrementStateVersion: versions.incrementEmergencyStateVersion,
    };
    await persistSimulationResult(executionState, result, dependencies);
    return result;
  } catch (error) {
    throw mapLoadError(error);
  }
}
