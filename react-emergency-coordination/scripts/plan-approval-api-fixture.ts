import assert from "node:assert/strict";
import type { EmergencyState } from "../src/domain/emergency-state/schema";
import type { ResponsePlan } from "../src/domain/response-plan/schema";
import {
  createPlanApprovalHandlers,
} from "../src/lib/human-approval/approval-api";
import type { EmergencyStateProvider } from "../src/lib/emergency-state/provider";

const timestamp = "2026-01-01T00:00:00.000Z";

const plan: ResponsePlan = {
  id: "plan-1",
  incidentId: "incident-1",
  stateVersion: 4,
  status: "DRAFT",
  priority: "HIGH",
  summary: "Coordinate evacuation",
  rationale: "Move affected residents to safety.",
  generatedAt: timestamp,
  updatedAt: timestamp,
  actions: [{ actionId: "action-1", sequence: 1 }],
  alternatives: [],
  dependencies: { resourceIds: [], facilityIds: [], routeIds: [] },
};

const state: EmergencyState = {
  incident: {
    id: "incident-1",
    title: "Incident",
    description: "Test incident",
    type: "FIRE",
    status: "ACTIVE",
    severity: "HIGH",
    priority: "HIGH",
    location: { latitude: 18, longitude: 73, address: "Test address" },
    affectedPopulation: 10,
    hazards: [],
    reportedAt: timestamp,
    updatedAt: timestamp,
  },
  resources: [],
  facilities: [],
  routes: [],
  planActions: [
    {
      id: "action-1",
      planId: "plan-1",
      sequence: 1,
      type: "EVACUATE_AREA",
      status: "PENDING",
      description: "Evacuate the affected area.",
      priority: "HIGH",
      resourceIds: [],
      facilityIds: [],
      routeIds: [],
      targetLocation: { latitude: 18, longitude: 73 },
      estimatedDurationMinutes: 30,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
  activePlan: null,
  stateVersion: 4,
  updatedAt: timestamp,
};

const plans = new Map<string, ResponsePlan>([["plan-1", plan]]);
const provider: EmergencyStateProvider = {
  async getPlan(planId) {
    return plans.get(planId) ?? null;
  },
  async getStateForPlan() {
    return { state, stateChanges: [], agentRuns: [], humanDecisions: [] };
  },
  async persistPlan(updatedPlan) {
    plans.set(updatedPlan.id, updatedPlan);
  },
  async persistDecision(_previousPlan, updatedPlan) {
    plans.set(updatedPlan.id, updatedPlan);
  },
  async persistModifiedPlan(previousPlan, revisedPlan) {
    plans.set(previousPlan.id, { ...previousPlan, status: "SUPERSEDED" });
    plans.set(revisedPlan.id, revisedPlan);
  },
};

const handlers = createPlanApprovalHandlers(provider);
const context = { params: Promise.resolve({ planId: "plan-1" }) };
const decision = {
  id: "decision-1",
  incidentId: "incident-1",
  coordinatorId: "coordinator-1",
  reason: "Approved for execution.",
  decidedAt: "2026-01-01T00:01:00.000Z",
  recordedAt: "2026-01-01T00:01:00.000Z",
};

function request(method: string, body?: unknown): Request {
  return new Request("http://localhost/api/emergency/plans/plan-1", {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

async function main(): Promise<void> {
const submitted = await handlers.submit(request("POST"), context);
assert.equal(submitted.status, 200);
assert.equal(plans.get("plan-1")?.status, "PENDING_APPROVAL");
plans.set("plan-1", { ...plan, status: "PENDING_APPROVAL" });

const invalidSubmit = await handlers.submit(
  request("POST"),
  { params: Promise.resolve({ planId: "unknown" }) },
);
assert.equal(invalidSubmit.status, 404);
plans.set("plan-1", { ...plan, status: "INVALID" });
assert.equal((await handlers.submit(request("POST"), context)).status, 409);
plans.set("plan-1", { ...plan, status: "PENDING_APPROVAL" });

const approved = await handlers.approve(request("POST", decision), context);
assert.equal(approved.status, 201);
assert.equal(plans.get("plan-1")?.status, "APPROVED");
plans.set("plan-1", { ...plan, status: "APPROVED" });
assert.equal((await handlers.approve(request("POST", decision), context)).status, 409);

plans.set("plan-1", { ...plan, status: "PENDING_APPROVAL", stateVersion: 3 });
assert.equal((await handlers.approve(request("POST", decision), context)).status, 409);

plans.set("plan-1", { ...plan, status: "PENDING_APPROVAL" });
assert.equal((await handlers.reject(request("POST", { ...decision, reason: " " }), context)).status, 400);
assert.equal((await handlers.reject(request("POST", { ...decision, reason: "Route unsafe." }), context)).status, 201);
assert.equal(plans.get("plan-1")?.status, "REJECTED");

plans.set("plan-1", { ...plan, status: "PENDING_APPROVAL" });
const modifiedPlan = {
  ...plan,
  id: "plan-2",
  summary: "Use alternate evacuation route.",
  actions: [{ actionId: "action-2", sequence: 1 }],
};
const modifiedAction = {
  ...state.planActions[0]!,
  id: "action-2",
  planId: "plan-2",
};
assert.equal(
  (
    await handlers.modify(
      request("POST", { ...decision, modifiedPlan, modifiedActions: [modifiedAction] }),
      context,
    )
  ).status,
  201,
);
assert.equal(plans.get("plan-1")?.status, "SUPERSEDED");
assert.equal(plans.get("plan-2")?.status, "PENDING_APPROVAL");
assert.equal(
  (
    await handlers.modify(
      request("POST", { ...decision, modifiedPlan: { ...modifiedPlan, summary: "" } }),
      context,
    )
  ).status,
  400,
);
assert.equal(
  (
    await handlers.modify(
      request("POST", { ...decision, modifiedPlan: { ...modifiedPlan, stateVersion: 3 } }),
      context,
    )
  ).status,
  409,
);
plans.set("plan-1", { ...plan, status: "PENDING_APPROVAL" });
assert.equal(
  (
    await handlers.approve(
      request("POST", { ...decision, incidentId: "incident-2" }),
      context,
    )
  ).status,
  400,
);
assert.equal(
  (await handlers.approve(new Request("http://localhost", { method: "POST", body: "{" }), context)).status,
  400,
);

plans.set("plan-1", { ...plan, status: "APPROVED" });
const status = await handlers.approvalStatus(request("GET"), context);
const statusBody = await json(status);
assert.equal(status.status, 200);
assert.equal((statusBody.data as { executable: boolean }).executable, true);

plans.set("plan-1", { ...plan, status: "APPROVED", stateVersion: 3 });
const staleStatus = await handlers.approvalStatus(request("GET"), context);
const staleBody = await json(staleStatus);
assert.equal((staleBody.data as { executable: boolean }).executable, false);

console.log("Plan approval API fixture passed.");
}

void main();
