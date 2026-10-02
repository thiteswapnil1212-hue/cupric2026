import {
  EmergencyStateSchema,
  type EmergencyState,
} from "../../domain/emergency-state/schema";
import type { PlanAction } from "../../domain/plan-action/schema";
import {
  ResponsePlanSchema,
  type ResponsePlan,
} from "../../domain/response-plan/schema";
import type { Resource } from "../../domain/resource/schema";
import type { Facility } from "../../domain/facility/schema";
import type { Route } from "../../domain/route/schema";
import type { StateChange } from "../../domain/state-change/schema";
import {
  allocateFacilityCapacity,
  findFacility,
  isFacilityAvailable,
  validateFacilityCapacityAllocation,
  validateFacilityStatus,
} from "../emergency-engine/facilities";
import {
  assignResource,
  findResource,
  transitionResourceStatus,
  validateResourceAssignment,
} from "../emergency-engine/resources";
import { validatePlan } from "../emergency-engine/plan-validator";
import { findRoute, validateRouteUse } from "../emergency-engine/routes";
import { canExecuteApprovedPlan } from "../human-approval/plan-approval";
import {
  simulationError,
  type SimulationError,
} from "./errors";
import type {
  SimulationEntityState,
  SimulationEvent,
  SimulationResult,
} from "./schema";

type WorkingState = {
  readonly resources: readonly Resource[];
  readonly facilities: readonly Facility[];
  readonly routes: readonly Route[];
  readonly planActions: readonly EmergencyState["planActions"][number][];
};

type ActionExecution = {
  readonly working: WorkingState;
  readonly changes: readonly StateChange[];
  readonly before: readonly SimulationEntityState[];
  readonly after: readonly SimulationEntityState[];
};

function compareActions(left: PlanAction, right: PlanAction): number {
  return left.sequence - right.sequence || left.id.localeCompare(right.id);
}

function executionTimestamp(state: EmergencyState, plan: ResponsePlan): string {
  return Date.parse(state.updatedAt) >= Date.parse(plan.updatedAt)
    ? state.updatedAt
    : plan.updatedAt;
}

function entityStates(
  state: WorkingState,
  action: PlanAction,
): SimulationEntityState[] {
  const resources = action.resourceIds.flatMap((id) => {
    const resource = findResource(state.resources, id);
    return resource === null
      ? []
      : [
          {
            kind: "RESOURCE" as const,
            id,
            status: resource.status,
            currentAssignmentId: resource.currentAssignmentId,
          },
        ];
  });
  const facilities = action.facilityIds.flatMap((id) => {
    const facility = findFacility(state.facilities, id);
    return facility === null
      ? []
      : [
          {
            kind: "FACILITY" as const,
            id,
            status: facility.status,
            availableCapacity: facility.availableCapacity,
          },
        ];
  });
  const routes = action.routeIds.flatMap((id) => {
    const route = findRoute(state.routes, id);
    return route === null
      ? []
      : [{ kind: "ROUTE" as const, id, status: route.status }];
  });

  return [...resources, ...facilities, ...routes];
}

function change(
  plan: ResponsePlan,
  action: PlanAction,
  entityType: StateChange["entityType"],
  entityId: string,
  changeType: StateChange["changeType"],
  description: string,
  previousValue: StateChange["previousValue"],
  newValue: StateChange["newValue"],
  timestamp: string,
): StateChange {
  return {
    id: `${plan.id}:simulation:${action.sequence}:${entityType}:${entityId}:${changeType}`,
    entityType,
    entityId,
    changeType,
    description,
    previousValue,
    newValue,
    occurredAt: timestamp,
    detectedAt: timestamp,
  };
}

function actionStatusChange(
  plan: ResponsePlan,
  action: PlanAction,
  status: "COMPLETED" | "FAILED",
  timestamp: string,
): StateChange {
  return change(
    plan,
    action,
    "PLAN",
    action.id,
    "STATUS_CHANGED",
    `Simulation action ${action.id} ${status.toLowerCase()}.`,
    action.status,
    status,
    timestamp,
  );
}

function invalidActionFailure(
  plan: ResponsePlan,
  action: PlanAction,
  reason: string,
): SimulationError {
  return simulationError("INVALID_ACTION_REFERENCE", reason, action.id);
}

