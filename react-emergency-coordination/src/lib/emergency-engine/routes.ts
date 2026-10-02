import {
  RouteSchema,
  RouteStatusSchema,
  type Route,
  type RouteStatus,
} from "../../domain/route/schema";

export type RouteEngineIssueCode =
  | "ROUTE_NOT_FOUND"
  | "ROUTE_BLOCKED"
  | "ROUTE_CLOSED"
  | "ROUTE_PARTIALLY_BLOCKED"
  | "INVALID_ROUTE_DATA"
  | "ROUTE_BLOCK_REASON_REQUIRED"
  | "INVALID_ROUTE_STATUS_TRANSITION";

export type RouteEngineIssue = {
  code: RouteEngineIssueCode;
  message: string;
  routeId: string | null;
};

export type RouteValidationResult = {
  valid: boolean;
  errors: readonly RouteEngineIssue[];
  warnings: readonly RouteEngineIssue[];
};

export type RouteOperationResult = RouteValidationResult & {
  route: Route | null;
};

const allowedStatusTransitions: Readonly<
  Record<RouteStatus, readonly RouteStatus[]>
> = {
  OPEN: ["PARTIALLY_BLOCKED", "BLOCKED", "CLOSED"],
  PARTIALLY_BLOCKED: ["OPEN", "BLOCKED", "CLOSED"],
  BLOCKED: ["OPEN", "PARTIALLY_BLOCKED", "CLOSED"],
  CLOSED: ["OPEN", "PARTIALLY_BLOCKED", "BLOCKED"],
};

export function findRoute(
  routes: readonly Route[],
  routeId: string,
): Route | null {
  return routes.find((route) => route.id === routeId) ?? null;
}

export function isRouteAvailable(route: Route): boolean {
  return route.status === "OPEN" || route.status === "PARTIALLY_BLOCKED";
}

export function isRouteFullyOpen(route: Route): boolean {
  return route.status === "OPEN";
}

function createIssue(
  code: RouteEngineIssueCode,
  message: string,
  routeId: string | null,
): RouteEngineIssue {
  return { code, message, routeId };
}

function createValidationResult(
  errors: readonly RouteEngineIssue[],
  warnings: readonly RouteEngineIssue[] = [],
): RouteValidationResult {
  return { valid: errors.length === 0, errors, warnings };
}

function createOperationResult(
  errors: readonly RouteEngineIssue[],
  route: Route | null = null,
  warnings: readonly RouteEngineIssue[] = [],
): RouteOperationResult {
  return { valid: errors.length === 0, errors, warnings, route };
}

export function validateRoute(route: Route | null): RouteValidationResult {
  if (route === null) {
    return createValidationResult([
      createIssue("ROUTE_NOT_FOUND", "Route was not found.", null),
    ]);
  }

  const parsedRoute = RouteSchema.safeParse(route);
  if (!parsedRoute.success) {
    return createValidationResult(
      parsedRoute.error.issues.map((issue) =>
        createIssue(
          "INVALID_ROUTE_DATA",
          `${issue.path.join(".") || "route"}: ${issue.message}`,
          typeof route.id === "string" ? route.id : null,
        ),
      ),
    );
  }

  if (
    (route.status === "BLOCKED" || route.status === "CLOSED") &&
    (route.blockedReason === null || route.blockedReason.trim().length === 0)
  ) {
    return createValidationResult([
      createIssue(
        "ROUTE_BLOCK_REASON_REQUIRED",
        `${route.status} route requires a non-empty blockedReason.`,
        route.id,
      ),
    ]);
  }

  if (
    route.status === "PARTIALLY_BLOCKED" &&
    route.blockedReason !== null &&
    route.blockedReason.trim().length === 0
  ) {
    return createValidationResult([
      createIssue(
        "INVALID_ROUTE_DATA",
        "A partially blocked route reason must be non-empty when provided.",
        route.id,
      ),
    ]);
  }

  return createValidationResult([]);
}

export function validateRouteUse(route: Route | null): RouteValidationResult {
  const routeValidation = validateRoute(route);
  if (!routeValidation.valid || route === null) return routeValidation;

  switch (route.status) {
    case "OPEN":
      return routeValidation;
    case "PARTIALLY_BLOCKED":
      return createValidationResult([], [
        createIssue(
          "ROUTE_PARTIALLY_BLOCKED",
          `Route ${route.id} is partially blocked; use is possible but not fully open.`,
          route.id,
        ),
      ]);
    case "BLOCKED":
      return createValidationResult([
        createIssue(
          "ROUTE_BLOCKED",
          `Route ${route.id} is blocked and cannot be used.`,
          route.id,
        ),
      ]);
    case "CLOSED":
      return createValidationResult([
        createIssue(
          "ROUTE_CLOSED",
          `Route ${route.id} is closed and cannot be used.`,
          route.id,
        ),
      ]);
  }
}

export function isRouteUsable(
  routes: readonly Route[],
  routeId: string,
): boolean {
  return validateRouteUse(findRoute(routes, routeId)).valid;
}

export function transitionRouteStatus(
  route: Route,
  nextStatus: RouteStatus,
  blockedReason?: string | null,
): RouteOperationResult {
  const routeValidation = validateRoute(route);
  if (!routeValidation.valid) {
    return createOperationResult(routeValidation.errors);
  }

  if (!RouteStatusSchema.safeParse(nextStatus).success) {
    return createOperationResult([
      createIssue(
        "INVALID_ROUTE_STATUS_TRANSITION",
        "Route status transition requires a supported next status.",
        route.id,
      ),
    ]);
  }

  if (!allowedStatusTransitions[route.status].includes(nextStatus)) {
    return createOperationResult([
      createIssue(
        "INVALID_ROUTE_STATUS_TRANSITION",
        `Route status cannot transition from ${route.status} to ${nextStatus}.`,
        route.id,
      ),
    ]);
  }

  const nextBlockedReason =
    nextStatus === "OPEN"
      ? null
      : blockedReason === undefined
        ? route.blockedReason
        : blockedReason;

  if (
    (nextStatus === "BLOCKED" || nextStatus === "CLOSED") &&
    (nextBlockedReason === null || nextBlockedReason.trim().length === 0)
  ) {
    return createOperationResult([
      createIssue(
        "ROUTE_BLOCK_REASON_REQUIRED",
        `${nextStatus} route requires a non-empty blockedReason.`,
        route.id,
      ),
    ]);
  }

  if (
    nextStatus === "PARTIALLY_BLOCKED" &&
    nextBlockedReason !== null &&
    nextBlockedReason.trim().length === 0
  ) {
    return createOperationResult([
      createIssue(
        "INVALID_ROUTE_DATA",
        "A partially blocked route reason must be non-empty when provided.",
        route.id,
      ),
    ]);
  }

  const updatedRoute: Route = {
    ...route,
    status: nextStatus,
    blockedReason: nextBlockedReason,
  };
  const updatedValidation = validateRoute(updatedRoute);
  if (!updatedValidation.valid) {
    return createOperationResult(updatedValidation.errors);
  }

  return createOperationResult([], updatedRoute);
}

export function blockRoute(route: Route, reason: string): RouteOperationResult {
  return transitionRouteStatus(route, "BLOCKED", reason);
}

export function reopenRoute(route: Route): RouteOperationResult {
  return transitionRouteStatus(route, "OPEN", null);
}
