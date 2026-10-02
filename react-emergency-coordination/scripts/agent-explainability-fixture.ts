import assert from "node:assert/strict";
import { createDemoController } from "../src/lib/demo/controller";

async function main() {
  const controller = createDemoController();
  const initial = controller.getSnapshot();
  assert.equal(initial.riskAssessment, null);
  assert.equal(initial.validation, null);

  const started = await controller.startDemo();
  if (!started.success) throw new Error("start failed");
assert.equal(started.snapshot.riskAssessment?.affectedPopulation, 35);
assert.equal(started.snapshot.resourceRoutingAssessment?.routes.length, 3);
assert.equal(started.snapshot.responsePlanningResult?.plan.id, "PLAN-001");
assert.equal(started.snapshot.validation?.valid, true);
assert.equal(started.snapshot.humanDecision, null);

  const approved = await controller.approveCurrentPlan();
  if (!approved.success) throw new Error("initial approval failed");
  assert.equal(approved.snapshot.humanDecision?.decision, "APPROVE");
  assert.equal(approved.snapshot.stage, "AWAITING_EXECUTION");
  assert.equal(approved.snapshot.currentPlan?.status, "APPROVED");
  assert.equal(controller.beginExecution().success, true);
  assert.equal(controller.completeExecution().success, true);
  assert.equal(controller.getSnapshot().currentPlan?.status, "COMPLETED");

  const blocked = await controller.simulateRouteBlockage();
  if (!blocked.success) throw new Error("route blockage failed");
assert.equal(blocked.snapshot.state.routes.find((route) => route.id === "R1")?.status, "BLOCKED");
assert.equal(blocked.snapshot.previousPlan?.id, "PLAN-001");
assert.equal(blocked.snapshot.currentPlan?.id, "PLAN-002");
assert.equal(blocked.snapshot.resourceRoutingAssessment?.routes.find((route) => route.routeId === "R2")?.status, "OPEN");
assert.equal(blocked.snapshot.validation?.valid, true);
assert.equal(blocked.snapshot.humanDecision, null);

  const final = await controller.approveCurrentPlan();
  if (!final.success) throw new Error("revised approval failed");
  assert.equal(final.snapshot.humanDecision?.decision, "APPROVE");
  assert.equal(final.snapshot.stage, "AWAITING_EXECUTION");
  assert.equal(final.snapshot.currentPlan?.status, "APPROVED");
  assert.equal(controller.beginExecution().success, true);
  assert.equal(controller.completeExecution().success, true);
  assert.equal(controller.getSnapshot().currentPlan?.status, "COMPLETED");

  const reset = controller.resetDemo();
  assert.equal(reset.success, true);
  assert.equal(reset.snapshot.riskAssessment, null);

  console.log("REACT agent explainability fixture passed.");
}

void main();
