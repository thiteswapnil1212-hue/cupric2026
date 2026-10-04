import assert from "node:assert/strict";
import { getDemoState } from "../src/lib/demo/fixtures";
import {
  GeminiError,
  generateStructuredJsonWithMetadata,
  type GeminiGenerationDependencies,
  type GeminiModel,
} from "../src/lib/ai/gemini";
import { GeminiModelSchema } from "../src/lib/ai/gemini-contract";
import { z } from "zod";
import {
  RiskAssessmentAgentError,
  runRiskAssessment,
} from "../src/lib/agents/risk-assessment/agent";
import {
  ReactOrchestrationStageError,
} from "../src/lib/orchestrator/errors";
import { runReactAgentPipeline } from "../src/lib/orchestrator/pipeline";

const schemaOptions = {
  systemInstruction: "Return a fixture response.",
  input: { input: "fixture" },
  schema: z.object({ answer: z.string() }),
};
const expected = { answer: "ok" };
type MockResponse = Awaited<
  ReturnType<GeminiGenerationDependencies["request"]>
>;

function mockResponse(value: unknown): MockResponse {
  return { text: JSON.stringify(value) } as MockResponse;
}

function providerError(
  status: number,
  message = "private provider response",
): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function requestMock(
  handler: (model: GeminiModel) => Promise<MockResponse>,
  attempted: GeminiModel[],
): GeminiGenerationDependencies {
  return {
    request: async (parameters) => {
      const model = GeminiModelSchema.parse(parameters.model);
      attempted.push(model);
      assert.equal(parameters.config?.httpOptions?.retryOptions?.attempts, 1);
      return handler(model);
    },
  };
}

async function expectGeminiError(
  operation: Promise<unknown>,
  code: GeminiError["code"],
): Promise<GeminiError> {
  let caught: unknown;
  try {
    await operation;
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof GeminiError);
  assert.equal(caught.code, code);
  return caught;
}

