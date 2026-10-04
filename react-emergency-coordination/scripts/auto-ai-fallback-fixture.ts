import assert from "node:assert/strict";
import { z } from "zod";
import {
  createDeterministicAssessments,
  DeterministicFallbackError,
} from "../src/lib/agents/deterministic-fallback";
import { runResponsePlanning } from "../src/lib/agents/response-planning/agent";
import {
  type ResponsePlanningOutput,
  ResponsePlanningOutputSchema,
} from "../src/lib/agents/response-planning/schema";
import {
  runAutoAiWorkflow,
  type AutoAiWorkflowDependencies,
} from "../src/lib/agents/auto-ai-workflow";
import {
  generateStructuredJson,
  generateStructuredJsonWithMetadata,
  GeminiError,
  type GenerateStructuredJsonOptions,
  type GeminiGenerationDependencies,
} from "../src/lib/ai/gemini";
import {
  GeminiModelSchema,
  type GeminiGenerationMetadata,
  type GeminiModel,
} from "../src/lib/ai/gemini-contract";
import { getDemoState } from "../src/lib/demo/fixtures";
import { createDemoController } from "../src/lib/demo/controller";
import { submitPlanForApproval } from "../src/lib/human-approval/plan-approval";
import { responsePlanSourceLabel } from "../src/components/react/data/view-model";
import { decodePlanSource, encodePlanSource } from "../src/lib/supabase/plan-source";
import { POST as handleAiWorkflowRequest } from "../src/app/api/demo/ai-workflow/route";

async function main() {
const initial = getDemoState("initial").state;
const assessments = createDeterministicAssessments(initial);
const clientKeyRequest = await handleAiWorkflowRequest(
  new Request("http://localhost/api/demo/ai-workflow", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      planId: "PLAN-900",
      state: initial,
      apiKey: "must-not-be-accepted",
      model: "arbitrary-client-model",
    }),
  }),
);
assert.equal(clientKeyRequest.status, 400);
const oversizedRequest = await handleAiWorkflowRequest(
  new Request("http://localhost/api/demo/ai-workflow", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      planId: "PLAN-900",
      state: initial,
      padding: "x".repeat(256 * 1024),
    }),
  }),
);
assert.equal(oversizedRequest.status, 413);
assert.equal(responsePlanSourceLabel(undefined), "SOURCE UNAVAILABLE");
assert.notEqual(responsePlanSourceLabel(undefined), "AI RECOMMENDATION");
assert.equal(responsePlanSourceLabel("DETERMINISTIC_FALLBACK"), "DETERMINISTIC FALLBACK");
for (const source of ["GEMINI", "DETERMINISTIC_FALLBACK", "UNKNOWN"] as const) {
  const encoded = encodePlanSource("source-safe rationale", source);
  assert.deepEqual(decodePlanSource(encoded), {
    rationale: "source-safe rationale",
    source,
  });
}
assert.deepEqual(decodePlanSource("legacy plan without provenance"), {
  rationale: "legacy plan without provenance",
  source: "UNKNOWN",
});
const rescueTeam = initial.resources.find(
  (resource) => resource.id === "RES-RT-02",
);
const primaryAmbulance = initial.resources.find(
  (resource) => resource.id === "RES-AMB-01",
);
const alternateAmbulance = initial.resources.find(
  (resource) => resource.id === "RES-AMB-02",
);
const primaryRoute = initial.routes.find((route) => route.id === "R1");
const alternateRoute = initial.routes.find((route) => route.id === "R2");
const facilityRoute = initial.routes.find((route) => route.id === "R3");
const receivingFacility = initial.facilities.find(
  (facility) => facility.id === "FAC-HOSP-B",
);
assert.ok(rescueTeam);
assert.ok(primaryAmbulance);
assert.ok(alternateAmbulance);
assert.ok(primaryRoute);
assert.ok(alternateRoute);
assert.ok(facilityRoute);
assert.ok(receivingFacility);
const incidentTarget = {
  latitude: initial.incident.location.latitude,
  longitude: initial.incident.location.longitude,
};
let mockAiGeneratorCalled = false;
const mockAiProposal: ResponsePlanningOutput = ResponsePlanningOutputSchema.parse({
  primaryPlan: {
    summary: "Mock AI recommendation based on the supplied emergency state.",
    rationale: "Dispatch a rescue team and ambulance, then allocate reachable capacity.",
    priority: "URGENT",
    actions: [
      {
        sequence: 1,
        type: "DISPATCH_RESOURCE",
        description: `Dispatch ${rescueTeam.name} via ${alternateRoute.name}.`,
        priority: "URGENT",
        resourceIds: [rescueTeam.id],
        facilityIds: [],
        routeIds: [alternateRoute.id],
        capacityDemand: null,
        targetLocation: incidentTarget,
        estimatedDurationMinutes: alternateRoute.estimatedTravelMinutes,
      },
      {
        sequence: 2,
        type: "DISPATCH_RESOURCE",
        description: `Dispatch ${primaryAmbulance.name} via ${primaryRoute.name}.`,
        priority: "URGENT",
        resourceIds: [primaryAmbulance.id],
        facilityIds: [],
        routeIds: [primaryRoute.id],
        capacityDemand: null,
        targetLocation: incidentTarget,
        estimatedDurationMinutes: primaryRoute.estimatedTravelMinutes,
      },
      {
        sequence: 3,
        type: "NOTIFY_FACILITY",
        description: `Allocate recorded capacity at ${receivingFacility.name}.`,
        priority: "HIGH",
        resourceIds: [],
        facilityIds: [receivingFacility.id],
        routeIds: [facilityRoute.id],
        capacityDemand: receivingFacility.availableCapacity,
        targetLocation: {
          latitude: receivingFacility.location.latitude,
          longitude: receivingFacility.location.longitude,
        },
        estimatedDurationMinutes: facilityRoute.estimatedTravelMinutes,
      },
    ],
  },
  alternatives: [
    {
      summary: `Use ${alternateAmbulance.name} via ${alternateRoute.name}.`,
      rationale: "This pairing uses a currently available ambulance and an open route with matching endpoints.",
      resourceIds: [alternateAmbulance.id],
      facilityIds: [],
      routeIds: [alternateRoute.id],
    },
  ],
  constraints: ["Only recorded facility capacity connected by an open route is allocated."],
  reasoning: "Mocked structured AI output; no provider request is made.",
  confidence: 1,
});
const mockAiGenerator: typeof generateStructuredJson =
  async <T>(options: GenerateStructuredJsonOptions<T>): Promise<T> => {
    mockAiGeneratorCalled = true;
    return options.schema.parse(mockAiProposal);
  };
