import assert from "node:assert/strict";
import { createDemoController } from "../src/lib/demo/controller";

async function run(): Promise<void> {
  const first = createDemoController();
  assert.equal(first.getSnapshot().stage, "IDLE");

  const started = await first.startDemo();
  assert.equal(started.success, true);
  assert.equal(first.getSnapshot().stage, "AWAITING_APPROVAL");
  assert.equal(first.getSnapshot().currentPlan?.id, "PLAN-001");

  const approved = await first.approveCurrentPlan();
  assert.equal(approved.success, true);
  assert.equal(first.getSnapshot().stage, "AWAITING_EXECUTION");
  assert.equal(first.getSnapshot().currentPlan?.status, "APPROVED");
  assert.equal(first.getSnapshot().state.resources.some((resource) => resource.status === "DISPATCHED"), false);

  const executionStarted = first.beginExecution();
  assert.equal(executionStarted.success, true);
  assert.equal(first.getSnapshot().stage, "EXECUTING");
  const executed = first.completeExecution();
  assert.equal(executed.success, true);
  assert.equal(first.getSnapshot().stage, "COMPLETED");
  assert.equal(first.getSnapshot().currentPlan?.status, "COMPLETED");
  const completedPlan = first.getSnapshot().currentPlan;

  const blocked = await first.simulateRouteBlockage();
  assert.equal(blocked.success, true);
  assert.equal(first.getSnapshot().stage, "AWAITING_REVISED_APPROVAL");
  assert.equal(first.getSnapshot().state.routes.find((route) => route.id === "R1")?.status, "BLOCKED");
  assert.equal(first.getSnapshot().currentPlan?.id, "PLAN-002");
  assert.equal(first.getSnapshot().previousPlan?.id, "PLAN-001");
  assert.deepEqual(first.getSnapshot().previousPlan, completedPlan);

  const revised = await first.approveCurrentPlan();
  assert.equal(revised.success, true);
  assert.equal(first.getSnapshot().stage, "AWAITING_EXECUTION");
  assert.equal(first.getSnapshot().currentPlan?.status, "APPROVED");
  assert.equal(first.getSnapshot().state.routes.find((route) => route.id === "R1")?.status, "BLOCKED");
  assert.equal(first.beginExecution().success, true);
  assert.equal(first.getSnapshot().stage, "EXECUTING_REVISED_PLAN");
  assert.equal(first.completeExecution().success, true);
  assert.equal(first.getSnapshot().stage, "COMPLETED");
  assert.equal(first.getSnapshot().currentPlan?.status, "COMPLETED");
  assert.equal(first.getSnapshot().state.routes.find((route) => route.id === "R1")?.status, "BLOCKED");
  assert.equal(first.getSnapshot().state.routes.find((route) => route.id === "R2")?.status, "OPEN");

  const invalidTransition = await first.simulateRouteBlockage();
  assert.equal(invalidTransition.success, false);
  if (!invalidTransition.success) assert.equal(invalidTransition.error.code, "INVALID_TRANSITION");

  const repeat = createDemoController();
  await repeat.startDemo();
  await repeat.approveCurrentPlan();
  repeat.beginExecution();
  repeat.completeExecution();
  await repeat.simulateRouteBlockage();
  const repeatSnapshot = repeat.getSnapshot();
  const replay = createDemoController();
  await replay.startDemo();
  await replay.approveCurrentPlan();
  replay.beginExecution();
  replay.completeExecution();
  await replay.simulateRouteBlockage();
  assert.deepEqual(repeatSnapshot.state, replay.getSnapshot().state);
  assert.deepEqual(repeatSnapshot.currentPlan, replay.getSnapshot().currentPlan);

  const reset = first.resetDemo();
  assert.equal(reset.success, true);
  assert.equal(first.getSnapshot().stage, "IDLE");
  assert.equal(first.getSnapshot().state.stateVersion, 12);
  assert.equal(first.getSnapshot().state.routes.find((route) => route.id === "R1")?.status, "OPEN");
  assert.equal(first.getSnapshot().currentPlan, null);

  console.log("REACT deterministic demo fixture passed.");
}

void run();
