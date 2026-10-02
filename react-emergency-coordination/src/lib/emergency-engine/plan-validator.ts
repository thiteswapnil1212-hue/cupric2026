import {
  PlanActionSchema,
  type PlanAction,
} from "../../domain/plan-action/schema";
import type { EmergencyState } from "../../domain/emergency-state/schema";
import { FacilitySchema } from "../../domain/facility/schema";
import {
  ResponsePlanSchema,
  type ResponsePlan,
} from "../../domain/response-plan/schema";
import {
  validateResourceAssignment,
} from "./resources";
import {
  findFacility,
  isFacilityAvailable,
  validateFacilityCapacityAllocation,
  validateFacilityStatus,
} from "./facilities";
import { findRoute, validateRouteUse } from "./routes";

export type PlanValidationEntityType =
  | "PLAN"
  | "INCIDENT"
  | "ACTION"
  | "RESOURCE"
  | "FACILITY"
  | "ROUTE";

export type PlanValidationIssueCode =
  | "PLAN_MISSING"
  | "PLAN_INVALID"
  | "PLAN_STATUS_INVALID"
  | "PLAN_INCIDENT_NOT_FOUND"
  | "PLAN_INCIDENT_MISMATCH"
  | "PLAN_STATE_VERSION_STALE"
  | "PLAN_STATE_VERSION_FUTURE"
  | "PLAN_ACTION_NOT_FOUND"
  | "PLAN_ACTION_PLAN_MISMATCH"
  | "PLAN_ACTION_SEQUENCE_MISMATCH"
  | "DUPLICATE_PLAN_ACTION"
  | "PLAN_ACTION_INVALID"
  | "CAPACITY_DEMAND_REQUIRED"
  | "INVALID_CAPACITY_DEMAND"
  | "RESOURCE_NOT_FOUND"
  | "RESOURCE_NOT_AVAILABLE"
  | "RESOURCE_ALREADY_ASSIGNED"
  | "RESOURCE_ASSIGNMENT_REQUIRED"
  | "RESOURCE_DUPLICATE_ASSIGNMENT"
  | "RESOURCE_REFERENCE_AMBIGUOUS"
  | "FACILITY_NOT_FOUND"
  | "FACILITY_NOT_AVAILABLE"
  | "FACILITY_INVALID"
  | "FACILITY_CAPACITY_INCONSISTENT"
  | "FACILITY_CAPACITY_TARGET_REQUIRED"
  | "FACILITY_CAPACITY_TARGET_AMBIGUOUS"
  | "FACILITY_CAPACITY_INSUFFICIENT"
  | "FACILITY_CAPACITY_OVERCOMMITTED"
  | "FACILITY_REFERENCE_AMBIGUOUS"
  | "ROUTE_NOT_FOUND"
  | "ROUTE_BLOCKED"
  | "ROUTE_CLOSED"
  | "ROUTE_PARTIALLY_BLOCKED"
  | "ROUTE_INVALID"
  | "ROUTE_REFERENCE_AMBIGUOUS"
  | "PLAN_DEPENDENCY_NOT_FOUND"
  | "PLAN_DEPENDENCY_AMBIGUOUS";

export type PlanValidationIssue = {
  code: PlanValidationIssueCode;
  message: string;
  actionId?: string;
  entityType?: PlanValidationEntityType;
  entityId?: string;
};

export type PlanValidationResult = {
  valid: boolean;
  errors: readonly PlanValidationIssue[];
  warnings: readonly PlanValidationIssue[];
};

type ResolvedPlanAction = {
  action: PlanAction;
  sequence: number;
};

type CapacityDemand = {
  actionId: string;
  amount: number;
};

type MutableIssues = PlanValidationIssue[];

function createIssue(
  code: PlanValidationIssueCode,
  message: string,
  details: Omit<PlanValidationIssue, "code" | "message"> = {},
): PlanValidationIssue {
  return { code, message, ...details };
}