const aiResult = await runResponsePlanning(
  initial,
  assessments.riskAssessment,
  assessments.resourceRoutingAssessment,
  { planId: "PLAN-900", generateStructuredJson: mockAiGenerator },
);
assert.equal(mockAiGeneratorCalled, true);
assert.equal(aiResult.plan.source, "GEMINI");
assert.equal(aiResult.plan.id, "PLAN-900");
assert.equal(aiResult.plan.incidentId, initial.incident.id);
assert.equal(aiResult.plan.stateVersion, initial.stateVersion);
assert.equal(aiResult.plan.priority, "URGENT");
assert.equal(aiResult.validation.valid, true);
assert.equal(aiResult.actions.length, 3);
assert.equal(aiResult.alternatives.length, 1);
assert.deepEqual(aiResult.plan.dependencies.resourceIds, [
  primaryAmbulance.id,
  rescueTeam.id,
]);
assert.deepEqual(aiResult.plan.dependencies.facilityIds, [receivingFacility.id]);
assert.deepEqual(aiResult.plan.dependencies.routeIds, [
  primaryRoute.id,
  alternateRoute.id,
  facilityRoute.id,
]);
assert.match(aiResult.plan.rationale, /CRITICAL severity, risk priority 5, 35 affected people/);
assert.match(aiResult.plan.rationale, /25 remain without a verified facility allocation/);
assert.match(aiResult.constraints.join(" "), /25 remain without a verified facility allocation/);