function executeAction(
  state: WorkingState,
  plan: ResponsePlan,
  action: PlanAction,
  timestamp: string,
): ActionExecution | SimulationError {
  const before = entityStates(state, action);

  const resourceValidation = validateResourceAssignment(
    state.resources,
    action.resourceIds,
    action.id,
  );
  if (!resourceValidation.valid) {
    return simulationError(
      "RESOURCE_EXECUTION_FAILED",
      resourceValidation.errors.map((error) => error.message).join(" "),
      action.id,
    );
  }

  for (const facilityId of action.facilityIds) {
    const facility = findFacility(state.facilities, facilityId);
    if (facility === null) {
      return simulationError(
        "FACILITY_EXECUTION_FAILED",
        `Facility ${facilityId} was not found.`,
        action.id,
      );
    }
    if (!validateFacilityStatus(facility).valid || !isFacilityAvailable(facility)) {
      return simulationError(
        "FACILITY_EXECUTION_FAILED",
        `Facility ${facilityId} is not available for simulation.`,
        action.id,
      );
    }
  }

  if (action.capacityDemand !== undefined && action.capacityDemand !== null) {
    if (action.facilityIds.length !== 1) {
      return simulationError(
        "FACILITY_EXECUTION_FAILED",
        "Capacity allocation requires exactly one facility reference.",
        action.id,
      );
    }
    const allocationValidation = validateFacilityCapacityAllocation(
      state.facilities,
      action.facilityIds[0],
      action.capacityDemand,
    );
    if (!allocationValidation.valid) {
      return simulationError(
        "FACILITY_EXECUTION_FAILED",
        allocationValidation.errors.map((error) => error.message).join(" "),
        action.id,
      );
    }
  }

  for (const routeId of action.routeIds) {
    const routeValidation = validateRouteUse(findRoute(state.routes, routeId));
    if (!routeValidation.valid) {
      return simulationError(
        "ROUTE_EXECUTION_FAILED",
        routeValidation.errors.map((error) => error.message).join(" "),
        action.id,
      );
    }
  }

  let resources = [...state.resources];
  const changes: StateChange[] = [];
  for (const resourceId of action.resourceIds) {
    const beforeResource = findResource(resources, resourceId);
    if (beforeResource === null) {
      return invalidActionFailure(plan, action, `Resource ${resourceId} was not found.`);
    }
    const assigned = assignResource(resources, resourceId, action.id);
    if (!assigned.valid || assigned.resource === null) {
      return simulationError(
        "RESOURCE_EXECUTION_FAILED",
        assigned.errors.map((error) => error.message).join(" "),
        action.id,
      );
    }
    resources = resources.map((resource) =>
      resource.id === resourceId ? assigned.resource! : resource,
    );
    changes.push(
      change(
        plan,
        action,
        "RESOURCE",
        resourceId,
        "STATUS_CHANGED",
        `Simulated assignment of resource ${resourceId}.`,
        beforeResource.status,
        "ASSIGNED",
        timestamp,
      ),
    );

    if (action.type === "DISPATCH_RESOURCE") {
      const dispatched = transitionResourceStatus(
        assigned.resource,
        "DISPATCHED",
      );
      if (!dispatched.valid || dispatched.resource === null) {
        return simulationError(
          "RESOURCE_EXECUTION_FAILED",
          dispatched.errors.map((error) => error.message).join(" "),
          action.id,
        );
      }
      resources = resources.map((resource) =>
        resource.id === resourceId ? dispatched.resource! : resource,
      );
      changes.push(
        change(
          plan,
          action,
          "RESOURCE",
          resourceId,
          "STATUS_CHANGED",
          `Simulated dispatch of resource ${resourceId}.`,
          "ASSIGNED",
          "DISPATCHED",
          timestamp,
        ),
      );
    }
  }

  let facilities = [...state.facilities];
  if (action.capacityDemand !== undefined && action.capacityDemand !== null) {
    const facilityId = action.facilityIds[0];
    const facility = findFacility(facilities, facilityId);
    if (facility === null) return invalidActionFailure(plan, action, "Facility reference is invalid.");
    const allocated = allocateFacilityCapacity(facility, action.capacityDemand);
    if (!allocated.valid || allocated.facility === null) {
      return simulationError(
        "FACILITY_EXECUTION_FAILED",
        allocated.errors.map((error) => error.message).join(" "),
        action.id,
      );
    }
    facilities = facilities.map((entry) =>
      entry.id === facilityId ? allocated.facility! : entry,
    );
    changes.push(
      change(
        plan,
        action,
        "FACILITY",
        facilityId,
        "CAPACITY_CHANGED",
        `Simulated allocation of ${action.capacityDemand} capacity at facility ${facilityId}.`,
        facility.availableCapacity,
        allocated.facility.availableCapacity,
        timestamp,
      ),
    );
  }

  const afterWorking: WorkingState = {
    resources,
    facilities,
    routes: [...state.routes],
    planActions: state.planActions,
  };
  return {
    working: afterWorking,
    changes: [...changes, actionStatusChange(plan, action, "COMPLETED", timestamp)],
    before,
    after: entityStates(afterWorking, action),
  };
}

