import assert from "node:assert/strict";
import type { ResponsePlan } from "../src/domain/response-plan/schema";
import {
  approvePlan,
  canExecuteApprovedPlan,
  modifyPlan,
  rejectPlan,
  submitPlanForApproval,
  type DecisionMetadata,
} from "../src/lib/human-approval/plan-approval";

const metadata: DecisionMetadata = {
  id: "decision-1",
  incidentId: "incident-1",
  coordinatorId: "coordinator-1",
  reason: "Coordinator decision",
  decidedAt: "2026-01-01T00:01:00.000Z",
  recordedAt: "2026-01-01T00:01:00.000Z",
};

const basePlan: ResponsePlan = {
  id: "plan-1",
  incidentId: "incident-1",
  stateVersion: 4,
  status: "DRAFT",
  priority: "HIGH",
  summary: "Coordinate evacuation",
  rationale: "Move affected residents to a safe facility.",
  generatedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  actions: [{ actionId: "action-1", sequence: 1 }],
  alternatives: [],
  dependencies: { resourceIds: [], facilityIds: [], routeIds: [] },
};

const pending = submitPlanForApproval(basePlan);
assert.equal(pending.success, true);
if (!pending.success) throw new Error("Expected pending plan.");

const approved = approvePlan(pending.plan, metadata);
assert.equal(approved.success, true);
if (!approved.success) throw new Error("Expected approval.");
assert.equal(approved.plan.status, "APPROVED");

for (const status of ["APPROVED", "REJECTED", "COMPLETED", "SUPERSEDED", "INVALID"] as const) {
  const result = approvePlan({ ...pending.plan, status }, metadata);
  assert.equal(result.success, false);
  if (result.success) throw new Error("Expected approval rejection.");
  assert.equal(result.error.code, "APPROVAL_NOT_ALLOWED");
}

const rejected = rejectPlan(pending.plan, { ...metadata, reason: "Unsafe route." });
assert.equal(rejected.success, true);
if (!rejected.success) throw new Error("Expected rejection.");
assert.equal(rejected.plan.status, "REJECTED");
assert.equal(rejectPlan(pending.plan, { ...metadata, reason: " " }).success, false);

const modifiedInput = { ...pending.plan, summary: "Use the alternate evacuation route." };
const modified = modifyPlan(pending.plan, modifiedInput, metadata);
assert.equal(modified.success, true);
if (!modified.success) throw new Error("Expected modification.");
assert.equal(modified.plan.status, "MODIFIED");
assert.equal(pending.plan.status, "PENDING_APPROVAL");
assert.equal(pending.plan.summary, "Coordinate evacuation");
assert.equal(
  modifyPlan(
    pending.plan,
    { ...modifiedInput, incidentId: "incident-2" },
    metadata,
  ).success,
  false,
);
assert.equal(
  modifyPlan(
    pending.plan,
    { ...modifiedInput, stateVersion: 3 },
    metadata,
  ).success,
  false,
);
assert.equal(
  modifyPlan(pending.plan, { ...modifiedInput, summary: "" } as ResponsePlan, metadata)
    .success,
  false,
);

assert.equal(canExecuteApprovedPlan(approved.plan), true);
assert.equal(canExecuteApprovedPlan(pending.plan), false);
assert.equal(
  canExecuteApprovedPlan(approved.plan, { currentStateVersion: 5 }),
  false,
);

console.log("Plan approval fixture passed.");
