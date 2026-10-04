import "server-only";

import type { EmergencyState } from "../../domain/emergency-state/schema";
import { runAutoAiWorkflow } from "../agents/auto-ai-workflow";
import { createDemoController, type DemoAgents } from "./controller";
import type { DemoOperationResult, DemoSnapshot } from "./schema";

function createServerDemoAgents(planId: string): DemoAgents {
  let workflow:
    | ReturnType<typeof runAutoAiWorkflow>
    | undefined;
  const result = (state: EmergencyState) => {
    workflow ??= runAutoAiWorkflow(state, planId);
    return workflow;
  };
  return {
    riskAssessment: async (state) => (await result(state)).riskAssessment,
    resourceRouting: async (state) =>
      (await result(state)).resourceRoutingAssessment,
    responsePlanning: async (state) =>
      (await result(state)).responsePlanningResult,
  };
}

type DemoSession = {
  controller: ReturnType<typeof createDemoController>;
  queue: Promise<void>;
};

type SessionGlobal = typeof globalThis & {
  __reactDemoServerSession?: DemoSession;
};

function session(): DemoSession {
  const root = globalThis as SessionGlobal;
  root.__reactDemoServerSession ??= {
    controller: createDemoController(createServerDemoAgents),
    queue: Promise.resolve(),
  };
  return root.__reactDemoServerSession;
}

async function withSessionLock<T>(operation: (controller: DemoSession["controller"]) => Promise<T> | T): Promise<T> {
  const current = session();
  let release: () => void = () => {};
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previous = current.queue;
  current.queue = next;
  await previous;
  try {
    return await operation(current.controller);
  } finally {
    release();
  }
}

export function getServerDemoSnapshot(): Promise<DemoSnapshot> {
  return withSessionLock((controller) => controller.getSnapshot());
}

export function runServerDemoOperation(
  operation: (controller: DemoSession["controller"]) => Promise<DemoOperationResult> | DemoOperationResult,
): Promise<DemoOperationResult> {
  return withSessionLock(operation);
}
