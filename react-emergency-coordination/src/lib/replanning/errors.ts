export type ReplanningErrorCode =
  | "INVALID_REPLANNING_REQUEST"
  | "STATE_VERSION_INVALID"
  | "STATE_INCIDENT_MISMATCH"
  | "ACTIVE_PLAN_MISSING"
  | "ACTIVE_PLAN_INVALID"
  | "CHANGE_DETECTION_FAILED"
  | "REASSESSMENT_FAILED"
  | "PLAN_GENERATION_FAILED"
  | "REVISED_PLAN_INVALID"
  | "REVISED_PLAN_STALE"
  | "PREVIOUS_PLAN_SUPERSEDE_FAILED";

export type ReplanningError = {
  readonly code: ReplanningErrorCode;
  readonly message: string;
  readonly stage?: "change-detection" | "risk-assessment" | "resource-routing" | "response-planning";
};

export function replanningError(
  code: ReplanningErrorCode,
  message: string,
  stage?: ReplanningError["stage"],
): ReplanningError {
  return stage === undefined ? { code, message } : { code, message, stage };
}
