import assert from "node:assert/strict";
import { createDemoController, type DemoSimulationExecutor } from "../src/lib/demo/controller";
import { executeApprovedPlan } from "../src/lib/simulation/engine";

async function run(): Promise<void> {
  const controller = createDemoController();
  assert.equal(controller.getSnapshot().stage, "IDLE");
  assert.equal(controller.getSnapshot().currentPlan, null);

  assert.equal((await controller.startDemo()).success, true);
  assert.equal(controller.getSnapshot().stage, "AWAITING_APPROVAL");
  assert.equal(controller.getSnapshot().currentPlan?.status, "PENDING_APPROVAL");
  const pendingSnapshot = controller.getSnapshot();
  const pendingExecution = executeApprovedPlan(pendingSnapshot.state, pendingSnapshot.currentPlan!);
  assert.equal(pendingExecution.success, false);
  if (!pendingExecution.success) assert.equal(pendingExecution.error.code, "PLAN_NOT_EXECUTABLE");
  const deniedPendingExecution = controller.beginExecution();
  assert.equal(deniedPendingExecution.success, false);
  assert.equal(controller.getSnapshot().currentPlan?.status, "PENDING_APPROVAL");

  assert.equal(controller.resetDemo().success, true);
  await controller.startDemo();
  assert.equal((await controller.approveCurrentPlan()).success, true);
  assert.equal(controller.getSnapshot().stage, "AWAITING_EXECUTION");
  assert.equal(controller.getSnapshot().currentPlan?.status, "APPROVED");
  assert.equal(controller.getSnapshot().stateChanges.some((change) => change.description.includes("approved by the coordinator")), true);
  assert.equal(controller.getSnapshot().state.resources.some((resource) => resource.status === "DISPATCHED"), false);

  const approvedState = controller.getSnapshot().state;
  const approvedPlan = controller.getSnapshot().currentPlan!;
  const staleExecution = executeApprovedPlan(approvedState, {
    ...approvedPlan,
    stateVersion: approvedPlan.stateVersion - 1,
  });
  assert.equal(staleExecution.success, false);
  if (!staleExecution.success) assert.equal(staleExecution.error.code, "PLAN_STALE");

  const invalidExecution = executeApprovedPlan(approvedState, {
    ...approvedPlan,
    actions: [{ actionId: "MISSING-ACTION", sequence: 1 }],
  });
  assert.equal(invalidExecution.success, false);

  assert.equal(controller.beginExecution().success, true);
  assert.equal(controller.getSnapshot().stage, "EXECUTING");
  assert.equal(controller.completeExecution().success, true);
  assert.equal(controller.getSnapshot().stage, "COMPLETED");
  assert.equal(controller.getSnapshot().currentPlan?.status, "COMPLETED");
  assert.equal(controller.getSnapshot().planHistory[0]?.status, "COMPLETED");

  const blockage = await controller.simulateRouteBlockage();
  assert.equal(blockage.success, true);
  assert.equal(controller.getSnapshot().state.routes.find((route) => route.id === "R1")?.status, "BLOCKED");
  assert.equal(controller.getSnapshot().stage, "AWAITING_REVISED_APPROVAL");
  assert.equal(controller.getSnapshot().currentPlan?.id, "PLAN-002");
  assert.equal(controller.getSnapshot().currentPlan?.status, "PENDING_APPROVAL");
  assert.equal(controller.getSnapshot().previousPlan?.id, "PLAN-001");
  assert.equal(controller.getSnapshot().stateChanges.some((change) => change.description.includes("PLAN_AFFECTED_REASSESSMENT_REQUIRED")), true);
  assert.equal(controller.getSnapshot().stateChanges.some((change) => change.description.includes("Reassessment started")), true);
  assert.deepEqual(
    controller.getSnapshot().planHistory.map((plan) => [plan.id, plan.status]),
    [["PLAN-001", "COMPLETED"], ["PLAN-002", "PENDING_APPROVAL"]],
  );

  assert.equal((await controller.approveCurrentPlan()).success, true);
  assert.equal(controller.getSnapshot().stage, "AWAITING_EXECUTION");
  assert.equal(controller.beginExecution().success, true);
  assert.equal(controller.getSnapshot().stage, "EXECUTING_REVISED_PLAN");
  assert.equal(controller.completeExecution().success, true);
  assert.equal(controller.getSnapshot().stage, "COMPLETED");
  assert.equal(controller.getSnapshot().currentPlan?.status, "COMPLETED");
  assert.equal(controller.getSnapshot().state.routes.find((route) => route.id === "R1")?.status, "BLOCKED");
  assert.equal(controller.getSnapshot().state.routes.find((route) => route.id === "R2")?.status, "OPEN");

  assert.equal(controller.resetDemo().success, true);
  assert.equal(controller.getSnapshot().stage, "IDLE");
  assert.equal(controller.getSnapshot().planHistory.length, 0);
  assert.equal((await controller.startDemo()).success, true);
  assert.equal(controller.getSnapshot().stage, "AWAITING_APPROVAL");

  const rejectedController = createDemoController();
  await rejectedController.startDemo();
  const rejectedSnapshot = rejectedController.getSnapshot();
  const rejectedExecution = executeApprovedPlan(rejectedSnapshot.state, {
    ...rejectedSnapshot.currentPlan!,
    status: "REJECTED",
  });
  assert.equal(rejectedExecution.success, false);
  if (!rejectedExecution.success) assert.equal(rejectedExecution.error.code, "PLAN_NOT_EXECUTABLE");
  assert.equal(rejectedController.rejectCurrentPlan("Route plan is unsafe.").success, true);
  assert.equal(rejectedController.getSnapshot().currentPlan?.status, "REJECTED");
  assert.equal(rejectedController.beginExecution().success, false);
  assert.equal(rejectedController.resetDemo().success, true);
  assert.equal((await rejectedController.startDemo()).success, true);

  const modifiedController = createDemoController();
  await modifiedController.startDemo();
  assert.equal((await modifiedController.modifyCurrentPlan("Use the alternative response team.")).success, true);
  assert.equal(modifiedController.getSnapshot().humanDecision?.decision, "MODIFY");
  assert.equal(modifiedController.getSnapshot().stage, "AWAITING_APPROVAL");
  assert.equal(modifiedController.getSnapshot().currentPlan?.id, "PLAN-002");
  assert.equal(modifiedController.getSnapshot().currentPlan?.status, "PENDING_APPROVAL");
  assert.equal(modifiedController.getSnapshot().planHistory[0]?.status, "SUPERSEDED");
  assert.equal(modifiedController.beginExecution().success, false);

  const failureExecutor: DemoSimulationExecutor = (state, plan) =>
    executeApprovedPlan(
      {
        ...state,
        routes: state.routes.map((route) =>
          route.id === "R1"
            ? { ...route, status: "BLOCKED", blockedReason: "Tested simulation failure." }
            : route,
        ),
      },
      plan,
    );
  const failureController = createDemoController(undefined, failureExecutor);
  await failureController.startDemo();
  await failureController.approveCurrentPlan();
  const preExecutionState = failureController.getSnapshot().state;
  failureController.beginExecution();
  const failedExecution = failureController.completeExecution();
  assert.equal(failedExecution.success, false);
  assert.equal(failureController.getSnapshot().stage, "FAILED");
  assert.equal(failureController.getSnapshot().currentPlan?.status, "APPROVED");
  assert.deepEqual(failureController.getSnapshot().state, preExecutionState);
  assert.equal(failureController.resetDemo().success, true);
  assert.equal(failureController.getSnapshot().stage, "IDLE");
  assert.equal((await failureController.startDemo()).success, true);

  console.log("REACT approval, execution, replanning, safety, and recovery fixture passed.");
}

void run();
