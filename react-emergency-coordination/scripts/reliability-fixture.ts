import assert from "node:assert/strict";
import { z } from "zod";
import type { EmergencyState } from "../src/domain/emergency-state/schema";
import type { ResponsePlan } from "../src/domain/response-plan/schema";
import { requireGeminiApiKey, parseStructuredJson, geminiRequestFailure, GeminiError } from "../src/lib/ai/gemini-contract";
import { getDemoState } from "../src/lib/demo/fixtures";
import {
  createDemoController,
  deterministicDemoAgents,
  type DemoAgentFactory,
} from "../src/lib/demo/controller";
import { approvePlan, canExecuteApprovedPlan } from "../src/lib/human-approval/plan-approval";
import { validatePlan } from "../src/lib/emergency-engine/plan-validator";
import { allocateFacilityCapacity, releaseFacilityCapacity, transitionFacilityStatus } from "../src/lib/emergency-engine/facilities";
import { transitionResourceStatus } from "../src/lib/emergency-engine/resources";
import { transitionRouteStatus } from "../src/lib/emergency-engine/routes";
import { detectEmergencyStateChanges } from "../src/lib/change-detection/detector";
import { replanEmergencyResponse } from "../src/lib/replanning/replanner";
import { executeApprovedPlan } from "../src/lib/simulation/engine";

const decision = {
  id: "RELIABILITY-DECISION",
  incidentId: "INC-2026-001",
  coordinatorId: "RELIABILITY-FIXTURE",
  reason: "Reliability fixture approval.",
  decidedAt: "2026-10-02T08:47:00.000Z",
  recordedAt: "2026-10-02T08:47:00.000Z",
};

function expectGeminiFailure(operation: () => unknown, code: string): void {
  assert.throws(operation, (error: unknown) => error instanceof GeminiError && error.code === code);
}

function withState(state: EmergencyState, patch: Partial<EmergencyState>): EmergencyState {
  return { ...state, ...patch };
}

async function approvedFixture(): Promise<{ state: EmergencyState; plan: ResponsePlan }> {
  const controller = createDemoController();
  const started = await controller.startDemo();
  assert.equal(started.success, true);
  const pending = controller.getSnapshot().currentPlan;
  assert.ok(pending);
  const state = controller.getSnapshot().state;
  const result = approvePlan(pending, { ...decision, currentState: state });
  if (!result.success) throw new Error(result.error.message);
  return { state: withState(state, { activePlan: result.plan }), plan: result.plan };
}

