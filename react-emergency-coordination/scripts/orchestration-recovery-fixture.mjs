import assert from "node:assert/strict";
import { runReactAgentPipeline } from "../src/lib/orchestrator/pipeline.ts";
import {
  classifyAgentFailure,
  ReactOrchestrationInputError,
  ReactOrchestrationPersistenceError,
  ReactOrchestrationStageError,
} from "../src/lib/orchestrator/errors.ts";

function failure(code) {
  return Object.assign(new Error("private provider details"), { code });
}

function immutable(value) {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) immutable(child);
  }
  return value;
}

const state = immutable({
  incident: { id: "incident-1" },
  stateVersion: 7,
  resources: [{ id: "resource-1" }],
});
const risk = Object.freeze({ result: "risk" });
const routing = Object.freeze({ result: "routing" });
const planning = Object.freeze({
  result: "planning",
  plan: { incidentId: "incident-1", stateVersion: 7 },
  validation: { valid: true, errors: [], warnings: [] },
});

function successfulAgents(calls) {
  return {
    riskAssessment: async (input) => {
      assert.equal(input, state);
      calls.push("risk-assessment");
      return risk;
    },
    resourceRouting: async (input) => {
      assert.equal(input, state);
      calls.push("resource-routing");
      return routing;
    },
    responsePlanning: async (input, riskOutput, routingOutput) => {
      assert.equal(input, state);
      assert.equal(riskOutput, risk);
      assert.equal(routingOutput, routing);
      calls.push("response-planning");
      return planning;
    },
  };
}

const invalidState = new ReactOrchestrationInputError(
  "Invalid state",
  ["state: invalid"],
);
assert.equal(invalidState.failure.failureCategory, "INVALID_STATE");
assert.equal(invalidState.failure.retryable, false);
assert.equal(invalidState.failure.recommendation, "RELOAD_STATE");

for (const [stage, expectedCalls, code, category, retryable] of [
  [
    "risk-assessment",
    ["risk-assessment"],
    "RISK_ASSESSMENT_GEMINI_TIMEOUT",
    "RISK_ASSESSMENT_FAILED",
    true,
  ],
  [
    "resource-routing",
    ["risk-assessment", "resource-routing"],
    "RESOURCE_ROUTING_SCHEMA_VALIDATION_FAILED",
    "RESOURCE_ROUTING_FAILED",
    false,
  ],
  [
    "response-planning",
    ["risk-assessment", "resource-routing", "response-planning"],
    "RESPONSE_PLANNING_GEMINI_TIMEOUT",
    "RESPONSE_PLANNING_FAILED",
    true,
  ],
  [
    "response-planning",
    ["risk-assessment", "resource-routing", "response-planning"],
    "RESPONSE_PLANNING_PRIMARY_PLAN_INVALID",
    "PLAN_VALIDATION_FAILED",
    false,
  ],
]) {
  const calls = [];
  const agents = successfulAgents(calls);
  agents[{
    "risk-assessment": "riskAssessment",
    "resource-routing": "resourceRouting",
    "response-planning": "responsePlanning",
  }[stage]] = async () => {
    calls.push(stage);
    throw failure(code);
  };

  const result = await runReactAgentPipeline(state, agents);
  assert.equal(result.success, false);
  assert.deepEqual(calls, expectedCalls);
  assert.equal(result.failure.stage, stage);
  const orchestrationError = new ReactOrchestrationStageError(
    result.failure.stage,
    result.failure.cause,
    result.failure.completedStages,
  );
  assert.equal(orchestrationError.failure.failureCategory, category);
  assert.equal(orchestrationError.failure.retryable, retryable);
  assert.equal(orchestrationError.failure.usablePlanExists, false);
  assert.equal(orchestrationError.cause.message, undefined);
}

