import assert from "node:assert/strict";
import { createDashboardViewModel } from "../src/components/react/data/view-model";
import { createDemoController } from "../src/lib/demo/controller";

async function main() {
  const controller = createDemoController();
  const initial = controller.getSnapshot();
  const idleView = createDashboardViewModel(initial);
  assert.equal(idleView.activePlan, null);
  assert.equal(idleView.riskAssessment, null);
  assert.equal(idleView.resourceRoutingAssessment, null);
  assert.equal(idleView.responsePlanningResult, null);
  assert.equal(idleView.validation, null);
  assert.equal(idleView.humanDecision, null);
  assert.deepEqual(idleView.agents.map((agent) => agent.statusLabel), [
    "STANDBY",
    "STANDBY",
    "STANDBY",
  ]);
  assert.ok(idleView.agents.every((agent) =>
    agent.timeLabel === "Not started" &&
    !("durationLabel" in agent) &&
    agent.resultSummary === "Awaiting demo start",
  ));
  assert.equal(idleView.timeline.length, 0);
  assert.equal(initial.riskAssessment, null);
  assert.equal(initial.validation, null);

  const started = await controller.startDemo();
  if (!started.success) throw new Error("start failed");
const startedView = createDashboardViewModel(started.snapshot);
assert.equal(startedView.activePlan?.id, "PLAN-001");
assert.equal(startedView.validation?.valid, true);
assert.equal(startedView.approvalAvailable, true);
assert.ok(startedView.agents.every((agent) => agent.status !== "STANDBY"));
assert.ok(startedView.agents.every((agent) => agent.resultSummary !== "Awaiting demo start"));
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
  const approvedView = createDashboardViewModel(approved.snapshot);
  assert.equal(approvedView.humanDecision?.decision, "APPROVE");
  assert.equal(approvedView.activePlan?.status, "APPROVED");
  assert.equal(controller.beginExecution().success, true);
  assert.equal(controller.completeExecution().success, true);
  assert.equal(controller.getSnapshot().currentPlan?.status, "COMPLETED");
  const executedView = createDashboardViewModel(controller.getSnapshot());
  assert.equal(executedView.activePlan?.status, "COMPLETED");
  assert.equal(executedView.humanDecision?.decision, "APPROVE");
  assert.ok(executedView.agents.every((agent) => agent.resultSummary !== "Awaiting demo start"));

  const blocked = await controller.simulateRouteBlockage();
  if (!blocked.success) throw new Error("route blockage failed");
assert.equal(blocked.snapshot.state.routes.find((route) => route.id === "R1")?.status, "BLOCKED");
assert.equal(blocked.snapshot.previousPlan?.id, "PLAN-001");
assert.equal(blocked.snapshot.currentPlan?.id, "PLAN-002");
assert.equal(blocked.snapshot.resourceRoutingAssessment?.routes.find((route) => route.routeId === "R2")?.status, "OPEN");
assert.equal(blocked.snapshot.validation?.valid, true);
assert.equal(blocked.snapshot.humanDecision, null);
const revisedView = createDashboardViewModel(blocked.snapshot);
assert.equal(revisedView.reassessment.required, true);
assert.equal(revisedView.reassessment.routeId, "R1");
assert.equal(revisedView.activePlan?.id, "PLAN-002");
assert.equal(revisedView.activePlan?.status, "PENDING_APPROVAL");
assert.equal(revisedView.approvalAvailable, true);
assert.equal(revisedView.validation?.valid, true);
assert.ok(revisedView.agents.every((agent) => agent.status !== "STANDBY"));

  const final = await controller.approveCurrentPlan();
  if (!final.success) throw new Error("revised approval failed");
  assert.equal(final.snapshot.humanDecision?.decision, "APPROVE");
  assert.equal(final.snapshot.stage, "AWAITING_EXECUTION");
  assert.equal(final.snapshot.currentPlan?.status, "APPROVED");
  assert.equal(controller.beginExecution().success, true);
  assert.equal(controller.completeExecution().success, true);
  assert.equal(controller.getSnapshot().currentPlan?.status, "COMPLETED");
  const revisedExecutedView = createDashboardViewModel(controller.getSnapshot());
  assert.equal(revisedExecutedView.activePlan?.id, "PLAN-002");
  assert.equal(revisedExecutedView.activePlan?.status, "COMPLETED");
  assert.equal(revisedExecutedView.humanDecision?.decision, "APPROVE");

  const reset = controller.resetDemo();
  assert.equal(reset.success, true);
  assert.equal(reset.snapshot.riskAssessment, null);
  const resetView = createDashboardViewModel(reset.snapshot);
  assert.equal(resetView.activePlan, null);
  assert.ok(resetView.agents.every((agent) => agent.statusLabel === "STANDBY"));
  assert.ok(resetView.agents.every((agent) => agent.resultSummary === "Awaiting demo start"));
  assert.equal(resetView.timeline.length, 0);

  console.log("REACT agent explainability fixture passed.");
}

void main();
