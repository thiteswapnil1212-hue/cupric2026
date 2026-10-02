import type { ReactAgentStage } from "./schema";
import type {
  OrchestrationFailureCategory,
  OrchestrationStatus,
  RecoveryRecommendation,
} from "./schema";

export type ReactOrchestrationErrorCode =
  | "ORCHESTRATOR_INPUT_INVALID"
  | "ORCHESTRATOR_STAGE_FAILED"
  | "ORCHESTRATOR_OUTPUT_INVALID"
  | "ORCHESTRATOR_PERSISTENCE_FAILED"
  | "ORCHESTRATOR_UNEXPECTED";

export type OrchestratorPersistenceOperation =
  | "agent-run"
  | "response-plan"
  | "plan-action"
  | "verification";

export type OrchestrationFailureMetadata = {
  status: Exclude<OrchestrationStatus, "COMPLETED">;
  failureCategory: OrchestrationFailureCategory;
  retryable: boolean;
  failedStage: ReactAgentStage | null;
  completedStages: readonly ReactAgentStage[];
  usablePlanExists: boolean;
  partialPersistence: boolean;
  recommendation: RecoveryRecommendation;
};

type SafeErrorCause = {
  name: "AgentFailure" | "PersistenceFailure" | "ValidationFailure";
  code?: string;
};

type ReactOrchestrationErrorOptions = {
  code: ReactOrchestrationErrorCode;
  metadata: OrchestrationFailureMetadata;
  safeCause?: SafeErrorCause;
  issues?: readonly string[];
};

export type AgentFailureClassification = {
  category: OrchestrationFailureCategory;
  retryable: boolean;
  recommendation: RecoveryRecommendation;
};

const stageFailureCodes: Record<
  ReactAgentStage,
  Readonly<Record<string, AgentFailureClassification>>