const calls = [];
const observed = [];
const success = await runReactAgentPipeline(state, successfulAgents(calls), {
  onStageCompleted: async ({ stage }) => observed.push(stage),
});
assert.equal(success.success, true);
assert.deepEqual(calls, [
  "risk-assessment",
  "resource-routing",
  "response-planning",
]);
assert.deepEqual(observed, calls);
assert.equal(success.riskAssessment, risk);
assert.equal(success.resourceRoutingAssessment, routing);
assert.equal(success.responsePlanning, planning);
assert.deepEqual(success.completedStages, calls);
assert.deepEqual(
  success.stageTimings.map(({ stage }) => stage),
  calls,
);
assert.ok(success.stageTimings.every(({ durationMs }) => durationMs >= 0));
assert.equal(state.stateVersion, 7);
assert.equal(state.resources[0].id, "resource-1");

const persistenceFailure = new ReactOrchestrationPersistenceError({
  message: "Stage record could not be saved",
  operation: "agent-run",
  stage: "response-planning",
  cause: new Error("private storage detail"),
  completedWrites: ["risk-run", "routing-run"],
  partialWritePossible: true,
  completedStages: [
    "risk-assessment",
    "resource-routing",
    "response-planning",
  ],
  usablePlanExists: true,
});
const persistenceCalls = [];
const observedFailure = await runReactAgentPipeline(
  state,
  successfulAgents(persistenceCalls),
  {
    onStageCompleted: async ({ stage }) => {
      if (stage === "response-planning") throw persistenceFailure;
    },
  },
);
assert.equal(observedFailure.success, false);
assert.equal(observedFailure.failure.kind, "observer-failure");
assert.equal(observedFailure.failure.stage, "response-planning");
assert.equal(observedFailure.failure.cause, persistenceFailure);
assert.deepEqual(observedFailure.failure.completedStages, [
  "risk-assessment",
  "resource-routing",
  "response-planning",
]);
assert.deepEqual(persistenceCalls, [
  "risk-assessment",
  "resource-routing",
  "response-planning",
]);

for (const [stage, code, category, retryable, recommendation] of [
  [
    "risk-assessment",
    "RISK_ASSESSMENT_GEMINI_TIMEOUT",
    "RISK_ASSESSMENT_FAILED",
    true,
    "RETRY_STAGE",
  ],
  [
    "risk-assessment",
    "RISK_ASSESSMENT_SCHEMA_VALIDATION_FAILED",
    "RISK_ASSESSMENT_FAILED",
    false,
    "ABORT",
  ],
  [
    "response-planning",
    "RESPONSE_PLANNING_PRIMARY_PLAN_INVALID",
    "PLAN_VALIDATION_FAILED",
    false,
    "REGENERATE_PLAN",
  ],
]) {
  const mapped = classifyAgentFailure(stage, code);
  assert.deepEqual(mapped, { category, retryable, recommendation });
  assert.deepEqual(classifyAgentFailure(stage, code), mapped);
}

const noWrites = new ReactOrchestrationPersistenceError({
  message: "Persistence failed",
  operation: "agent-run",
  stage: "risk-assessment",
  cause: failure("08006"),
  completedWrites: [],
  partialWritePossible: false,
});
assert.equal(noWrites.failure.status, "FAILED");
assert.equal(noWrites.failure.retryable, true);
assert.equal(noWrites.failure.partialPersistence, false);
assert.equal(noWrites.failure.recommendation, "RETRY_STAGE");

const partialWrites = new ReactOrchestrationPersistenceError({
  message: "PlanAction write failed",
  operation: "plan-action",
  stage: "response-planning",
  cause: new Error("sensitive database detail"),
  completedWrites: ["agent-run-1", "response-plan-1", "action-1"],
  partialWritePossible: true,
  completedStages: [
    "risk-assessment",
    "resource-routing",
    "response-planning",
  ],
  usablePlanExists: true,
});
assert.equal(partialWrites.failure.status, "PARTIAL_FAILURE");
assert.equal(partialWrites.failure.failureCategory, "PERSISTENCE_FAILED");
assert.equal(partialWrites.failure.partialPersistence, true);
assert.equal(partialWrites.failure.usablePlanExists, true);
assert.equal(partialWrites.failure.recommendation, "REPAIR_PERSISTENCE");
assert.deepEqual(partialWrites.failure.completedWrites, [
  "agent-run-1",
  "response-plan-1",
  "action-1",
]);
assert.doesNotMatch(JSON.stringify(partialWrites), /sensitive database detail/);

console.log("Orchestration recovery fixture passed.");