function resultState(
  input: EmergencyState,
  working: WorkingState,
  plan: ResponsePlan,
  timestamp: string,
  actionStatus: "COMPLETED" | "FAILED",
  actionId: string,
): EmergencyState {
  const planActions = working.planActions.map((action) =>
    action.id === actionId
      ? { ...action, status: actionStatus, updatedAt: timestamp }
      : action,
  );
  const activePlan =
    actionStatus === "COMPLETED"
      ? { ...plan, status: "COMPLETED" as const, updatedAt: timestamp }
      : plan;
  return EmergencyStateSchema.parse({
    ...input,
    resources: [...working.resources],
    facilities: [...working.facilities],
    routes: [...working.routes],
    planActions,
    activePlan,
    stateVersion: input.stateVersion + 1,
    updatedAt: timestamp,
  });
}

function failureResult(
  state: EmergencyState,
  plan: ResponsePlan,
  error: SimulationError,
  executedActions: readonly string[],
  remainingActions: readonly string[],
  stateChanges: readonly StateChange[],
  events: readonly SimulationEvent[],
  working: WorkingState,
  failedAction: string | null,
  timestamp?: string,
): SimulationResult {
  const nextState =
    failedAction !== null && timestamp !== undefined
      ? resultState(state, working, plan, timestamp, "FAILED", failedAction)
      : state;
  return {
    success: false,
    state: nextState,
    plan,
    executedActions,
    failedAction,
    remainingActions,
    stateChanges,
    events,
    error,
  };
}