> = {
  "risk-assessment": {
    RISK_ASSESSMENT_INPUT_INVALID: {
      category: "INVALID_STATE",
      retryable: false,
      recommendation: "RELOAD_STATE",
    },
    RISK_ASSESSMENT_GEMINI_TIMEOUT: {
      category: "RISK_ASSESSMENT_FAILED",
      retryable: true,
      recommendation: "RETRY_STAGE",
    },
    RISK_ASSESSMENT_GEMINI_REQUEST_ERROR: {
      category: "RISK_ASSESSMENT_FAILED",
      retryable: true,
      recommendation: "RETRY_STAGE",
    },
    RISK_ASSESSMENT_GEMINI_CONFIG_ERROR: {
      category: "RISK_ASSESSMENT_FAILED",
      retryable: false,
      recommendation: "ABORT",
    },
    RISK_ASSESSMENT_INVALID_STRUCTURED_OUTPUT: {
      category: "RISK_ASSESSMENT_FAILED",
      retryable: false,
      recommendation: "ABORT",
    },
    RISK_ASSESSMENT_SCHEMA_VALIDATION_FAILED: {
      category: "RISK_ASSESSMENT_FAILED",
      retryable: false,
      recommendation: "ABORT",
    },
    RISK_ASSESSMENT_FACT_CONFLICT: {
      category: "RISK_ASSESSMENT_FAILED",
      retryable: false,
      recommendation: "RELOAD_STATE",
    },
  },
  "resource-routing": {
    RESOURCE_ROUTING_INPUT_INVALID: {
      category: "INVALID_STATE",
      retryable: false,
      recommendation: "RELOAD_STATE",
    },
    RESOURCE_ROUTING_GEMINI_TIMEOUT: {
      category: "RESOURCE_ROUTING_FAILED",
      retryable: true,
      recommendation: "RETRY_STAGE",
    },
    RESOURCE_ROUTING_GEMINI_REQUEST_ERROR: {
      category: "RESOURCE_ROUTING_FAILED",
      retryable: true,
      recommendation: "RETRY_STAGE",
    },
    RESOURCE_ROUTING_GEMINI_CONFIG_ERROR: {
      category: "RESOURCE_ROUTING_FAILED",
      retryable: false,
      recommendation: "ABORT",
    },
    RESOURCE_ROUTING_INVALID_STRUCTURED_OUTPUT: {
      category: "RESOURCE_ROUTING_FAILED",
      retryable: false,
      recommendation: "ABORT",
    },
    RESOURCE_ROUTING_SCHEMA_VALIDATION_FAILED: {
      category: "RESOURCE_ROUTING_FAILED",
      retryable: false,
      recommendation: "ABORT",
    },
    RESOURCE_ROUTING_FACT_CONFLICT: {
      category: "RESOURCE_ROUTING_FAILED",
      retryable: false,
      recommendation: "RELOAD_STATE",
    },
    RESOURCE_ROUTING_UNKNOWN_RESOURCE: {
      category: "RESOURCE_ROUTING_FAILED",
      retryable: false,
      recommendation: "RELOAD_STATE",
    },
    RESOURCE_ROUTING_UNKNOWN_FACILITY: {
      category: "RESOURCE_ROUTING_FAILED",
      retryable: false,
      recommendation: "RELOAD_STATE",
    },
    RESOURCE_ROUTING_UNKNOWN_ROUTE: {
      category: "RESOURCE_ROUTING_FAILED",
      retryable: false,
      recommendation: "RELOAD_STATE",
    },
    RESOURCE_ROUTING_DUPLICATE_REFERENCE: {
      category: "RESOURCE_ROUTING_FAILED",
      retryable: false,
      recommendation: "ABORT",
    },
  },
  "response-planning": {
    RESPONSE_PLANNING_INPUT_INVALID: {
      category: "INVALID_STATE",
      retryable: false,
      recommendation: "RELOAD_STATE",
    },
    RESPONSE_PLANNING_ASSESSMENT_INVALID: {
      category: "RESPONSE_PLANNING_FAILED",
      retryable: false,
      recommendation: "ABORT",
    },
    RESPONSE_PLANNING_GEMINI_TIMEOUT: {
      category: "RESPONSE_PLANNING_FAILED",
      retryable: true,
      recommendation: "RETRY_STAGE",
    },
    RESPONSE_PLANNING_GEMINI_REQUEST_ERROR: {
      category: "RESPONSE_PLANNING_FAILED",
      retryable: true,
      recommendation: "RETRY_STAGE",
    },
    RESPONSE_PLANNING_GEMINI_CONFIG_ERROR: {
      category: "RESPONSE_PLANNING_FAILED",
      retryable: false,
      recommendation: "ABORT",
    },
    RESPONSE_PLANNING_INVALID_STRUCTURED_OUTPUT: {
      category: "RESPONSE_PLANNING_FAILED",
      retryable: false,
      recommendation: "ABORT",
    },
    RESPONSE_PLANNING_SCHEMA_VALIDATION_FAILED: {
      category: "RESPONSE_PLANNING_FAILED",
      retryable: false,
      recommendation: "ABORT",
    },
    RESPONSE_PLANNING_FACT_CONFLICT: {
      category: "RESPONSE_PLANNING_FAILED",
      retryable: false,
      recommendation: "RELOAD_STATE",
    },
    RESPONSE_PLANNING_OUTPUT_INVALID: {
      category: "RESPONSE_PLANNING_FAILED",
      retryable: false,
      recommendation: "REGENERATE_PLAN",
    },
    RESPONSE_PLANNING_ID_GENERATION_CONFLICT: {
      category: "RESPONSE_PLANNING_FAILED",
      retryable: false,
      recommendation: "ABORT",
    },
    RESPONSE_PLANNING_PRIMARY_PLAN_INVALID: {
      category: "PLAN_VALIDATION_FAILED",
      retryable: false,
      recommendation: "REGENERATE_PLAN",
    },
  },
};

function getSafeAgentCode(
  stage: ReactAgentStage,
  code: string | null,
): string | null {
  if (
    code !== null &&
    Object.prototype.hasOwnProperty.call(stageFailureCodes[stage], code)
  ) {
    return code;
  }
  return null;
}