async function planWithModelFallback(
  planId: string,
  failures: Partial<Record<GeminiModel, number>>,
): Promise<{ modelCalls: GeminiModel[]; result: Awaited<ReturnType<typeof runResponsePlanning>> }> {
  const modelCalls: GeminiModel[] = [];
  const result = await runResponsePlanning(
    initial,
    assessments.riskAssessment,
    assessments.resourceRoutingAssessment,
    {
      planId,
      generateStructuredJson: async <T>(
        options: GenerateStructuredJsonOptions<T>,
      ): Promise<T> => {
        const generated = await generateStructuredJsonWithMetadata(
          options,
          {
            request: async (parameters) => {
              const model = GeminiModelSchema.parse(parameters.model);
              modelCalls.push(model);
              const status = failures[model];
              if (status !== undefined) {
                throw Object.assign(new Error("sanitized fixture provider failure"), {
                  status,
                });
              }
              return {
                text: JSON.stringify(mockAiProposal),
              } as Awaited<ReturnType<GeminiGenerationDependencies["request"]>>;
            },
          },
        );
        options.onMetadata?.(generated.metadata);
        return generated.value;
      },
    },
  );
  return { modelCalls, result };
}

const model37Plan = await planWithModelFallback("PLAN-937", {
  "gemini-3.8-flash": 429,
});
assert.deepEqual(model37Plan.modelCalls, ["gemini-3.8-flash", "gemini-3.7-flash"]);
assert.equal(model37Plan.result.plan.source, "GEMINI");
assert.equal(model37Plan.result.generation?.selectedModel, "gemini-3.7-flash");

const model25Plan = await planWithModelFallback("PLAN-925", {
  "gemini-3.8-flash": 503,
  "gemini-3.7-flash": 429,
});
assert.deepEqual(model25Plan.modelCalls, [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-2.5-flash",
]);
assert.equal(model25Plan.result.plan.source, "GEMINI");
assert.equal(model25Plan.result.generation?.selectedModel, "gemini-2.5-flash");

async function expectPlanningFailure(
  proposal: ResponsePlanningOutput,
  expectedCode: string,
): Promise<void> {
  await assert.rejects(
    runResponsePlanning(
      initial,
      assessments.riskAssessment,
      assessments.resourceRoutingAssessment,
      {
        planId: "PLAN-901",
        generateStructuredJson: async <T>(options: GenerateStructuredJsonOptions<T>) =>
          options.schema.parse(proposal),
      },
    ),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === expectedCode,
  );
}

await expectPlanningFailure(
  {
    ...mockAiProposal,
    primaryPlan: {
      ...mockAiProposal.primaryPlan,
      actions: mockAiProposal.primaryPlan.actions.slice(0, 1),
    },
  },
  "RESPONSE_PLANNING_PRIMARY_PLAN_INVALID",
);
await expectPlanningFailure(
  {
    ...mockAiProposal,
    primaryPlan: {
      ...mockAiProposal.primaryPlan,
      actions: mockAiProposal.primaryPlan.actions.map((action, index) =>
        index === 1 ? { ...action, resourceIds: ["UNKNOWN-RESOURCE"] } : action,
      ),
    },
  },
  "RESPONSE_PLANNING_OUTPUT_INVALID",
);
await expectPlanningFailure(
  {
    ...mockAiProposal,
    primaryPlan: {
      ...mockAiProposal.primaryPlan,
      actions: mockAiProposal.primaryPlan.actions.map((action, index) =>
        index === 0 ? { ...action, routeIds: ["UNKNOWN-ROUTE"] } : action,
      ),
    },
  },
  "RESPONSE_PLANNING_OUTPUT_INVALID",
);
await expectPlanningFailure(
  {
    ...mockAiProposal,
    primaryPlan: {
      ...mockAiProposal.primaryPlan,
      actions: mockAiProposal.primaryPlan.actions.map((action, index) =>
        index === 2 ? { ...action, capacityDemand: receivingFacility.availableCapacity + 1 } : action,
      ),
    },
  },
  "RESPONSE_PLANNING_PRIMARY_PLAN_INVALID",
);
await expectPlanningFailure(
  { ...mockAiProposal, constraints: [] },
  "RESPONSE_PLANNING_PRIMARY_PLAN_INVALID",
);
await expectPlanningFailure(
  {
    ...mockAiProposal,
    primaryPlan: { ...mockAiProposal.primaryPlan, priority: "HIGH" },
  },
  "RESPONSE_PLANNING_PRIMARY_PLAN_INVALID",
);
const successfulMetadata: GeminiGenerationMetadata = {
  selectedModel: "gemini-3.8-flash",
  attemptedModels: ["gemini-3.8-flash"],
  fallbackUsed: false,
  finalProviderFailure: null,
};