async function main(): Promise<void> {
  const models: GeminiModel[] = [
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-2.5-flash",
  ];

  let calls: GeminiModel[] = [];
  let result = await generateStructuredJsonWithMetadata(
    schemaOptions,
    requestMock(async () => mockResponse(expected), calls),
  );
  assert.deepEqual(calls, [models[0]]);
  assert.deepEqual(result.value, expected);
  assert.deepEqual(result.metadata, {
    selectedModel: models[0],
    attemptedModels: [models[0]],
    fallbackUsed: false,
    finalProviderFailure: null,
  });

  calls = [];
  result = await generateStructuredJsonWithMetadata(
    schemaOptions,
    requestMock(async (model) => {
      if (model === models[0]) throw providerError(503);
      return mockResponse(expected);
    }, calls),
  );
  assert.deepEqual(calls, models.slice(0, 2));
  assert.equal(result.metadata.selectedModel, models[1]);
  assert.equal(result.metadata.fallbackUsed, true);

  calls = [];
  result = await generateStructuredJsonWithMetadata(
    schemaOptions,
    requestMock(async (model) => {
      if (model !== models[2]) throw providerError(503);
      return mockResponse(expected);
    }, calls),
  );
  assert.deepEqual(calls, models);
  assert.equal(result.metadata.selectedModel, models[2]);

  calls = [];
  let error = await expectGeminiError(
    generateStructuredJsonWithMetadata(
      schemaOptions,
      requestMock(async () => {
        throw providerError(503);
      }, calls),
    ),
    "GEMINI_AI_UNAVAILABLE",
  );
  assert.deepEqual(calls, models);
  assert.deepEqual(error.metadata?.attemptedModels, models);
  assert.equal(error.metadata?.selectedModel, null);
  assert.equal(error.metadata?.fallbackUsed, true);
  assert.deepEqual(error.metadata?.finalProviderFailure, {
    code: "GEMINI_REQUEST_ERROR",
    category: "PROVIDER_UNAVAILABLE",
    httpStatus: 503,
  });
  const allUnavailableError = error;

  for (const status of [400, 401, 403]) {
    calls = [];
    error = await expectGeminiError(
      generateStructuredJsonWithMetadata(
        schemaOptions,
        requestMock(async () => {
          throw providerError(status);
        }, calls),
      ),
      "GEMINI_AI_UNAVAILABLE",
    );
    assert.deepEqual(calls, models);
    assert.equal(error.metadata?.finalProviderFailure?.httpStatus, status);
    assert.equal(error.metadata?.finalProviderFailure?.category, "PERMANENT");
  }

  calls = [];
  result = await generateStructuredJsonWithMetadata(
    schemaOptions,
    requestMock(async (model) => {
      if (model === models[0]) {
        throw Object.assign(new Error("request timed out"), {
          name: "TimeoutError",
        });
      }
      return mockResponse(expected);
    }, calls),
  );
  assert.deepEqual(calls, models.slice(0, 2));
  assert.equal(result.metadata.selectedModel, models[1]);

  calls = [];
  result = await generateStructuredJsonWithMetadata(
    schemaOptions,
    requestMock(async (model) => {
      if (model === models[0]) throw providerError(429, "model-specific quota exceeded");
      return mockResponse(expected);
    }, calls),
  );
  assert.deepEqual(calls, models.slice(0, 2));
  assert.equal(result.metadata.selectedModel, models[1]);
  assert.deepEqual(result.metadata.modelFailures, [
    {
      model: models[0],
      code: "GEMINI_REQUEST_ERROR",
      category: "RATE_LIMITED",
      httpStatus: 429,
    },
  ]);

  calls = [];
  result = await generateStructuredJsonWithMetadata(
    schemaOptions,
    requestMock(async (model) => {
      if (model === models[0]) throw providerError(503);
      if (model === models[1]) throw providerError(429, "model quota exceeded");
      return mockResponse(expected);
    }, calls),
  );
  assert.deepEqual(calls, models);
  assert.equal(result.metadata.selectedModel, models[2]);
  assert.deepEqual(
    result.metadata.modelFailures?.map(({ model, category }) => ({
      model,
      category,
    })),
    [
      { model: models[0], category: "PROVIDER_UNAVAILABLE" },
      { model: models[1], category: "RATE_LIMITED" },
    ],
  );

  calls = [];
  result = await generateStructuredJsonWithMetadata(
    schemaOptions,
    requestMock(async (model) =>
      model === models[0]
        ? ({ text: "{" } as MockResponse)
        : mockResponse(expected), calls),
  );
  assert.deepEqual(calls, models.slice(0, 2));
  assert.equal(result.metadata.selectedModel, models[1]);
  assert.equal(result.metadata.modelFailures?.[0]?.code, "GEMINI_INVALID_JSON");

  calls = [];
  result = await generateStructuredJsonWithMetadata(
    schemaOptions,
    requestMock(async (model) =>
      model !== models[2]
        ? ({ text: "not-json" } as MockResponse)
        : mockResponse(expected), calls),
  );
  assert.deepEqual(calls, models);
  assert.equal(result.metadata.selectedModel, models[2]);

  calls = [];
  error = await expectGeminiError(
    generateStructuredJsonWithMetadata(
      schemaOptions,
      requestMock(async () => ({ text: "{" } as MockResponse), calls),
    ),
    "GEMINI_INVALID_JSON",
  );
  assert.deepEqual(calls, models);
  assert.deepEqual(error.metadata?.attemptedModels, models);
  assert.equal(error.metadata?.modelFailures?.length, 3);
  assert.equal(error.metadata?.finalProviderFailure?.category, "PERMANENT");

  calls = [];
  error = await expectGeminiError(
    generateStructuredJsonWithMetadata(
      schemaOptions,
      requestMock(
        async () => {
          throw providerError(
            429,
            "Project-wide quota exhausted; all models are blocked.",
          );
        },
        calls,
      ),
    ),
    "GEMINI_AI_UNAVAILABLE",
  );
  assert.deepEqual(calls, [models[0]]);
  assert.equal(
    error.metadata?.finalProviderFailure?.category,
    "PROJECT_QUOTA_EXHAUSTED",
  );
  assert.equal(
    error.metadata?.modelFailures?.[0]?.category,
    "PROJECT_QUOTA_EXHAUSTED",
  );

  calls = [];
  error = await expectGeminiError(
    generateStructuredJsonWithMetadata(
      schemaOptions,
      requestMock(async () => {
        throw Object.assign(new Error("RESOURCE_EXHAUSTED"), {
          status: 429,
          error: {
            details: [
              {
                quotaId: "GenerateRequestsPerDayPerProject",
                quotaDimensions: { location: "global" },
              },
            ],
          },
        });
      }, calls),
    ),
    "GEMINI_AI_UNAVAILABLE",
  );
  assert.deepEqual(calls, [models[0]]);
  assert.equal(
    error.metadata?.finalProviderFailure?.category,
    "PROJECT_QUOTA_EXHAUSTED",
  );

  const fakeSecret = "AIzaSyDUMMY_FIXTURE_SECRET_NEVER_LOG";
  calls = [];
  error = await expectGeminiError(
    generateStructuredJsonWithMetadata(
      schemaOptions,
      requestMock(async () => {
        throw providerError(503, `provider failure ${fakeSecret}`);
      }, calls),
    ),
    "GEMINI_AI_UNAVAILABLE",
  );
  assert.deepEqual(calls, models);
  assert.equal(JSON.stringify(error).includes(fakeSecret), false);
  assert.equal(error.message.includes(fakeSecret), false);

  calls = [];
  result = await generateStructuredJsonWithMetadata(
    schemaOptions,
    requestMock(async (model) => {
      if (model === models[0]) {
        throw Object.assign(new Error("temporary network failure"), {
          cause: { code: "EAI_AGAIN" },
        });
      }
      return mockResponse(expected);
    }, calls),
  );
  assert.deepEqual(calls, models.slice(0, 2));
  assert.equal(result.metadata.selectedModel, models[1]);

  calls = [];
  error = await expectGeminiError(
    generateStructuredJsonWithMetadata(
      schemaOptions,
      requestMock(async () => mockResponse({ answer: 42 }), calls),
    ),
    "GEMINI_SCHEMA_VALIDATION_FAILED",
  );
  assert.deepEqual(calls, models);
  assert.equal(error.metadata?.fallbackUsed, true);

  const emergencyState = getDemoState("initial").state;
  const agentFailure = allUnavailableError;
  let agentError: unknown;
  try {
    await runRiskAssessment(emergencyState, {
      generateStructuredJson: async () => {
        throw agentFailure;
      },
    });
  } catch (caught) {
    agentError = caught;
  }
  assert.ok(agentError instanceof RiskAssessmentAgentError);
  assert.equal(agentError.code, "RISK_ASSESSMENT_GEMINI_UNAVAILABLE");

  const callsToLaterStages: string[] = [];
  const pipeline = await runReactAgentPipeline(emergencyState, {
    riskAssessment: async () => {
      throw agentError;
    },
    resourceRouting: async () => {
      callsToLaterStages.push("resource-routing");
      throw new Error("must not be called");
    },
    responsePlanning: async () => {
      callsToLaterStages.push("response-planning");
      throw new Error("must not be called");
    },
  });
  assert.equal(pipeline.success, false);
  assert.deepEqual(callsToLaterStages, []);
  if (pipeline.success) throw new Error("Expected typed pipeline failure.");
  const orchestrationFailure = new ReactOrchestrationStageError(
    pipeline.failure.stage,
    pipeline.failure.cause,
    pipeline.failure.completedStages,
  );
  assert.equal(orchestrationFailure.failure.usablePlanExists, false);
  assert.equal(orchestrationFailure.failure.retryable, true);
  assert.deepEqual(
    orchestrationFailure.failure.geminiGeneration?.attemptedModels,
    models,
  );
  assert.deepEqual(orchestrationFailure.cause, {
    name: "AgentFailure",
    code: "RISK_ASSESSMENT_GEMINI_UNAVAILABLE",
  });

  console.log("Gemini model fallback fixture passed.");
}

void main();
