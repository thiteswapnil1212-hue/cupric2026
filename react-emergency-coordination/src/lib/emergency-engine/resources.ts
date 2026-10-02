import type {
  Resource,
  ResourceStatus,
} from "../../domain/resource/schema";

export type ResourceEngineErrorCode =
  | "RESOURCE_NOT_FOUND"
  | "RESOURCE_NOT_AVAILABLE"
  | "RESOURCE_ALREADY_ASSIGNED"
  | "RESOURCE_DUPLICATE_REQUEST"
  | "RESOURCE_ASSIGNMENT_REQUIRED"
  | "INVALID_RESOURCE_STATUS_TRANSITION";

export type ResourceEngineIssue = {
  code: ResourceEngineErrorCode;
  message: string;
  resourceId: string | null;
  assignmentId: string | null;
};

export type ResourceValidationResult = {
  valid: boolean;
  errors: readonly ResourceEngineIssue[];
  warnings: readonly ResourceEngineIssue[];
};

export type ResourceOperationResult = ResourceValidationResult & {
  resource: Resource | null;
};

const allowedStatusTransitions: Readonly<
  Record<ResourceStatus, readonly ResourceStatus[]>
> = {
  AVAILABLE: ["ASSIGNED"],
  ASSIGNED: ["DISPATCHED", "AVAILABLE"],
  DISPATCHED: ["BUSY", "AVAILABLE"],
  BUSY: ["AVAILABLE"],
  UNAVAILABLE: [],
  OUT_OF_SERVICE: [],
};

export function findResource(
  resources: readonly Resource[],
  resourceId: string,
): Resource | null {
  return resources.find((resource) => resource.id === resourceId) ?? null;
}

export function isResourceAvailable(resource: Resource): boolean {
  return resource.status === "AVAILABLE";
}

function createIssue(
  code: ResourceEngineErrorCode,
  message: string,
  resourceId: string | null = null,
  assignmentId: string | null = null,
): ResourceEngineIssue {
  return { code, message, resourceId, assignmentId };
}

function createValidationResult(
  errors: readonly ResourceEngineIssue[],
): ResourceValidationResult {
  return { valid: errors.length === 0, errors, warnings: [] };
}

function createOperationResult(
  errors: readonly ResourceEngineIssue[],
  resource: Resource | null = null,
): ResourceOperationResult {
  return { valid: errors.length === 0, errors, warnings: [], resource };
}

export function validateResourceAssignment(
  resources: readonly Resource[],
  requestedResourceIds: readonly string[],
  assignmentId: string,
): ResourceValidationResult {
  const errors: ResourceEngineIssue[] = [];
  if (assignmentId.trim().length === 0) {
    errors.push(
      createIssue(
        "RESOURCE_ASSIGNMENT_REQUIRED",
        "A non-empty assignment target is required.",
        null,
        assignmentId,
      ),
    );
  }
  if (requestedResourceIds.length === 0) {
    errors.push(
      createIssue(
        "RESOURCE_ASSIGNMENT_REQUIRED",
        "At least one resource must be requested for assignment.",
        null,
        assignmentId,
      ),
    );
  }

  const seenResourceIds = new Set<string>();
  for (const resourceId of requestedResourceIds) {
    if (seenResourceIds.has(resourceId)) {
      errors.push(
        createIssue(
          "RESOURCE_DUPLICATE_REQUEST",
          `Resource ${resourceId} appears more than once in the assignment request.`,
          resourceId,
          assignmentId,
        ),
      );
      continue;
    }
    seenResourceIds.add(resourceId);

    const resource = findResource(resources, resourceId);
    if (resource === null) {
      errors.push(
        createIssue(
          "RESOURCE_NOT_FOUND",
          `Resource ${resourceId} was not found.`,
          resourceId,
          assignmentId,
        ),
      );
      continue;
    }
    if (resource.currentAssignmentId !== null) {
      errors.push(
        createIssue(
          "RESOURCE_ALREADY_ASSIGNED",
          `Resource ${resourceId} already has an assignment.`,
          resourceId,
          resource.currentAssignmentId,
        ),
      );
      continue;
    }
    if (!isResourceAvailable(resource)) {
      errors.push(
        createIssue(
          "RESOURCE_NOT_AVAILABLE",
          `Resource ${resourceId} has status ${resource.status} and cannot be assigned.`,
          resourceId,
          assignmentId,
        ),
      );
    }
  }

  return createValidationResult(errors);
}