export function executeApprovedPlan(
  state: EmergencyState,
  plan: ResponsePlan,
): SimulationResult {
  const parsedPlan = ResponsePlanSchema.safeParse(plan);
  if (!parsedPlan.success) {
    return failureResult(
      state,
      plan,
      simulationError("PLAN_INVALID", "ResponsePlan structure is invalid."),
      [],
      [],
      [],
      [],
      {
        resources: state.resources,
        facilities: state.facilities,
        routes: state.routes,
        planActions: state.planActions,
      },
      null,
    );
  }

  if (
    state.activePlan?.id === plan.id &&
    state.activePlan.status === "COMPLETED"
  ) {
    return failureResult(
      state,
      plan,
      simulationError("PLAN_ALREADY_EXECUTED", "ResponsePlan has already been simulated."),
      [],
      plan.actions.map((action) => action.actionId),
      [],
      [],
      {
        resources: state.resources,
        facilities: state.facilities,
        routes: state.routes,
        planActions: state.planActions,
      },
      null,
    );
  }

  if (plan.incidentId !== state.incident.id) {
    return failureResult(
      state,
      plan,
      simulationError("PLAN_INVALID", "ResponsePlan incidentId does not match the current incident."),
      [],
      plan.actions.map((action) => action.actionId),
      [],
      [],
      {
        resources: state.resources,
        facilities: state.facilities,
        routes: state.routes,
        planActions: state.planActions,
      },
      null,
    );
  }
  if (plan.stateVersion !== state.stateVersion) {
    return failureResult(
      state,
      plan,
      simulationError("PLAN_STALE", "ResponsePlan stateVersion is not current."),
      [],
      plan.actions.map((action) => action.actionId),
      [],
      [],
      {
        resources: state.resources,
        facilities: state.facilities,
        routes: state.routes,
        planActions: state.planActions,
      },
      null,
    );
  }
  if (plan.status !== "APPROVED") {
    return failureResult(
      state,
      plan,
      simulationError("PLAN_NOT_EXECUTABLE", "Only an APPROVED response plan can be simulated."),
      [],
      plan.actions.map((action) => action.actionId),
      [],
      [],
      {
        resources: state.resources,
        facilities: state.facilities,
        routes: state.routes,
        planActions: state.planActions,
      },
      null,
    );
  }

  const validation = validatePlan(plan, state);
  if (!validation.valid || !canExecuteApprovedPlan(plan, { currentState: state })) {
    const stale = validation.errors.some(
      (issue) =>
        issue.code === "PLAN_STATE_VERSION_STALE" ||
        issue.code === "PLAN_STATE_VERSION_FUTURE",
    );
    return failureResult(
      state,
      plan,
      simulationError(
        stale ? "PLAN_STALE" : "PLAN_INVALID",
        validation.errors.map((issue) => issue.message).join(" ") ||
          "ResponsePlan is not executable.",
      ),
      [],
      plan.actions.map((action) => action.actionId),
      [],
      [],
      {
        resources: state.resources,
        facilities: state.facilities,
        routes: state.routes,
        planActions: state.planActions,
      },
      null,
    );
  }

  const actions = plan.actions
    .map((reference) =>
      state.planActions.find(
        (action) =>
          action.id === reference.actionId && action.sequence === reference.sequence,
      ),
    )
    .sort((left, right) => (left?.sequence ?? 0) - (right?.sequence ?? 0));
  const timestamp = executionTimestamp(state, plan);
  let working: WorkingState = {
    resources: state.resources,
    facilities: state.facilities,
    routes: state.routes,
    planActions: state.planActions,
  };
  const executedActions: string[] = [];
  const stateChanges: StateChange[] = [];
  const events: SimulationEvent[] = [];

  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index];
    const remainingActions = actions
      .slice(index)
      .flatMap((entry) => (entry === undefined ? [] : [entry.id]));
    if (action === undefined) {
      return failureResult(
        state,
        plan,
        simulationError("INVALID_ACTION_REFERENCE", "Plan action reference could not be resolved."),
        executedActions,
        remainingActions,
        stateChanges,
        events,
        working,
        null,
      );
    }

    const execution = executeAction(working, plan, action, timestamp);
    if ("code" in execution) {
      const before = entityStates(working, action);
      events.push({
        id: `${plan.id}:simulation:${action.sequence}:failed`,
        actionId: action.id,
        sequence: action.sequence,
        actionType: action.type,
        resourceIds: action.resourceIds,
        facilityIds: action.facilityIds,
        routeIds: action.routeIds,
        before,
        after: before,
        success: false,
        reason: execution.message,
        occurredAt: timestamp,
      });
      const failedChange = actionStatusChange(plan, action, "FAILED", timestamp);
      return failureResult(
        state,
        plan,
        execution.code === "RESOURCE_EXECUTION_FAILED" ||
        execution.code === "FACILITY_EXECUTION_FAILED" ||
        execution.code === "ROUTE_EXECUTION_FAILED"
          ? execution
          : simulationError("ACTION_EXECUTION_FAILED", execution.message, action.id),
        executedActions,
        remainingActions,
        [...stateChanges, failedChange],
        events,
        working,
        action.id,
        timestamp,
      );
    }

    working = execution.working;
    executedActions.push(action.id);
    stateChanges.push(...execution.changes);
    events.push({
      id: `${plan.id}:simulation:${action.sequence}:completed`,
      actionId: action.id,
      sequence: action.sequence,
      actionType: action.type,
      resourceIds: action.resourceIds,
      facilityIds: action.facilityIds,
      routeIds: action.routeIds,
      before: execution.before,
      after: execution.after,
      success: true,
      reason: null,
      occurredAt: timestamp,
    });
  }

  return {
    success: true,
    state: resultState(
      state,
      working,
      plan,
      timestamp,
      "COMPLETED",
      executedActions[executedActions.length - 1],
    ),
    plan: { ...plan, status: "COMPLETED", updatedAt: timestamp },
    executedActions,
    failedAction: null,
    remainingActions: [],
    stateChanges,
    events,
    error: null,
  };
}
