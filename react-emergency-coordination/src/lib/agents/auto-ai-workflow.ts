import "server-only";

import type { EmergencyState } from "../../domain/emergency-state/schema";
import {
  GeminiFailureCategorySchema,
  type GeminiFailureCategory,
  type GeminiGenerationMetadata,
  type GeminiModel,
} from "../ai/gemini-contract";
import { generateStructuredJson } from "../ai/gemini";
import {
  runResourceRoutingAssessment,
  type ResourceRoutingAgentDependencies,
} from "./resource-routing/agent";
import type { ResourceRoutingAssessment } from "./resource-routing/schema";
import {
  runRiskAssessment,
  type RiskAssessmentAgentDependencies,
} from "./risk-assessment/agent";
import type { RiskAssessment } from "./risk-assessment/schema";
import {
  runResponsePlanning,
  type ResponsePlanningAgentDependencies,
  type ResponsePlanningResult,
} from "./response-planning/agent";
import {
  createDeterministicAssessments,
  createDeterministicFallbackPlan,
} from "./deterministic-fallback";
import type { AutoAiWorkflowResult } from "./auto-ai-workflow-contract";

export type { AutoAiWorkflowResult } from "./auto-ai-workflow-contract";

export type AutoAiWorkflowDependencies = {
  riskAssessment: (
    state: EmergencyState,
    onMetadata: (metadata: GeminiGenerationMetadata) => void,
  ) => Promise<RiskAssessment>;
  resourceRouting: (
    state: EmergencyState,
    onMetadata: (metadata: GeminiGenerationMetadata) => void,
  ) => Promise<ResourceRoutingAssessment>;
  responsePlanning: (
    state: EmergencyState,
    risk: RiskAssessment,
    routing: ResourceRoutingAssessment,
    planId: string,
    onMetadata: (metadata: GeminiGenerationMetadata) => void,
  ) => Promise<ResponsePlanningResult>;
};

const defaultDependencies: AutoAiWorkflowDependencies = {
  riskAssessment: (state, onMetadata) =>
    runRiskAssessment(state, {
      generateStructuredJson,
      onGenerationMetadata: onMetadata,
    } satisfies RiskAssessmentAgentDependencies),
  resourceRouting: (state, onMetadata) =>
    runResourceRoutingAssessment(state, {
      generateStructuredJson,
      onGenerationMetadata: onMetadata,
    } satisfies ResourceRoutingAgentDependencies),
  responsePlanning: (state, risk, routing, planId, onMetadata) =>
    runResponsePlanning(state, risk, routing, {
      planId,
      generateStructuredJson,
      onGenerationMetadata: onMetadata,
    } satisfies ResponsePlanningAgentDependencies),
};

function isAiGenerationFailure(error: unknown): boolean {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    typeof error.code !== "string"
  ) {
    return false;
  }
  const code = error.code;
  return (
    (code.startsWith("RISK_ASSESSMENT_") && code !== "RISK_ASSESSMENT_INPUT_INVALID") ||
    (code.startsWith("RESOURCE_ROUTING_") &&
      code !== "RESOURCE_ROUTING_INPUT_INVALID") ||
    (code.startsWith("RESPONSE_PLANNING_") &&
      code !== "RESPONSE_PLANNING_INPUT_INVALID")
  );
}

function safeFailureMetadata(error: unknown): {
  category: GeminiFailureCategory | null;
  models: readonly GeminiModel[];
} {
  const generation =
    typeof error === "object" && error !== null && "geminiGeneration" in error
      ? error.geminiGeneration
      : typeof error === "object" && error !== null && "metadata" in error
        ? error.metadata
        : undefined;
  if (
    typeof generation === "object" &&
    generation !== null &&
    "attemptedModels" in generation &&
    Array.isArray(generation.attemptedModels)
  ) {
    const finalFailure =
      "finalProviderFailure" in generation
        ? generation.finalProviderFailure
        : undefined;
    const category =
      typeof finalFailure === "object" &&
      finalFailure !== null &&
      "category" in finalFailure &&
      GeminiFailureCategorySchema.safeParse(finalFailure.category).success
        ? GeminiFailureCategorySchema.parse(finalFailure.category)
        : null;
    return {
      category,
      models: generation.attemptedModels as GeminiModel[],
    };
  }
  return {
    category:
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string" &&
      error.code.endsWith("_TIMEOUT")
        ? "TIMEOUT"
        : "PERMANENT",
    models: [],
  };
}

export async function runAutoAiWorkflow(
  state: EmergencyState,
  planId: string,
  dependencies: AutoAiWorkflowDependencies = defaultDependencies,
): Promise<AutoAiWorkflowResult> {
  const generationMetadata: GeminiGenerationMetadata[] = [];
  const collectMetadata = (metadata: GeminiGenerationMetadata) => {
    generationMetadata.push(metadata);
  };
  try {
    const riskAssessment = await dependencies.riskAssessment(
      state,
      collectMetadata,
    );
    const resourceRoutingAssessment = await dependencies.resourceRouting(
      state,
      collectMetadata,
    );
    const responsePlanningResult = await dependencies.responsePlanning(
      state,
      riskAssessment,
      resourceRoutingAssessment,
      planId,
      collectMetadata,
    );
    const attemptedModels = generationMetadata.flatMap(
      (metadata) => metadata.attemptedModels,
    );
    const selectedModel =
      generationMetadata.at(-1)?.selectedModel ??
      responsePlanningResult.generation?.selectedModel ??
      null;
    return {
      riskAssessment,
      resourceRoutingAssessment,
      responsePlanningResult: {
        ...responsePlanningResult,
        generation: {
          aiAttempted: true,
          modelsAttempted:
            attemptedModels.length > 0
              ? attemptedModels
              : responsePlanningResult.generation?.modelsAttempted ?? [],
          selectedModel,
          failureCategory: null,
          fallbackActivated: false,
          fallbackValidation: null,
        },
      },
    };
  } catch (error) {
    if (!isAiGenerationFailure(error)) throw error;
    const failure = safeFailureMetadata(error);
    const attemptedModels = [
      ...new Set([
        ...generationMetadata.flatMap((metadata) => metadata.attemptedModels),
        ...failure.models,
      ]),
    ];
    const assessments = createDeterministicAssessments(state);
    const responsePlanningResult = createDeterministicFallbackPlan(
      state,
      planId,
      assessments,
      {
        modelsAttempted: attemptedModels,
        failureCategory: failure.category,
      },
    );
    return {
      ...assessments,
      responsePlanningResult,
    };
  }
}