async function main(): Promise<void> {
  expectGeminiFailure(() => requireGeminiApiKey(undefined), "GEMINI_CONFIG_ERROR");
  expectGeminiFailure(() => requireGeminiApiKey("  "), "GEMINI_CONFIG_ERROR");
  assert.equal(requireGeminiApiKey("fixture-key"), "fixture-key");
  assert.equal(geminiRequestFailure(new Error("network"), 100).code, "GEMINI_REQUEST_ERROR");
  assert.equal(geminiRequestFailure(Object.assign(new Error("timeout"), { name: "TimeoutError" }), 100).code, "GEMINI_TIMEOUT");
  expectGeminiFailure(() => parseStructuredJson("", z.object({ value: z.string() })), "GEMINI_EMPTY_RESPONSE");
  expectGeminiFailure(() => parseStructuredJson("{", z.object({ value: z.string() })), "GEMINI_INVALID_JSON");
  expectGeminiFailure(() => parseStructuredJson('{"value":1}', z.object({ value: z.string() })), "GEMINI_SCHEMA_VALIDATION_FAILED");

  const idleDemo = createDemoController();
  assert.equal(idleDemo.getSnapshot().stage, "IDLE");
  assert.equal(idleDemo.getSnapshot().state.activePlan, null);
  const { state, plan } = await approvedFixture();
  const pending = { ...plan, status: "PENDING_APPROVAL" as const };
  assert.equal(executeApprovedPlan(withState(state, { activePlan: pending }), pending).error?.code, "PLAN_NOT_EXECUTABLE");
  assert.equal(canExecuteApprovedPlan(pending, { currentState: state }), false);
  for (const status of ["REJECTED", "INVALID", "SUPERSEDED"] as const) {
    const nonExecutable = { ...plan, status };
    assert.equal(executeApprovedPlan(withState(state, { activePlan: nonExecutable }), nonExecutable).success, false);
  }
  const stale = { ...plan, stateVersion: plan.stateVersion - 1 };
  assert.equal(executeApprovedPlan(state, stale).error?.code, "PLAN_STALE");
  const staleApproval = approvePlan(pending, { ...decision, currentState: withState(state, { stateVersion: state.stateVersion + 1 }) });
  assert.equal(staleApproval.success, false);
  if (!staleApproval.success) assert.equal(staleApproval.error.code, "PLAN_STALE");

  const invalidPlan = { ...pending, dependencies: { ...pending.dependencies, routeIds: ["MISSING-ROUTE"] } };
  assert.equal(validatePlan(invalidPlan, state).valid, false);
  assert.equal(approvePlan(invalidPlan, { ...decision, currentState: state }).success, false);

  const completed = executeApprovedPlan(state, plan);
  if (!completed.success) throw new Error(completed.error.message);
  const duplicate = executeApprovedPlan(completed.state, plan);
  assert.equal(duplicate.error?.code, "PLAN_ALREADY_EXECUTED");
  assert.deepEqual(duplicate.state, completed.state);
  assert.deepEqual(duplicate.events, []);

  const unavailableState = withState(state, {
    resources: state.resources.map((resource) => resource.id === "RES-AMB-01" ? { ...resource, status: "UNAVAILABLE" as const } : resource),
  });
  const unavailable = executeApprovedPlan(unavailableState, plan);
  assert.equal(unavailable.error?.code, "RESOURCE_EXECUTION_FAILED");
  assert.deepEqual(unavailable.state, unavailableState);
  assert.deepEqual(unavailable.stateChanges, []);
  assert.deepEqual(unavailable.executedActions, []);

  const missingResourceState = withState(state, { resources: state.resources.filter((resource) => resource.id !== "RES-RT-01") });
  assert.equal(executeApprovedPlan(missingResourceState, plan).error?.code, "RESOURCE_EXECUTION_FAILED");

  const assignedState = withState(state, {
    resources: state.resources.map((resource) => resource.id === "RES-RT-01" ? { ...resource, currentAssignmentId: "OTHER-PLAN" } : resource),
  });
  assert.equal(executeApprovedPlan(assignedState, plan).error?.code, "RESOURCE_EXECUTION_FAILED");
  const firstResource = state.resources[0];
  assert.ok(firstResource);
  assert.equal(transitionResourceStatus(firstResource, "BUSY").valid, false);
  const duplicateAssignmentState = withState(state, {
    planActions: state.planActions.map((action) => action.id === "ACT-002" ? { ...action, resourceIds: ["RES-RT-01"] } : action),
  });
  assert.equal(executeApprovedPlan(duplicateAssignmentState, plan).error?.code, "RESOURCE_EXECUTION_FAILED");

  const lowCapacityState = withState(state, {
    facilities: state.facilities.map((facility) => facility.id === "FAC-HOSP-A" ? { ...facility, availableCapacity: 1 } : facility),
  });
  const lowCapacity = executeApprovedPlan(lowCapacityState, plan);
  assert.equal(lowCapacity.error?.code, "FACILITY_EXECUTION_FAILED");
  assert.deepEqual(lowCapacity.state, lowCapacityState);
  const firstFacility = state.facilities[0];
  assert.ok(firstFacility);
  assert.equal(allocateFacilityCapacity(firstFacility, -1).valid, false);
  assert.equal(releaseFacilityCapacity(firstFacility, 21).valid, false);
  assert.equal(transitionFacilityStatus({ ...firstFacility, status: "CLOSED" }, "LIMITED").valid, false);
  const missingFacilityState = withState(state, { facilities: state.facilities.filter((facility) => facility.id !== "FAC-HOSP-A") });
  assert.equal(executeApprovedPlan(missingFacilityState, plan).error?.code, "FACILITY_EXECUTION_FAILED");
  const closedFacilityState = withState(state, {
    facilities: state.facilities.map((facility) => facility.id === "FAC-HOSP-A" ? { ...facility, status: "CLOSED" as const } : facility),
  });
  assert.equal(executeApprovedPlan(closedFacilityState, plan).error?.code, "FACILITY_EXECUTION_FAILED");
  const inconsistentCapacityState = withState(state, {
    facilities: state.facilities.map((facility) => facility.id === "FAC-HOSP-A" ? { ...facility, availableCapacity: facility.totalCapacity + 1 } : facility),
  });
  assert.equal(executeApprovedPlan(inconsistentCapacityState, plan).error?.code, "FACILITY_EXECUTION_FAILED");

  const blockedState = withState(state, {
    routes: state.routes.map((route) => route.id === "R1" ? { ...route, status: "BLOCKED" as const, blockedReason: "Fixture closure" } : route),
  });
  const blocked = executeApprovedPlan(blockedState, plan);
  assert.equal(blocked.error?.code, "ROUTE_EXECUTION_FAILED");
  assert.deepEqual(blocked.state, blockedState);
  const missingRouteState = withState(state, { routes: state.routes.filter((route) => route.id !== "R1") });
  assert.equal(executeApprovedPlan(missingRouteState, plan).error?.code, "ROUTE_EXECUTION_FAILED");
  const closedRouteState = withState(state, { routes: state.routes.map((route) => route.id === "R1" ? { ...route, status: "CLOSED" as const, blockedReason: "Fixture closure" } : route) });
  assert.equal(executeApprovedPlan(closedRouteState, plan).error?.code, "ROUTE_EXECUTION_FAILED");
  const firstRoute = state.routes[0];
  assert.ok(firstRoute);
  const invalidRouteTransition = transitionRouteStatus(firstRoute, "BLOCKED", "");
  assert.equal(invalidRouteTransition.valid, false);
  assert.equal(transitionRouteStatus({ ...firstRoute, status: "CLOSED", blockedReason: "Closed" }, "CLOSED").valid, false);

  const beforeDetection = getDemoState("initial").state;
  const missingPlanDetection = detectEmergencyStateChanges({ previousState: beforeDetection, currentState: beforeDetection, activePlan: null });
  assert.equal(missingPlanDetection.success, false);
  const malformedState = withState(state, { incident: { ...state.incident, affectedPopulation: -1 } });
  const invalidDetection = detectEmergencyStateChanges({ previousState: state, currentState: malformedState, activePlan: plan });
  assert.equal(invalidDetection.success, false);
  const unchanged = detectEmergencyStateChanges({ previousState: state, currentState: state, activePlan: plan });
  assert.equal(unchanged.success, true);
  if (unchanged.success) assert.equal(unchanged.classification, "NO_MATERIAL_CHANGE");
  const unrelatedRouteChange = withState(state, {
    stateVersion: state.stateVersion + 1,
    updatedAt: "2026-10-02T08:48:00.000Z",
    routes: state.routes.map((route) => route.id === "R3" ? { ...route, status: "BLOCKED" as const, blockedReason: "Unrelated route change", updatedAt: "2026-10-02T08:48:00.000Z" } : route),
  });
  const unrelatedDetection = detectEmergencyStateChanges({ previousState: state, currentState: unrelatedRouteChange, activePlan: plan });
  assert.equal(unrelatedDetection.success, true);
  if (unrelatedDetection.success) assert.equal(unrelatedDetection.classification, "MATERIAL_CHANGE_NOT_AFFECTING_PLAN");
  const changedState = withState(state, {
    stateVersion: state.stateVersion + 1,
    updatedAt: "2026-10-02T08:48:00.000Z",
    routes: state.routes.map((route) => route.id === "R1" ? { ...route, status: "BLOCKED" as const, blockedReason: "Fixture blockage", updatedAt: "2026-10-02T08:48:00.000Z" } : route),
  });
  const detected = detectEmergencyStateChanges({ previousState: state, currentState: changedState, activePlan: plan });
  if (!detected.success) throw new Error(detected.error.message);
  assert.equal(detected.classification, "PLAN_AFFECTED_REASSESSMENT_REQUIRED");
  const failedReplan = await replanEmergencyResponse(state, changedState, {
    activePlan: plan,
    agents: {
      riskAssessment: async () => { throw new Error("fixture reassessment failure"); },
      resourceRouting: async () => { throw new Error("unexpected"); },
      responsePlanning: async () => { throw new Error("unexpected"); },
    },
  });
  assert.equal(failedReplan.success, false);
  assert.equal(failedReplan.revisedPlan, null);
  assert.equal(failedReplan.previousPlanSuperseded, false);

  let failOnce = true;
  const agentFailureFactory: DemoAgentFactory = (planId) => ({
    ...deterministicDemoAgents(planId),
    responsePlanning: async (agentState) => {
      if (failOnce) {
        failOnce = false;
        throw new Error("fixture agent failure");
      }
      return deterministicDemoAgents(planId).responsePlanning(agentState);
    },
  });
  const failedDemo = createDemoController(agentFailureFactory);
  const failure = await failedDemo.startDemo();
  assert.equal(failure.success, false);
  assert.equal(failure.snapshot.stage, "FAILED");
  assert.equal(failure.snapshot.currentPlan, null);
  assert.equal(failure.snapshot.error?.recoverable, false);
  assert.equal(failure.snapshot.error?.code, "AGENT_EXECUTION_FAILED");
  assert.equal(failure.snapshot.agentRuns.find((run) => run.agentType === "RESPONSE_PLANNING")?.status, "FAILED");
  const retryRejected = await failedDemo.retryDemo();
  assert.equal(retryRejected.success, false);
  if (!retryRejected.success) assert.equal(retryRejected.error.code, "RESET_REQUIRED");
  const reset = failedDemo.resetDemo();
  assert.equal(reset.snapshot.stage, "IDLE");
  assert.equal(reset.snapshot.state.activePlan, null);
  const recovered = await failedDemo.startDemo();
  assert.equal(recovered.success, true);
  assert.equal(failedDemo.getSnapshot().currentPlan?.id, "PLAN-001");

  const invalidPlanFactory: DemoAgentFactory = (planId) => ({
    ...deterministicDemoAgents(planId),
    responsePlanning: async (agentState) => {
      const generated = await deterministicDemoAgents(planId).responsePlanning(agentState);
      return { ...generated, validation: { valid: false, errors: [{ code: "PLAN_INVALID", message: "Fixture validation failure." }], warnings: [] } };
    },
  });
  const invalidDemo = createDemoController(invalidPlanFactory);
  const preservedPlan = invalidDemo.getSnapshot().state.activePlan;
  const invalidGeneration = await invalidDemo.startDemo();
  assert.equal(invalidGeneration.success, false);
  assert.equal(invalidDemo.getSnapshot().stage, "FAILED");
  assert.equal(invalidDemo.getSnapshot().currentPlan, null);
  assert.deepEqual(invalidDemo.getSnapshot().state.activePlan, preservedPlan);
  assert.equal(invalidDemo.getSnapshot().validation?.valid, false);
  assert.equal(invalidDemo.getSnapshot().responsePlanningResult?.validation.valid, false);

  const revisedFailureFactory: DemoAgentFactory = (planId) => {
    const agents = deterministicDemoAgents(planId);
    return planId === "PLAN-002"
      ? { ...agents, responsePlanning: async () => { throw new Error("fixture Plan-002 failure"); } }
      : agents;
  };
  const failedRevision = createDemoController(revisedFailureFactory);
  await failedRevision.startDemo();
  await failedRevision.approveCurrentPlan();
  assert.equal(failedRevision.getSnapshot().stage, "AWAITING_EXECUTION");
  assert.equal(failedRevision.beginExecution().success, true);
  assert.equal(failedRevision.completeExecution().success, true);
  const planOne = failedRevision.getSnapshot().currentPlan;
  const failedSecondPlan = await failedRevision.simulateRouteBlockage();
  assert.equal(failedSecondPlan.success, false);
  assert.equal(failedRevision.getSnapshot().stage, "FAILED");
  assert.equal(failedRevision.getSnapshot().currentPlan?.id, "PLAN-001");
  assert.deepEqual(failedRevision.getSnapshot().currentPlan, planOne);
  assert.equal(failedRevision.getSnapshot().state.activePlan?.id, "PLAN-001");
  assert.equal(failedRevision.getSnapshot().error?.stage, "REASSESSING");

  console.log("REACT reliability fixture passed.");
}

void main();