function mockDependencies(
  overrides: Partial<AutoAiWorkflowDependencies> = {},
): AutoAiWorkflowDependencies {
  return {
    riskAssessment: async (_state, onMetadata) => {
      onMetadata(successfulMetadata);
      return assessments.riskAssessment;
    },
    resourceRouting: async (_state, onMetadata) => {
      onMetadata(successfulMetadata);
      return assessments.resourceRoutingAssessment;
    },
    responsePlanning: async (_state, _risk, _routing, _planId, onMetadata) => {
      onMetadata(successfulMetadata);
      return aiResult;
    },
    ...overrides,
  };
}

function unavailableError(
  category:
    | "RATE_LIMITED"
    | "PROJECT_QUOTA_EXHAUSTED"
    | "PROVIDER_UNAVAILABLE",
  attemptedModels: GeminiGenerationMetadata["attemptedModels"],
): Error & {
  code: string;
  geminiGeneration: GeminiGenerationMetadata;
} {
  const geminiGeneration: GeminiGenerationMetadata = {
    selectedModel: null,
    attemptedModels: [...attemptedModels],
    fallbackUsed: attemptedModels.length > 1,
    finalProviderFailure: {
      code: "GEMINI_AI_UNAVAILABLE",
      category,
      httpStatus:
        category === "RATE_LIMITED" ||
        category === "PROJECT_QUOTA_EXHAUSTED"
          ? 429
          : 503,
    },
  };
  return Object.assign(new Error("sanitized"), {
    code: "RISK_ASSESSMENT_GEMINI_UNAVAILABLE",
    geminiGeneration,
  });
}

const geminiSchema = z.object({ ok: z.boolean() });
const rateLimitModels: string[] = [];
await assert.rejects(
  generateStructuredJsonWithMetadata(
    { systemInstruction: "test", input: {}, schema: geminiSchema },
    {
      request: async (parameters) => {
        rateLimitModels.push(parameters.model);
        throw Object.assign(new Error("quota"), { status: 429 });
      },
    },
  ),
  (error: unknown) =>
    error instanceof GeminiError &&
    error.code === "GEMINI_AI_UNAVAILABLE" &&
    error.metadata?.finalProviderFailure?.category === "RATE_LIMITED",
);
assert.deepEqual(rateLimitModels, [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-2.5-flash",
]);

const serviceUnavailableModels: string[] = [];
await assert.rejects(
  generateStructuredJsonWithMetadata(
    { systemInstruction: "test", input: {}, schema: geminiSchema },
    {
      request: async (parameters) => {
        serviceUnavailableModels.push(parameters.model);
        throw Object.assign(new Error("unavailable"), { status: 503 });
      },
    },
  ),
  (error: unknown) =>
    error instanceof GeminiError &&
    error.code === "GEMINI_AI_UNAVAILABLE" &&
    error.metadata?.finalProviderFailure?.category === "PROVIDER_UNAVAILABLE",
);
assert.deepEqual(serviceUnavailableModels, [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-2.5-flash",
]);

const timeoutModels: string[] = [];
await assert.rejects(
  generateStructuredJsonWithMetadata(
    { systemInstruction: "test", input: {}, schema: geminiSchema },
    {
      request: async (parameters) => {
        timeoutModels.push(parameters.model);
        throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
      },
    },
  ),
  (error: unknown) =>
    error instanceof GeminiError &&
    error.code === "GEMINI_AI_UNAVAILABLE" &&
    error.metadata?.finalProviderFailure?.category === "TIMEOUT",
);
assert.deepEqual(timeoutModels, [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-2.5-flash",
]);

