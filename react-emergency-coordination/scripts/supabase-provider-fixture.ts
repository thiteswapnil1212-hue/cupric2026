import assert from "node:assert/strict";
import type { HumanDecision } from "../src/domain/human-decision/schema";
import type { EmergencyStateLoaderDependencies } from "../src/lib/emergency-state/loader";
import {
  EmergencyStateLoadError,
  loadEmergencyState,
} from "../src/lib/emergency-state/loader";
import {
  createSupabaseEmergencyStateProvider,
  EmergencyStateProviderError,
  type EmergencyStateProviderDependencies,
} from "../src/lib/emergency-state/provider";
import { getDemoState } from "../src/lib/demo/fixtures";

const fixture = getDemoState("initial");
const state = fixture.state;
const humanDecision: HumanDecision = {
  id: "DECISION-001",
  planId: "PLAN-001",
  incidentId: state.incident.id,
  decision: "APPROVE",
  status: "RECORDED",
  coordinatorId: "COORDINATOR-001",
  reason: "Fixture approval.",
  modifiedPlanId: null,
  decidedAt: "2026-10-02T08:46:00.000Z",
  recordedAt: "2026-10-02T08:46:00.000Z",
};

function loaderDependencies(
  overrides: Partial<EmergencyStateLoaderDependencies> = {},
): EmergencyStateLoaderDependencies {
  return {
    getIncident: async (incidentId) =>
      incidentId === state.incident.id ? state.incident : null,
    getVersion: async () => state.stateVersion,
    initializeVersion: async () => state.stateVersion,
    listResources: async () => [...state.resources],
    listFacilities: async () => [...state.facilities],
    listRoutes: async () => [...state.routes],
    getActivePlan: async () => state.activePlan,
    listPlanActions: async (planId) =>
      state.planActions.filter((action) => action.planId === planId),
    ...overrides,
  };
}

function providerDependencies(
  overrides: Partial<EmergencyStateProviderDependencies> = {},
): EmergencyStateProviderDependencies {
  return {
    getPlan: async (planId) =>
      state.activePlan?.id === planId ? state.activePlan : null,
    loadState: async () => state,
    listPlanActions: async (planId) =>
      state.planActions.filter((action) => action.planId === planId),
    listStateChanges: async (incidentId) =>
      fixture.stateChanges.filter(
        (change) => change.entityType === "INCIDENT" && change.entityId === incidentId,
      ),
    listAgentRuns: async () => [...fixture.agentRuns],
    listPlans: async () => [{ id: state.activePlan!.id }],
    listHumanDecisions: async () => [humanDecision],
    updatePlan: async (_expectedStatus, plan) => plan,
    createPlan: async () => undefined,
    createPlanAction: async () => undefined,
    createDecision: async () => undefined,
    createStateChange: async () => undefined,
    ...overrides,
  };
}

async function expectLoadError(
  dependencies: EmergencyStateLoaderDependencies,
  code: EmergencyStateLoadError["code"],
): Promise<void> {
  await assert.rejects(
    loadEmergencyState(state.incident.id, {}, dependencies),
    (error: unknown) =>
      error instanceof EmergencyStateLoadError && error.code === code,
  );
}

async function run(): Promise<void> {
  const loaded = await loadEmergencyState(
    state.incident.id,
    {},
    loaderDependencies(),
  );
  assert.deepEqual(loaded, state);

  const emptyCollectionsState = await loadEmergencyState(
    state.incident.id,
    {},
    loaderDependencies({
      listResources: async () => [],
      listFacilities: async () => [],
      listRoutes: async () => [],
      getActivePlan: async () => null,
    }),
  );
  assert.deepEqual(emptyCollectionsState.resources, []);
  assert.deepEqual(emptyCollectionsState.facilities, []);
  assert.deepEqual(emptyCollectionsState.routes, []);
  assert.equal(emptyCollectionsState.activePlan, null);

  await expectLoadError(
    loaderDependencies({ getIncident: async () => null }),
    "INCIDENT_NOT_FOUND",
  );
  await expectLoadError(
    loaderDependencies({ getVersion: async () => null }),
    "STATE_NOT_FOUND",
  );
  await expectLoadError(
    loaderDependencies({
      listResources: async () => [
        ...state.resources,
        { ...state.resources[0]! },
      ],
    }),
    "INVALID_PERSISTED_STATE",
  );
  await expectLoadError(
    loaderDependencies({ listRoutes: async () => { throw new Error("database down"); } }),
    "DATABASE_ERROR",
  );
  await expectLoadError(
    loaderDependencies({ listRoutes: async () => { throw new TypeError("fetch failed"); } }),
    "DATABASE_UNAVAILABLE",
  );
  let versionReads = 0;
  await expectLoadError(
    loaderDependencies({
      getVersion: async () => {
        versionReads += 1;
        return versionReads === 1 ? state.stateVersion : state.stateVersion + 1;
      },
    }),
    "STATE_VERSION_CONFLICT",
  );

  const provider = createSupabaseEmergencyStateProvider(providerDependencies());
  assert.deepEqual(await provider.getStateForIncident(state.incident.id), state);
  const plan = await provider.getPlan(state.activePlan!.id);
  assert.deepEqual(plan, state.activePlan);
  const context = await provider.getStateForPlan(plan!);
  assert.ok(context);
  assert.deepEqual(context.state, state);
  assert.deepEqual(
    context.stateChanges,
    fixture.stateChanges.filter((change) => change.entityType === "INCIDENT"),
  );
  assert.deepEqual(context.agentRuns, fixture.agentRuns);
  assert.deepEqual(context.humanDecisions, [humanDecision]);

  const missingPlanProvider = createSupabaseEmergencyStateProvider(
    providerDependencies({ getPlan: async () => null }),
  );
  assert.equal(await missingPlanProvider.getPlan("unknown"), null);

  const unavailableProvider = createSupabaseEmergencyStateProvider(
    providerDependencies({
      loadState: async () => {
        throw new EmergencyStateLoadError(
          "DATABASE_UNAVAILABLE",
          "Database unavailable.",
        );
      },
    }),
  );
  await assert.rejects(
    unavailableProvider.getStateForPlan(state.activePlan!),
    (error: unknown) =>
      error instanceof EmergencyStateProviderError &&
      error.code === "DATABASE_UNAVAILABLE",
  );
  await assert.rejects(
    unavailableProvider.getStateForIncident(state.incident.id),
    (error: unknown) =>
      error instanceof EmergencyStateProviderError &&
      error.code === "DATABASE_UNAVAILABLE",
  );

  const newerState = await loadEmergencyState(
    state.incident.id,
    {},
    loaderDependencies({
      getVersion: async () => state.stateVersion + 1,
    }),
  );
  assert.equal(newerState.stateVersion, state.stateVersion + 1);

  console.log("Supabase EmergencyState provider fixture passed.");
}

void run();