export function canAssignResource(
  resources: readonly Resource[],
  resourceId: string,
  assignmentId: string,
): ResourceValidationResult {
  return validateResourceAssignment(resources, [resourceId], assignmentId);
}

export function canReleaseResource(resource: Resource): boolean {
  if (resource.status === "BUSY") return true;
  return (
    (resource.status === "ASSIGNED" || resource.status === "DISPATCHED") &&
    resource.currentAssignmentId !== null
  );
}

export function transitionResourceStatus(
  resource: Resource,
  nextStatus: ResourceStatus,
  assignmentId?: string,
): ResourceOperationResult {
  const errors: ResourceEngineIssue[] = [];
  if (!allowedStatusTransitions[resource.status].includes(nextStatus)) {
    return createOperationResult([
      createIssue(
        "INVALID_RESOURCE_STATUS_TRANSITION",
        `Resource status cannot transition from ${resource.status} to ${nextStatus}.`,
        resource.id,
        resource.currentAssignmentId,
      ),
    ]);
  }

  if (nextStatus === "ASSIGNED") {
    if (resource.currentAssignmentId !== null) {
      errors.push(
        createIssue(
          "RESOURCE_ALREADY_ASSIGNED",
          `Resource ${resource.id} already has an assignment.`,
          resource.id,
          resource.currentAssignmentId,
        ),
      );
    }
    if (assignmentId === undefined || assignmentId.trim().length === 0) {
      errors.push(
        createIssue(
          "RESOURCE_ASSIGNMENT_REQUIRED",
          "A non-empty assignment target is required to assign a resource.",
          resource.id,
          assignmentId ?? null,
        ),
      );
    }
  } else if (
    (nextStatus === "DISPATCHED" || nextStatus === "BUSY") &&
    resource.currentAssignmentId === null
  ) {
    errors.push(
      createIssue(
        "RESOURCE_ASSIGNMENT_REQUIRED",
        `Resource must have an assignment before transitioning to ${nextStatus}.`,
        resource.id,
      ),
    );
  } else if (nextStatus === "AVAILABLE" && !canReleaseResource(resource)) {
    errors.push(
      createIssue(
        "RESOURCE_ASSIGNMENT_REQUIRED",
        `Resource ${resource.id} has no releasable assignment.`,
        resource.id,
        resource.currentAssignmentId,
      ),
    );
  }

  if (errors.length > 0) return createOperationResult(errors);

  return createOperationResult([], {
    ...resource,
    status: nextStatus,
    currentAssignmentId:
      nextStatus === "ASSIGNED"
        ? assignmentId ?? null
        : nextStatus === "AVAILABLE"
          ? null
          : resource.currentAssignmentId,
  });
}

export function assignResource(
  resources: readonly Resource[],
  resourceId: string,
  assignmentId: string,
): ResourceOperationResult {
  const validation = canAssignResource(resources, resourceId, assignmentId);
  if (!validation.valid) return createOperationResult(validation.errors);

  const resource = findResource(resources, resourceId);
  if (resource === null) {
    return createOperationResult([
      createIssue(
        "RESOURCE_NOT_FOUND",
        `Resource ${resourceId} was not found.`,
        resourceId,
        assignmentId,
      ),
    ]);
  }

  return transitionResourceStatus(resource, "ASSIGNED", assignmentId);
}

export function releaseResource(resource: Resource): ResourceOperationResult {
  return transitionResourceStatus(resource, "AVAILABLE");
}