const successCalls: string[] = [];
const success = await runAutoAiWorkflow(
  initial,
  "PLAN-900",
  mockDependencies({
    riskAssessment: async (state, onMetadata) => {
      successCalls.push("risk");
      return mockDependencies().riskAssessment(state, onMetadata);
    },
    resourceRouting: async (state, onMetadata) => {
      successCalls.push("routing");
      return mockDependencies().resourceRouting(state, onMetadata);
    },
    responsePlanning: async (state, risk, routing, planId, onMetadata) => {
      successCalls.push("planning");
      return mockDependencies().responsePlanning(
        state,
        risk,
        routing,
        planId,
        onMetadata,
      );
    },
  }),
);
assert.deepEqual(successCalls, ["risk", "routing", "planning"]);
assert.equal(success.responsePlanningResult.plan.source, "GEMINI");
assert.equal(success.responsePlanningResult.generation?.fallbackActivated, false);
const aiApproval = submitPlanForApproval(success.responsePlanningResult.plan);
assert.equal(aiApproval.success, true);
if (aiApproval.success) assert.equal(aiApproval.plan.status, "PENDING_APPROVAL");

const quota = await runAutoAiWorkflow(
  initial,
  "PLAN-001",
  mockDependencies({
    riskAssessment: async () => {
      throw unavailableError("RATE_LIMITED", [
        "gemini-3.8-flash",
        "gemini-3.7-flash",
        "gemini-2.5-flash",
      ]);
    },
  }),
);
assert.equal(quota.responsePlanningResult.plan.source, "DETERMINISTIC_FALLBACK");
assert.equal(quota.responsePlanningResult.generation?.failureCategory, "RATE_LIMITED");
assert.deepEqual(quota.responsePlanningResult.generation?.modelsAttempted, [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-2.5-flash",
]);
assert.equal(quota.responsePlanningResult.validation.valid, true);
const quotaApproval = submitPlanForApproval(quota.responsePlanningResult.plan);
assert.equal(quotaApproval.success, true);
if (quotaApproval.success) assert.equal(quotaApproval.plan.status, "PENDING_APPROVAL");
assert.equal(responsePlanSourceLabel(quota.responsePlanningResult.plan.source), "DETERMINISTIC FALLBACK");

const projectQuota = await runAutoAiWorkflow(
  initial,
  "PLAN-001",
  mockDependencies({
    riskAssessment: async () => {
      throw unavailableError("PROJECT_QUOTA_EXHAUSTED", ["gemini-3.8-flash"]);
    },
  }),
);
assert.equal(
  projectQuota.responsePlanningResult.plan.source,
  "DETERMINISTIC_FALLBACK",
);
assert.equal(
  projectQuota.responsePlanningResult.generation?.failureCategory,
  "PROJECT_QUOTA_EXHAUSTED",
);
assert.deepEqual(
  projectQuota.responsePlanningResult.generation?.modelsAttempted,
  ["gemini-3.8-flash"],
);
assert.equal(projectQuota.responsePlanningResult.validation.valid, true);

const providerUnavailable = await runAutoAiWorkflow(
  initial,
  "PLAN-001",
  mockDependencies({
    riskAssessment: async () => {
      throw unavailableError("PROVIDER_UNAVAILABLE", [
        "gemini-3.8-flash",
        "gemini-3.7-flash",
        "gemini-2.5-flash",
      ]);
    },
  }),
);
assert.equal(
  providerUnavailable.responsePlanningResult.generation?.modelsAttempted.length,
  3,
);
assert.equal(providerUnavailable.responsePlanningResult.validation.valid, true);
assert.equal(
  providerUnavailable.responsePlanningResult.plan.source,
  "DETERMINISTIC_FALLBACK",
);