export function classifyAgentFailure(
  stage: ReactAgentStage,
  code: string | null,
): AgentFailureClassification {
  const safeCode = getSafeAgentCode(stage, code);
  if (safeCode !== null) {
    const classification = stageFailureCodes[stage][safeCode];
    if (classification !== undefined) return classification;
  }
  return {
    category: "UNEXPECTED_ERROR",
    retryable: false,
    recommendation: "ABORT",
  };
}

function metadata(
  overrides: Partial<OrchestrationFailureMetadata> &
    Pick<OrchestrationFailureMetadata, "failureCategory">,
): OrchestrationFailureMetadata {
  const partialPersistence = overrides.partialPersistence ?? false;
  return {
    status:
      overrides.status ??
      (partialPersistence ? "PARTIAL_FAILURE" : "FAILED"),
    failureCategory: overrides.failureCategory,
    retryable: overrides.retryable ?? false,
    failedStage: overrides.failedStage ?? null,
    completedStages: [...(overrides.completedStages ?? [])],
    usablePlanExists: overrides.usablePlanExists ?? false,
    partialPersistence,
    recommendation: overrides.recommendation ?? "ABORT",
  };
}

export class ReactOrchestrationError extends Error {
  readonly code: ReactOrchestrationErrorCode;
  readonly failure: OrchestrationFailureMetadata;
  readonly issues: readonly string[] | undefined;

  constructor(
    message: string,
    { code, metadata: failure, safeCause, issues }: ReactOrchestrationErrorOptions,
  ) {
    super(
      message,
      safeCause === undefined
        ? undefined
        : { cause: Object.freeze({ ...safeCause }) },
    );
    this.name = "ReactOrchestrationError";
    this.code = code;
    this.failure = Object.freeze({
      ...failure,
      completedStages: Object.freeze([...failure.completedStages]),
    });
    this.issues = issues === undefined ? undefined : Object.freeze([...issues]);
  }
}

export class ReactOrchestrationInputError extends ReactOrchestrationError {
  constructor(message: string, issues: readonly string[], cause?: unknown) {
    super(message, {
      code: "ORCHESTRATOR_INPUT_INVALID",
      metadata: metadata({
        failureCategory: "INVALID_STATE",
        recommendation: "RELOAD_STATE",
      }),
      safeCause: {
        name: "ValidationFailure",
        code:
          typeof cause === "object" &&
          cause !== null &&
          "name" in cause &&
          cause.name === "ZodError"
            ? "INVALID_EMERGENCY_STATE_SCHEMA"
            : "INVALID_EMERGENCY_STATE",
      },
      issues,
    });
    this.name = "ReactOrchestrationInputError";
  }
}

export class ReactOrchestrationStageError extends ReactOrchestrationError {
  constructor(
    stage: ReactAgentStage,
    cause: unknown,
    completedStages: readonly ReactAgentStage[] = [],
  ) {
    const candidateCode =
      typeof cause === "object" &&
      cause !== null &&
      "code" in cause &&
      typeof cause.code === "string"
        ? cause.code
        : null;
    const code = getSafeAgentCode(stage, candidateCode);
    const classification = classifyAgentFailure(stage, code);
    super(`REACT orchestration failed during the ${stage} stage.`, {
      code: "ORCHESTRATOR_STAGE_FAILED",
      metadata: metadata({
        failureCategory: classification.category,
        retryable: classification.retryable,
        failedStage: stage,
        completedStages,
        recommendation: classification.recommendation,
      }),
      safeCause: {
        name: "AgentFailure",
        ...(code === null ? {} : { code }),
      },
    });
    this.name = "ReactOrchestrationStageError";
  }
}

