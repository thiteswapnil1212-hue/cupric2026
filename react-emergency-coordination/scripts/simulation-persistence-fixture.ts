import assert from "node:assert/strict";
import { createDemoController } from "../src/lib/demo/controller";
import { executeApprovedPlan } from "../src/lib/simulation/engine";
import {
  persistSimulationResult,
  SimulationPersistenceError,
  type SimulationPersistenceDependencies,
} from "../src/lib/simulation/persistence";

async function run(): Promise<void> {
  const controller = createDemoController();
  await controller.startDemo();
  await controller.approveCurrentPlan();
  const state = controller.getSnapshot().state;
  const plan = controller.getSnapshot().currentPlan!;
  const result = executeApprovedPlan(state, plan);
  assert.equal(result.success, true);
  if (!result.success) throw new Error("Fixture plan should execute.");

  const writes: string[] = [];
  const dependencies: SimulationPersistenceDependencies = {
    getStateVersion: async () => state.stateVersion,
    updateResource: async (id, updates) => {
      writes.push(`resource:${id}`);
      const current = state.resources.find((resource) => resource.id === id);
      return current === undefined ? null : { ...current, ...updates };
    },
    updateFacility: async (id, updates) => {
      writes.push(`facility:${id}`);
      const current = state.facilities.find((facility) => facility.id === id);
      return current === undefined ? null : { ...current, ...updates };
    },
    updateRoute: async (id, updates) => {
      writes.push(`route:${id}`);
      const current = state.routes.find((route) => route.id === id);
      return current === undefined ? null : { ...current, ...updates };
    },
    updatePlanAction: async (id, updates) => {
      writes.push(`plan-action:${id}`);
      const current = state.planActions.find((action) => action.id === id);
      return current === undefined ? null : { ...current, ...updates };
    },
    updatePlan: async (_expectedStatus, updatedPlan) => {
      writes.push(`response-plan:${updatedPlan.id}`);
      return updatedPlan;
    },
    createStateChange: async (change) => {
      writes.push(`state-change:${change.id}`);
    },
    incrementStateVersion: async () => state.stateVersion + 1,
  };
  const persistedState = await persistSimulationResult(state, result, dependencies);
  assert.equal(persistedState.stateVersion, state.stateVersion + 1);
  assert.equal(writes.some((write) => write.startsWith("resource:")), true);
  assert.equal(writes.some((write) => write.startsWith("facility:")), true);
  assert.equal(writes.some((write) => write.startsWith("plan-action:")), true);
  assert.equal(writes.includes(`response-plan:${plan.id}`), true);
  assert.equal(writes.filter((write) => write.startsWith("state-change:")).length, result.stateChanges.length);

  const resource = state.resources[0];
  const facility = state.facilities[0];
  const route = state.routes[0];
  assert.ok(resource);
  assert.ok(facility);
  assert.ok(route);
  const fieldOnlyResult = {
    ...result,
    state: {
      ...result.state,
      resources: result.state.resources.map((candidate) =>
        candidate.id === resource.id
          ? {
              ...candidate,
              currentAssignmentId:
                resource.currentAssignmentId === "FIXTURE-ASSIGNMENT"
                  ? null
                  : "FIXTURE-ASSIGNMENT",
            }
          : candidate,
      ),
      facilities: result.state.facilities.map((candidate) =>
        candidate.id === facility.id
          ? { ...candidate, availableCapacity: candidate.availableCapacity + 1 }
          : candidate,
      ),
      routes: result.state.routes.map((candidate) =>
        candidate.id === route.id
          ? { ...candidate, blockedReason: "Fixture route detail change." }
          : candidate,
      ),
    },
  };
  const fieldWrites: string[] = [];
  await persistSimulationResult(state, fieldOnlyResult, {
    ...dependencies,
    updateResource: async (id, updates) => {
      fieldWrites.push(`resource:${id}`);
      return { ...resource, ...updates };
    },
    updateFacility: async (id, updates) => {
      fieldWrites.push(`facility:${id}`);
      return { ...facility, ...updates };
    },
    updateRoute: async (id, updates) => {
      fieldWrites.push(`route:${id}`);
      return { ...route, ...updates };
    },
  });
  assert.ok(fieldWrites.includes(`resource:${resource.id}`));
  assert.ok(fieldWrites.includes(`facility:${facility.id}`));
  assert.ok(fieldWrites.includes(`route:${route.id}`));

  const staleWrites: string[] = [];
  const staleDependencies: SimulationPersistenceDependencies = {
    ...dependencies,
    getStateVersion: async () => state.stateVersion + 1,
    updateResource: async () => { staleWrites.push("resource"); return null; },
  };
  await assert.rejects(
    persistSimulationResult(state, result, staleDependencies),
    (error: unknown) =>
      error instanceof SimulationPersistenceError &&
      error.code === "STATE_VERSION_CONFLICT",
  );
  assert.deepEqual(staleWrites, []);

  const failedSimulation = executeApprovedPlan(state, {
    ...plan,
    status: "PENDING_APPROVAL",
  });
  assert.equal(failedSimulation.success, false);
  const failedWrites: string[] = [];
  const failingDependencies: SimulationPersistenceDependencies = {
    ...dependencies,
    updateResource: async () => {
      failedWrites.push("resource");
      return null;
    },
    updateFacility: async () => null,
    updateRoute: async () => null,
    updatePlanAction: async () => null,
    updatePlan: async () => null,
    createStateChange: async () => undefined,
    incrementStateVersion: async () => state.stateVersion + 1,
  };
  await assert.rejects(
    persistSimulationResult(state, failedSimulation, failingDependencies),
    (error: unknown) =>
      error instanceof SimulationPersistenceError &&
      error.code === "SIMULATION_FAILED",
  );
  assert.deepEqual(failedWrites, []);

  console.log("Supabase simulation persistence fixture passed.");
}

void run();