const invalidStructuredOutput = await runAutoAiWorkflow(
  initial,
  "PLAN-001",
  mockDependencies({
    responsePlanning: async () => {
      throw Object.assign(new Error("invalid structured output"), {
        code: "RESPONSE_PLANNING_SCHEMA_VALIDATION_FAILED",
        geminiGeneration: {
          selectedModel: null,
          attemptedModels: [
            "gemini-3.8-flash",
            "gemini-3.7-flash",
            "gemini-2.5-flash",
          ],
          fallbackUsed: true,
          finalProviderFailure: {
            code: "GEMINI_INVALID_JSON",
            category: "PERMANENT",
          },
        } satisfies GeminiGenerationMetadata,
      });
    },
  }),
);
assert.equal(
  invalidStructuredOutput.responsePlanningResult.plan.source,
  "DETERMINISTIC_FALLBACK",
);
assert.equal(invalidStructuredOutput.responsePlanningResult.validation.valid, true);
assert.deepEqual(
  invalidStructuredOutput.responsePlanningResult.generation?.modelsAttempted,
  ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-2.5-flash"],
);

const noRouteState = { ...initial, routes: [] };
await assert.rejects(
  runAutoAiWorkflow(
    noRouteState,
    "PLAN-001",
    mockDependencies({
      riskAssessment: async () => {
        throw unavailableError("RATE_LIMITED", ["gemini-3.8-flash"]);
      },
    }),
  ),
  DeterministicFallbackError,
);

const incompatibleFirstResourceState = {
  ...initial,
  resources: initial.resources.map((resource) =>
    resource.id === "RES-AMB-01"
      ? { ...resource, capabilities: ["Unrelated capability"] }
      : resource,
  ),
  routes: [
    ...initial.routes,
    {
      ...initial.routes[0],
      id: "R0",
      name: "Rescue access route",
      origin: initial.resources[0].location,
      estimatedTravelMinutes: 7,
    },
  ],
};
const compatibleAlternative = await runAutoAiWorkflow(
  incompatibleFirstResourceState,
  "PLAN-901",
  mockDependencies({
    riskAssessment: async () => {
      throw unavailableError("RATE_LIMITED", ["gemini-3.8-flash"]);
    },
  }),
);
assert.deepEqual(
  compatibleAlternative.responsePlanningResult.plan.dependencies.resourceIds,
  ["RES-RT-01"],
);
assert.equal(
  compatibleAlternative.responsePlanningResult.plan.dependencies.routeIds[0],
  "R0",
);

const disconnectedRouteState = {
  ...initial,
  routes: initial.routes.map((route) =>
    route.id === "R1" || route.id === "R2" || route.id === "R3"
      ? { ...route, origin: { latitude: 18.6, longitude: 73.9 } }
      : route,
  ),
};
await assert.rejects(
  runAutoAiWorkflow(
    disconnectedRouteState,
    "PLAN-902",
    mockDependencies({
      riskAssessment: async () => {
        throw unavailableError("RATE_LIMITED", ["gemini-3.8-flash"]);
      },
    }),
  ),
  DeterministicFallbackError,
);

const medicalState = {
  ...initial,
  incident: { ...initial.incident, type: "MEDICAL" as const },
  activePlan: null,
  resources: initial.resources.map((resource) => ({
    ...resource,
    status: "OUT_OF_SERVICE" as const,
    currentAssignmentId: null,
  })),
  facilities: initial.facilities.map((facility) =>
    facility.id === "FAC-HOSP-A"
      ? { ...facility, availableCapacity: 0 }
      : facility,
  ),
  routes: initial.facilities.map((facility, index) => ({
    ...initial.routes[0],
    id: `MED-${index + 1}`,
    name: `Incident to ${facility.name}`,
    origin: {
      latitude: initial.incident.location.latitude,
      longitude: initial.incident.location.longitude,
    },
    destination: {
      latitude: facility.location.latitude,
      longitude: facility.location.longitude,
    },
  })),
};
const capacityAlternative = await runAutoAiWorkflow(
  medicalState,
  "PLAN-903",
  mockDependencies({
    riskAssessment: async () => {
      throw unavailableError("RATE_LIMITED", ["gemini-3.8-flash"]);
    },
  }),
);
assert.deepEqual(
  capacityAlternative.responsePlanningResult.plan.dependencies.facilityIds,
  ["FAC-HOSP-B"],
);
assert.deepEqual(
  capacityAlternative.responsePlanningResult.plan.dependencies.routeIds,
  ["MED-2"],
);
await assert.rejects(
  runAutoAiWorkflow(
    {
      ...medicalState,
      facilities: medicalState.facilities.map((facility) => ({
        ...facility,
        availableCapacity: 0,
      })),
    },
    "PLAN-904",
    mockDependencies({
      riskAssessment: async () => {
        throw unavailableError("RATE_LIMITED", ["gemini-3.8-flash"]);
      },
    }),
  ),
  DeterministicFallbackError,
);