function stableUniqueIssues(
  issues: readonly PlanValidationIssue[],
): PlanValidationIssue[] {
  const seen = new Set<string>();
  const unique: PlanValidationIssue[] = [];
  for (const issue of issues) {
    const key = [
      issue.code,
      issue.actionId ?? "",
      issue.entityType ?? "",
      issue.entityId ?? "",
      issue.message,
    ].join("\u0000");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(issue);
  }
  return unique;
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareActions(
  left: ResolvedPlanAction,
  right: ResolvedPlanAction,
): number {
  return (
    left.sequence - right.sequence ||
    compareStrings(left.action.id, right.action.id)
  );
}

function addSchemaIssue(
  issues: MutableIssues,
  action: PlanAction,
  path: readonly PropertyKey[],
  message: string,
): void {
  issues.push(
    createIssue("PLAN_ACTION_INVALID", `${path.join(".") || "action"}: ${message}`, {
      actionId: action.id,
      entityType: "ACTION",
      entityId: action.id,
    }),
  );
}

function addActionCapacityIssue(
  issues: MutableIssues,
  action: PlanAction,
): boolean {
  if (
    action.type === "SHELTER_PEOPLE" &&
    (action.capacityDemand === undefined || action.capacityDemand === null)
  ) {
    issues.push(
      createIssue(
        "CAPACITY_DEMAND_REQUIRED",
        "SHELTER_PEOPLE requires a positive integer capacityDemand.",
        { actionId: action.id, entityType: "ACTION", entityId: action.id },
      ),
    );
    return false;
  }

  if (
    action.capacityDemand !== undefined &&
    action.capacityDemand !== null &&
    (!Number.isSafeInteger(action.capacityDemand) || action.capacityDemand <= 0)
  ) {
    issues.push(
      createIssue(
        "INVALID_CAPACITY_DEMAND",
        "capacityDemand must be a positive safe integer when provided.",
        { actionId: action.id, entityType: "ACTION", entityId: action.id },
      ),
    );
    return false;
  }

  return true;
}

function matchesById<T extends { id: string }>(
  entities: readonly T[],
  id: string,
): T[] {
  return entities.filter((entity) => entity.id === id);
}

function addEngineResourceIssue(
  issues: MutableIssues,
  code: string,
  message: string,
  resourceId: string,
  actionId: string,
): void {
  if (
    code === "RESOURCE_NOT_FOUND" ||
    code === "RESOURCE_NOT_AVAILABLE" ||
    code === "RESOURCE_ALREADY_ASSIGNED" ||
    code === "RESOURCE_ASSIGNMENT_REQUIRED"
  ) {
    issues.push(
      createIssue(code, message, {
        actionId,
        entityType: "RESOURCE",
        entityId: resourceId,
      }),
    );
    return;
  }

  if (code === "RESOURCE_DUPLICATE_REQUEST") {
    issues.push(
      createIssue("RESOURCE_DUPLICATE_ASSIGNMENT", message, {
        actionId,
        entityType: "RESOURCE",
        entityId: resourceId,
      }),
    );
  }
}

function validatePlanActionReferences(
  plan: ResponsePlan,
  state: EmergencyState,
  issues: MutableIssues,
): ResolvedPlanAction[] {
  const resolved: ResolvedPlanAction[] = [];
  const seenReferences = new Set<string>();
  const references = [...plan.actions].sort(
    (left, right) =>
      left.sequence - right.sequence ||
      compareStrings(left.actionId, right.actionId),
  );

  for (const reference of references) {
    if (seenReferences.has(reference.actionId)) {
      issues.push(
        createIssue(
          "DUPLICATE_PLAN_ACTION",
          `Plan action ${reference.actionId} is referenced more than once.`,
          {
            actionId: reference.actionId,
            entityType: "ACTION",
            entityId: reference.actionId,
          },
        ),
      );
      continue;
    }
    seenReferences.add(reference.actionId);

    const matchingActions = matchesById(state.planActions, reference.actionId);
    if (matchingActions.length === 0) {
      issues.push(
        createIssue(
          "PLAN_ACTION_NOT_FOUND",
          `Plan action ${reference.actionId} was not found in EmergencyState.planActions.`,
          {
            actionId: reference.actionId,
            entityType: "ACTION",
            entityId: reference.actionId,
          },
        ),
      );
      continue;
    }
    if (matchingActions.length > 1) {
      issues.push(
        createIssue(
          "DUPLICATE_PLAN_ACTION",
          `EmergencyState contains multiple PlanAction records with id ${reference.actionId}.`,
          {
            actionId: reference.actionId,
            entityType: "ACTION",
            entityId: reference.actionId,
          },
        ),
      );
      continue;
    }

    const action = matchingActions[0];
    if (action.planId !== plan.id) {
      issues.push(
        createIssue(
          "PLAN_ACTION_PLAN_MISMATCH",
          `PlanAction ${action.id} belongs to plan ${action.planId}, not ${plan.id}.`,
          { actionId: action.id, entityType: "ACTION", entityId: action.id },
        ),
      );
      continue;
    }
    if (action.sequence !== reference.sequence) {
      issues.push(
        createIssue(
          "PLAN_ACTION_SEQUENCE_MISMATCH",
          `PlanAction ${action.id} sequence ${action.sequence} does not match reference sequence ${reference.sequence}.`,
          { actionId: action.id, entityType: "ACTION", entityId: action.id },
        ),
      );
      continue;
    }

    resolved.push({ action, sequence: reference.sequence });
  }

  return resolved.sort(compareActions);
}

function validateActionStructures(
  resolvedActions: readonly ResolvedPlanAction[],
  issues: MutableIssues,
): PlanAction[] {
  const validForEntityChecks: PlanAction[] = [];

  for (const { action } of resolvedActions) {
    addActionCapacityIssue(issues, action);
    const parsed = PlanActionSchema.safeParse(action);
    if (parsed.success) {
      validForEntityChecks.push(parsed.data);
      continue;
    }

    const nonCapacityIssues = parsed.error.issues
      .filter((issue) => issue.path[0] !== "capacityDemand")
      .sort((left, right) => {
        const pathDifference = compareStrings(
          left.path.map(String).join("."),
          right.path.map(String).join("."),
        );
        return pathDifference || compareStrings(left.message, right.message);
      });

    for (const issue of nonCapacityIssues) {
      addSchemaIssue(issues, action, issue.path, issue.message);
    }

    if (nonCapacityIssues.length === 0) validForEntityChecks.push(action);
  }

  return validForEntityChecks.sort((left, right) =>
    compareStrings(left.id, right.id),
  );
}

function validateResources(
  actions: readonly PlanAction[],
  state: EmergencyState,
  issues: MutableIssues,
): void {
  for (const action of actions) {
    const resourceIds = [...action.resourceIds].sort(compareStrings);
    for (const resourceId of new Set(resourceIds)) {
      const matches = matchesById(state.resources, resourceId);
      if (matches.length > 1) {
        issues.push(
          createIssue(
            "RESOURCE_REFERENCE_AMBIGUOUS",
            `EmergencyState contains multiple resources with id ${resourceId}.`,
            { actionId: action.id, entityType: "RESOURCE", entityId: resourceId },
          ),
        );
      }
    }

    if (resourceIds.length === 0) continue;

    const validation = validateResourceAssignment(
      state.resources,
      resourceIds,
      action.id,
    );
    for (const error of validation.errors) {
      addEngineResourceIssue(
        issues,
        error.code,
        error.message,
        error.resourceId ?? "",
        action.id,
      );
    }
  }
}

function validateFacilities(
  actions: readonly PlanAction[],
  state: EmergencyState,
  issues: MutableIssues,
): void {
  for (const action of actions) {
    const facilityIds = [...new Set(action.facilityIds)].sort(compareStrings);
    for (const facilityId of facilityIds) {
      const matches = matchesById(state.facilities, facilityId);
      if (matches.length === 0) {
        issues.push(
          createIssue(
            "FACILITY_NOT_FOUND",
            `Facility ${facilityId} referenced by action ${action.id} was not found.`,
            { actionId: action.id, entityType: "FACILITY", entityId: facilityId },
          ),
        );
        continue;
      }
      if (matches.length > 1) {
        issues.push(
          createIssue(
            "FACILITY_REFERENCE_AMBIGUOUS",
            `EmergencyState contains multiple facilities with id ${facilityId}.`,
            { actionId: action.id, entityType: "FACILITY", entityId: facilityId },
          ),
        );
        continue;
      }

      const facility = findFacility(state.facilities, facilityId);
      if (facility === null) continue;

      if (!FacilitySchema.safeParse(facility).success) {
        issues.push(
          createIssue(
            "FACILITY_INVALID",
            `Facility ${facilityId} has invalid domain data.`,
            { actionId: action.id, entityType: "FACILITY", entityId: facilityId },
          ),
        );
        continue;
      }

      const statusValidation = validateFacilityStatus(facility);
      if (!statusValidation.valid) {
        issues.push(
          createIssue(
            "FACILITY_INVALID",
            statusValidation.errors[0].message,
            { actionId: action.id, entityType: "FACILITY", entityId: facilityId },
          ),
        );
      } else if (!isFacilityAvailable(facility)) {
        issues.push(
          createIssue(
            "FACILITY_NOT_AVAILABLE",
            `Facility ${facilityId} with status ${facility.status} cannot be used by action ${action.id}.`,
            { actionId: action.id, entityType: "FACILITY", entityId: facilityId },
          ),
        );
      }
    }
  }
}

function validateFacilityCapacity(
  actions: readonly PlanAction[],
  state: EmergencyState,
  issues: MutableIssues,
): Map<string, CapacityDemand[]> {
  const demandsByFacility = new Map<string, CapacityDemand[]>();

  for (const action of actions) {
    const demand = action.capacityDemand;
    if (demand === undefined || demand === null) continue;
    if (!Number.isSafeInteger(demand) || demand <= 0) continue;

    if (action.facilityIds.length === 0) {
      issues.push(
        createIssue(
          "FACILITY_CAPACITY_TARGET_REQUIRED",
          `Action ${action.id} has capacityDemand but references no facility.`,
          { actionId: action.id, entityType: "ACTION", entityId: action.id },
        ),
      );
      continue;
    }
    if (action.facilityIds.length !== 1) {
      issues.push(
        createIssue(
          "FACILITY_CAPACITY_TARGET_AMBIGUOUS",
          `Action ${action.id} has capacityDemand and multiple facilityIds; the domain does not specify whether they are alternatives or simultaneous targets.`,
          { actionId: action.id, entityType: "ACTION", entityId: action.id },
        ),
      );
      continue;
    }

    const facilityId = action.facilityIds[0];
    const matchingFacilities = matchesById(state.facilities, facilityId);
    if (matchingFacilities.length !== 1) continue;

    const facility = findFacility(state.facilities, facilityId);
    if (facility === null) continue;

    const allocation = validateFacilityCapacityAllocation(
      state.facilities,
      facilityId,
      demand,
    );
    for (const error of allocation.errors) {
      if (error.code === "INSUFFICIENT_CAPACITY") {
        issues.push(
          createIssue(
            "FACILITY_CAPACITY_INSUFFICIENT",
            error.message,
            { actionId: action.id, entityType: "FACILITY", entityId: facilityId },
          ),
        );
      } else if (error.code === "FACILITY_CAPACITY_INCONSISTENT") {
        issues.push(
          createIssue(
            "FACILITY_CAPACITY_INCONSISTENT",
            error.message,
            { actionId: action.id, entityType: "FACILITY", entityId: facilityId },
          ),
        );
      }
    }

    if (!isFacilityAvailable(facility)) continue;
    const facilityDemands = demandsByFacility.get(facilityId) ?? [];
    facilityDemands.push({ actionId: action.id, amount: demand });
    demandsByFacility.set(facilityId, facilityDemands);
  }

  for (const facilityId of [...demandsByFacility.keys()].sort(compareStrings)) {
    const facility = findFacility(state.facilities, facilityId);
    if (facility === null) continue;
    const facilityDemands = demandsByFacility.get(facilityId) ?? [];
    if (facilityDemands.length < 2) continue;

    const totalDemand = facilityDemands.reduce(
      (total, entry) => total + entry.amount,
      0,
    );
    if (
      !Number.isSafeInteger(totalDemand) ||
      totalDemand > facility.availableCapacity
    ) {
      const actionIds = facilityDemands
        .map((entry) => entry.actionId)
        .sort(compareStrings);
      issues.push(
        createIssue(
          "FACILITY_CAPACITY_OVERCOMMITTED",
          `Actions ${actionIds.join(", ")} require ${totalDemand} capacity at facility ${facilityId}, which has ${facility.availableCapacity} available.`,
          {
            actionId: actionIds[0],
            entityType: "FACILITY",
            entityId: facilityId,
          },
        ),
      );
    }
  }

  return demandsByFacility;
}

function validateRoutes(
  actions: readonly PlanAction[],
  state: EmergencyState,
  errors: MutableIssues,
  warnings: MutableIssues,
): void {
  for (const action of actions) {
    const routeIds = [...new Set(action.routeIds)].sort(compareStrings);
    for (const routeId of routeIds) {
      const matches = matchesById(state.routes, routeId);
      if (matches.length > 1) {
        errors.push(
          createIssue(
            "ROUTE_REFERENCE_AMBIGUOUS",
            `EmergencyState contains multiple routes with id ${routeId}.`,
            { actionId: action.id, entityType: "ROUTE", entityId: routeId },
          ),
        );
        continue;
      }

      const route = findRoute(state.routes, routeId);
      const result = validateRouteUse(route);
      for (const error of result.errors) {
        const code =
          error.code === "ROUTE_BLOCKED" || error.code === "ROUTE_CLOSED"
            ? error.code
            : error.code === "ROUTE_NOT_FOUND"
              ? "ROUTE_NOT_FOUND"
              : "ROUTE_INVALID";
        errors.push(
          createIssue(code, error.message, {
            actionId: action.id,
            entityType: "ROUTE",
            entityId: routeId,
          }),
        );
      }
      for (const warning of result.warnings) {
        warnings.push(
          createIssue("ROUTE_PARTIALLY_BLOCKED", warning.message, {
            actionId: action.id,
            entityType: "ROUTE",
            entityId: routeId,
          }),
        );
      }
    }
  }
}

function validateCrossActionResourceConflicts(
  actions: readonly PlanAction[],
  issues: MutableIssues,
): void {
  const resourceActions = new Map<string, Set<string>>();
  for (const action of actions) {
    for (const resourceId of new Set(action.resourceIds)) {
      const actionIds = resourceActions.get(resourceId) ?? new Set<string>();
      actionIds.add(action.id);
      resourceActions.set(resourceId, actionIds);
    }
  }

  for (const resourceId of [...resourceActions.keys()].sort(compareStrings)) {
    const actionIds = [...(resourceActions.get(resourceId) ?? [])].sort(compareStrings);
    if (actionIds.length < 2) continue;
    issues.push(
      createIssue(
        "RESOURCE_DUPLICATE_ASSIGNMENT",
        `Resource ${resourceId} is assigned to multiple actions: ${actionIds.join(", ")}.`,
        {
          actionId: actionIds[1],
          entityType: "RESOURCE",
          entityId: resourceId,
        },
      ),
    );
  }
}

function validateDependencies(
  plan: ResponsePlan,
  state: EmergencyState,
  issues: MutableIssues,
): void {
  const dependencyGroups: {
    entityType: "RESOURCE" | "FACILITY" | "ROUTE";
    ids: readonly string[];
    matches: (id: string) => number;
  }[] = [
    {
      entityType: "RESOURCE",
      ids: plan.dependencies.resourceIds,
      matches: (id) => matchesById(state.resources, id).length,
    },
    {
      entityType: "FACILITY",
      ids: plan.dependencies.facilityIds,
      matches: (id) => matchesById(state.facilities, id).length,
    },
    {
      entityType: "ROUTE",
      ids: plan.dependencies.routeIds,
      matches: (id) => matchesById(state.routes, id).length,
    },
  ];

  for (const group of dependencyGroups) {
    for (const entityId of [...new Set(group.ids)].sort(compareStrings)) {
      const matchCount = group.matches(entityId);
      if (matchCount === 0) {
        issues.push(
          createIssue(
            "PLAN_DEPENDENCY_NOT_FOUND",
            `Plan dependency ${entityId} was not found as a ${group.entityType.toLowerCase()}.`,
            { entityType: group.entityType, entityId },
          ),
        );
      } else if (matchCount > 1) {
        issues.push(
          createIssue(
            "PLAN_DEPENDENCY_AMBIGUOUS",
            `Plan dependency ${entityId} matches multiple ${group.entityType.toLowerCase()} records.`,
            { entityType: group.entityType, entityId },
          ),
        );
      }
    }
  }
}

function result(
  errors: readonly PlanValidationIssue[],
  warnings: readonly PlanValidationIssue[],
): PlanValidationResult {
  const uniqueErrors = stableUniqueIssues(errors);
  const uniqueWarnings = stableUniqueIssues(warnings);
  return {
    valid: uniqueErrors.length === 0,
    errors: uniqueErrors,
    warnings: uniqueWarnings,
  };
}

export function validatePlan(
  plan: ResponsePlan | null,
  emergencyState: EmergencyState,
): PlanValidationResult {
  if (plan === null) {
    return result(
      [createIssue("PLAN_MISSING", "ResponsePlan is required.", { entityType: "PLAN" })],
      [],
    );
  }

  const planValidation = ResponsePlanSchema.safeParse(plan);
  if (!planValidation.success) {
    const structureIssues = [...planValidation.error.issues].sort((left, right) => {
      const pathDifference = compareStrings(
        left.path.map(String).join("."),
        right.path.map(String).join("."),
      );
      return pathDifference || compareStrings(left.message, right.message);
    });
    return result(
      [
        createIssue(
          "PLAN_INVALID",
          structureIssues
            .map((issue) => `${issue.path.map(String).join(".") || "plan"}: ${issue.message}`)
            .join("; "),
          {
            entityType: "PLAN",
            entityId: typeof plan.id === "string" ? plan.id : undefined,
          },
        ),
      ],
      [],
    );
  }

  const validatedPlan = planValidation.data;
  const planStructureErrors: PlanValidationIssue[] = [];
  const incidentErrors: PlanValidationIssue[] = [];
  const versionErrors: PlanValidationIssue[] = [];
  const actionReferenceErrors: PlanValidationIssue[] = [];
  const actionStructureErrors: PlanValidationIssue[] = [];
  const resourceErrors: PlanValidationIssue[] = [];
  const facilityErrors: PlanValidationIssue[] = [];
  const capacityErrors: PlanValidationIssue[] = [];
  const routeErrors: PlanValidationIssue[] = [];
  const routeWarnings: PlanValidationIssue[] = [];
  const conflictErrors: PlanValidationIssue[] = [];
  const dependencyErrors: PlanValidationIssue[] = [];

  if (validatedPlan.status === "INVALID") {
    planStructureErrors.push(
      createIssue(
        "PLAN_STATUS_INVALID",
        "A response plan with status INVALID cannot execute.",
        { entityType: "PLAN", entityId: validatedPlan.id },
      ),
    );
  }

  const currentIncidentId = emergencyState.incident?.id;
  if (typeof currentIncidentId !== "string" || currentIncidentId.length === 0) {
    incidentErrors.push(
      createIssue(
        "PLAN_INCIDENT_NOT_FOUND",
        "EmergencyState has no valid incident to validate against.",
        { entityType: "INCIDENT" },
      ),
    );
  } else if (validatedPlan.incidentId !== currentIncidentId) {
    incidentErrors.push(
      createIssue(
        "PLAN_INCIDENT_MISMATCH",
        `Plan incident ${validatedPlan.incidentId} does not match current incident ${currentIncidentId}.`,
        { entityType: "INCIDENT", entityId: validatedPlan.incidentId },
      ),
      createIssue(
        "PLAN_INCIDENT_NOT_FOUND",
        `Incident ${validatedPlan.incidentId} is not present in EmergencyState.`,
        { entityType: "INCIDENT", entityId: validatedPlan.incidentId },
      ),
    );
  }

  if (validatedPlan.stateVersion < emergencyState.stateVersion) {
    versionErrors.push(
      createIssue(
        "PLAN_STATE_VERSION_STALE",
        `Plan stateVersion ${validatedPlan.stateVersion} is older than current stateVersion ${emergencyState.stateVersion}.`,
        { entityType: "PLAN", entityId: validatedPlan.id },
      ),
    );
  } else if (validatedPlan.stateVersion > emergencyState.stateVersion) {
    versionErrors.push(
      createIssue(
        "PLAN_STATE_VERSION_FUTURE",
        `Plan stateVersion ${validatedPlan.stateVersion} is newer than current stateVersion ${emergencyState.stateVersion}.`,
        { entityType: "PLAN", entityId: validatedPlan.id },
      ),
    );
  }

  const resolvedActions = validatePlanActionReferences(
    validatedPlan,
    emergencyState,
    actionReferenceErrors,
  );
  const executableActions = validateActionStructures(
    resolvedActions,
    actionStructureErrors,
  );

  validateResources(executableActions, emergencyState, resourceErrors);
  validateFacilities(executableActions, emergencyState, facilityErrors);
  validateFacilityCapacity(executableActions, emergencyState, capacityErrors);
  validateRoutes(
    executableActions,
    emergencyState,
    routeErrors,
    routeWarnings,
  );
  validateCrossActionResourceConflicts(executableActions, conflictErrors);
  validateDependencies(validatedPlan, emergencyState, dependencyErrors);

  return result(
    [
      ...planStructureErrors,
      ...incidentErrors,
      ...versionErrors,
      ...actionReferenceErrors,
      ...actionStructureErrors,
      ...resourceErrors,
      ...facilityErrors,
      ...capacityErrors,
      ...routeErrors,
      ...conflictErrors,
      ...dependencyErrors,
    ],
    routeWarnings,
  );
}