export class ReactOrchestrationOutputError extends ReactOrchestrationError {
  constructor(
    message: string,
    issues: readonly string[],
    cause?: unknown,
    options: {
      failureCategory?: OrchestrationFailureCategory;
      failedStage?: ReactAgentStage | null;
      completedStages?: readonly ReactAgentStage[];
      usablePlanExists?: boolean;
      recommendation?: RecoveryRecommendation;
    } = {},
  ) {
    super(message, {
      code: "ORCHESTRATOR_OUTPUT_INVALID",
      metadata: metadata({
        failureCategory: options.failureCategory ?? "UNEXPECTED_ERROR",
        failedStage: options.failedStage ?? "response-planning",
        completedStages: options.completedStages,
        usablePlanExists: options.usablePlanExists,
        recommendation: options.recommendation,
      }),
      safeCause: {
        name: "ValidationFailure",
        code:
          typeof cause === "object" &&
          cause !== null &&
          "name" in cause &&
          cause.name === "ZodError"
            ? "OUTPUT_SCHEMA_VALIDATION_FAILED"
            : "INVALID_ORCHESTRATION_OUTPUT",
      },
      issues,
    });
    this.name = "ReactOrchestrationOutputError";
  }
}

export class ReactOrchestrationPersistenceError extends ReactOrchestrationError {
  readonly operation: OrchestratorPersistenceOperation;
  readonly completedWrites: readonly string[];
  readonly partialWritePossible: boolean;

  constructor(options: {
    message: string;
    operation: OrchestratorPersistenceOperation;
    stage: ReactAgentStage | null;
    cause?: unknown;
    completedWrites: readonly string[];
    partialWritePossible: boolean;
    completedStages?: readonly ReactAgentStage[];
    usablePlanExists?: boolean;
    retryable?: boolean;
    persistenceCode?: string;
  }) {
    const causeDetails =
      typeof options.cause === "object" && options.cause !== null
        ? options.cause
        : undefined;
    const causeCode =
      options.persistenceCode ??
      (causeDetails !== undefined &&
      "code" in causeDetails &&
      typeof causeDetails.code === "string"
        ? causeDetails.code
        : undefined);
    const retryablePersistenceCodes = [
      "08000",
      "08001",
      "08003",
      "08006",
      "40001",
      "40P01",
      "55P03",
    ];
    const causeName =
      causeDetails !== undefined &&
      "name" in causeDetails &&
      (causeDetails.name === "AbortError" ||
        causeDetails.name === "TimeoutError" ||
        causeDetails.name === "FetchError")
        ? causeDetails.name
        : undefined;
    const inferredRetryable =
      (causeCode !== undefined &&
        retryablePersistenceCodes.includes(causeCode)) ||
      causeName !== undefined;
    const retryable = options.retryable ?? inferredRetryable;
    const safePersistenceCode =
      causeCode !== undefined &&
      /^[0-9A-Z]{5}$/.test(causeCode) &&
      retryablePersistenceCodes.includes(causeCode)
        ? causeCode
        : undefined;
    const partialPersistence =
      options.completedWrites.length > 0 || options.partialWritePossible;
    super(options.message, {
      code: "ORCHESTRATOR_PERSISTENCE_FAILED",
      metadata: metadata({
        status: partialPersistence ? "PARTIAL_FAILURE" : "FAILED",
        failureCategory: "PERSISTENCE_FAILED",
        retryable,
        failedStage: options.stage,
        completedStages: options.completedStages,
        usablePlanExists: options.usablePlanExists,
        partialPersistence,
        recommendation: partialPersistence
          ? "REPAIR_PERSISTENCE"
          : retryable
            ? "RETRY_STAGE"
            : "ABORT",
      }),
      safeCause: {
        name: "PersistenceFailure",
        ...(safePersistenceCode === undefined
          ? {}
          : { code: safePersistenceCode }),
      },
    });
    this.name = "ReactOrchestrationPersistenceError";
    this.operation = options.operation;
    this.completedWrites = Object.freeze([...options.completedWrites]);
    this.partialWritePossible = options.partialWritePossible;
  }
}

export class ReactOrchestrationUnexpectedError extends ReactOrchestrationError {
  constructor(completedStages: readonly ReactAgentStage[] = []) {
    super("REACT orchestration failed unexpectedly.", {
      code: "ORCHESTRATOR_UNEXPECTED",
      metadata: metadata({
        failureCategory: "UNEXPECTED_ERROR",
        completedStages,
        recommendation: "ABORT",
      }),
      safeCause: { name: "AgentFailure", code: "UNEXPECTED_ERROR" },
    });
    this.name = "ReactOrchestrationUnexpectedError";
  }
}