const initialForReplan = getDemoState("initial").state;
const initialPrimaryRoute = initialForReplan.routes.find((route) => route.id === "R1");
const initialAlternateRoute = initialForReplan.routes.find((route) => route.id === "R2");
const northRescueTeam = initialForReplan.resources.find(
  (resource) => resource.id === "RES-RT-02",
);
const northAmbulance = initialForReplan.resources.find(
  (resource) => resource.id === "RES-AMB-02",
);
const hospitalB = initialForReplan.facilities.find(
  (facility) => facility.id === "FAC-HOSP-B",
);
const facilityTransferRoute = initialForReplan.routes.find(
  (route) => route.id === "R3",
);
assert.ok(initialPrimaryRoute);
assert.ok(initialAlternateRoute);
assert.ok(northRescueTeam);
assert.ok(northAmbulance);
assert.ok(hospitalB);
assert.ok(facilityTransferRoute);
assert.deepEqual(initialPrimaryRoute.origin, initial.resources.find(
  (resource) => resource.id === "RES-AMB-01",
)?.location);
assert.deepEqual(initialAlternateRoute.origin, northRescueTeam.location);
assert.deepEqual(initialAlternateRoute.origin, northAmbulance.location);
assert.deepEqual(initialAlternateRoute.destination, {
  latitude: initialForReplan.incident.location.latitude,
  longitude: initialForReplan.incident.location.longitude,
});
assert.deepEqual(facilityTransferRoute.origin, {
  latitude: initialForReplan.incident.location.latitude,
  longitude: initialForReplan.incident.location.longitude,
});
assert.deepEqual(facilityTransferRoute.destination, {
  latitude: hospitalB.location.latitude,
  longitude: hospitalB.location.longitude,
});
const blockedState = {
  ...initialForReplan,
  stateVersion: initialForReplan.stateVersion + 1,
  updatedAt: "2026-10-02T08:46:18.000Z",
  routes: initialForReplan.routes.map((route) =>
    route.id === "R1"
      ? {
          ...route,
          status: "BLOCKED" as const,
          blockedReason: "Flooding reported on primary access route.",
        }
      : route,
  ),
};
const replan = await runAutoAiWorkflow(
  blockedState,
  "PLAN-002",
  mockDependencies({
    riskAssessment: async () => {
      throw unavailableError("RATE_LIMITED", ["gemini-3.8-flash"]);
    },
  }),
);
assert.equal(replan.responsePlanningResult.plan.id, "PLAN-002");
assert.equal(replan.responsePlanningResult.plan.stateVersion, blockedState.stateVersion);
assert.equal(
  replan.responsePlanningResult.plan.source,
  "DETERMINISTIC_FALLBACK",
);
assert.equal(replan.responsePlanningResult.validation.valid, true);
assert.equal(
  replan.responsePlanningResult.actions.some((action) =>
    action.routeIds.includes("R1"),
  ),
  false,
);
assert.deepEqual(replan.responsePlanningResult.plan.dependencies.routeIds, ["R2"]);
assert.deepEqual(
  replan.responsePlanningResult.plan.dependencies.resourceIds,
  ["RES-AMB-02"],
);
const replanApproval = submitPlanForApproval(replan.responsePlanningResult.plan);
assert.equal(replanApproval.success, true);
if (replanApproval.success) assert.equal(replanApproval.plan.status, "PENDING_APPROVAL");

