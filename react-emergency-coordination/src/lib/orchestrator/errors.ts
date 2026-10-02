import type { ReactAgentStage } from "./schema";

export type ReactOrchestrationErrorCode =
  | "ORCHESTRATOR_INPUT_INVALID"
  | "ORCHESTRATOR_STAGE_FAILED"
  | "ORCHESTRATOR_OUTPUT_INVALID";

type ReactOrchestrationErrorOptions = {
  code: ReactOrchestrationErrorCode;
  stage: ReactAgentStage | null;
  cause?: unknown;
  issues?: readonly string[];
};

export class ReactOrchestrationError extends Error {
  readonly code: ReactOrchestrationErrorCode;
  readonly stage: ReactAgentStage | null;
  readonly issues: readonly string[] | undefined;

  constructor(
    message: string,
    { code, stage, cause, issues }: ReactOrchestrationErrorOptions,
  ) {
    super(message, { cause });
    this.name = "ReactOrchestrationError";
    this.code = code;
    this.stage = stage;
    this.issues = issues;
  }
}

export class ReactOrchestrationInputError extends ReactOrchestrationError {
  constructor(message: string, issues: readonly string[], cause?: unknown) {
    super(message, {
      code: "ORCHESTRATOR_INPUT_INVALID",
      stage: null,
      cause,
      issues,
    });
    this.name = "ReactOrchestrationInputError";
  }
}

export class ReactOrchestrationStageError extends ReactOrchestrationError {
  constructor(stage: ReactAgentStage, cause: unknown) {
    super(`REACT orchestration failed during the ${stage} stage.`, {
      code: "ORCHESTRATOR_STAGE_FAILED",
      stage,
      cause,
    });
    this.name = "ReactOrchestrationStageError";
  }
}

export class ReactOrchestrationOutputError extends ReactOrchestrationError {
  constructor(
    message: string,
    issues: readonly string[],
    cause?: unknown,
  ) {
    super(message, {
      code: "ORCHESTRATOR_OUTPUT_INVALID",
      stage: "response-planning",
      cause,
      issues,
    });
    this.name = "ReactOrchestrationOutputError";
  }
}
