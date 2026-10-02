export type SimulationErrorCode =
  | "PLAN_NOT_EXECUTABLE"
  | "PLAN_STALE"
  | "PLAN_INVALID"
  | "PLAN_ALREADY_EXECUTED"
  | "ACTION_EXECUTION_FAILED"
  | "RESOURCE_EXECUTION_FAILED"
  | "FACILITY_EXECUTION_FAILED"
  | "ROUTE_EXECUTION_FAILED"
  | "INVALID_ACTION_REFERENCE";

export type SimulationError = {
  readonly code: SimulationErrorCode;
  readonly message: string;
  readonly actionId?: string;
};

export function simulationError(
  code: SimulationErrorCode,
  message: string,
  actionId?: string,
): SimulationError {
  return actionId === undefined ? { code, message } : { code, message, actionId };
}