const controller = createDemoController((planId) => {
  let resultPromise:
    | ReturnType<typeof runAutoAiWorkflow>
    | undefined;
  const getResult = (state: typeof initial) => {
    resultPromise ??= runAutoAiWorkflow(
      state,
      planId,
      mockDependencies({
        riskAssessment: async () => {
          throw unavailableError("RATE_LIMITED", ["gemini-3.8-flash"]);
        },
      }),
    );
    return resultPromise;
  };
  return {
    riskAssessment: async (state) =>
      (await getResult(state)).riskAssessment,
    resourceRouting: async (state) =>
      (await getResult(state)).resourceRoutingAssessment,
    responsePlanning: async (state) =>
      (await getResult(state)).responsePlanningResult,
  };
});
const started = await controller.startDemo();
assert.equal(started.success, true);
assert.equal(controller.getSnapshot().currentPlan?.source, "DETERMINISTIC_FALLBACK");
assert.equal(controller.getSnapshot().currentPlan?.status, "PENDING_APPROVAL");
assert.deepEqual(controller.getSnapshot().currentPlan?.dependencies.routeIds, ["R1"]);
assert.equal(controller.getSnapshot().humanDecision, null);
assert.equal((await controller.approveCurrentPlan()).success, true);
assert.equal(controller.beginExecution().success, true);
assert.equal(controller.completeExecution().success, true);
assert.equal(controller.getSnapshot().stage, "COMPLETED");
assert.equal(controller.getSnapshot().currentPlan?.id, "PLAN-001");
const blocked = await controller.simulateRouteBlockage();
assert.equal(blocked.success, true);
assert.equal(controller.getSnapshot().stage, "AWAITING_REVISED_APPROVAL");
assert.equal(
  controller.getSnapshot().stateChanges.find(
    (change) => change.id === "DEMO-CHANGE-001",
  )?.newValue,
  "PLAN_AFFECTED_REASSESSMENT_REQUIRED",
);
assert.equal(controller.getSnapshot().state.routes.find((route) => route.id === "R1")?.status, "BLOCKED");
assert.equal(controller.getSnapshot().previousPlan?.id, "PLAN-001");
assert.equal(controller.getSnapshot().previousPlan?.status, "COMPLETED");
assert.equal(controller.getSnapshot().currentPlan?.id, "PLAN-002");
assert.equal(controller.getSnapshot().currentPlan?.source, "DETERMINISTIC_FALLBACK");
assert.equal(controller.getSnapshot().currentPlan?.status, "PENDING_APPROVAL");
assert.deepEqual(controller.getSnapshot().currentPlan?.dependencies.routeIds, ["R2"]);
assert.deepEqual(controller.getSnapshot().currentPlan?.dependencies.resourceIds, ["RES-AMB-02"]);
const revisedResource = controller.getSnapshot().state.resources.find(
  (resource) => resource.id === controller.getSnapshot().currentPlan?.dependencies.resourceIds[0],
);
const revisedRoute = controller.getSnapshot().state.routes.find(
  (route) => route.id === controller.getSnapshot().currentPlan?.dependencies.routeIds[0],
);
assert.ok(revisedResource);
assert.ok(revisedRoute);
assert.deepEqual(revisedResource.location, revisedRoute.origin);
assert.equal(controller.getSnapshot().validation?.valid, true);
assert.equal(controller.getSnapshot().humanDecision, null);
assert.equal((await controller.approveCurrentPlan()).success, true);
assert.equal(controller.getSnapshot().currentPlan?.status, "APPROVED");
assert.equal(controller.beginExecution().success, true);
assert.equal(controller.completeExecution().success, true);
assert.equal(controller.getSnapshot().stage, "COMPLETED");
assert.equal(controller.getSnapshot().currentPlan?.id, "PLAN-002");
assert.equal(controller.getSnapshot().currentPlan?.status, "COMPLETED");
const reset = controller.resetDemo();
assert.equal(reset.success, true);
assert.equal(controller.getSnapshot().stage, "IDLE");
assert.equal(controller.getSnapshot().currentPlan, null);
assert.equal(controller.getSnapshot().state.activePlan, null);
assert.deepEqual(controller.getSnapshot().planHistory, []);
assert.equal(controller.getSnapshot().state.routes.find((route) => route.id === "R1")?.status, "OPEN");

console.log(
  "AUTO AI/fallback fixture passed: initial PLAN-001, R1 change detection, topology-supported deterministic PLAN-002, validation, renewed approval and execution, and clean reset.",
);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
