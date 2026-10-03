"use client";

import type { EmergencyState } from "../../domain/emergency-state/schema";
import { AutoAiWorkflowResultSchema } from "../agents/auto-ai-workflow-contract";
import type { DemoAgentFactory } from "./controller";

export const autoAiDemoAgents: DemoAgentFactory = (planId) => {
  let resultPromise:
    | ReturnType<typeof requestWorkflow>
    | undefined;
  const getResult = (state: EmergencyState) => {
    resultPromise ??= requestWorkflow(state, planId);
    return resultPromise;
  };
  return {
    riskAssessment: async (state) => (await getResult(state)).riskAssessment,
    resourceRouting: async (state) =>
      (await getResult(state)).resourceRoutingAssessment,
    responsePlanning: async (state) =>
      (await getResult(state)).responsePlanningResult,
  };
};

async function requestWorkflow(
  state: EmergencyState,
  planId: string,
): Promise<ReturnType<typeof AutoAiWorkflowResultSchema.parse>> {
  let response: Response;
  try {
    response = await fetch("/api/demo/ai-workflow", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state, planId }),
    });
  } catch {
    throw Object.assign(
      new Error("AI workflow is unavailable. No plan was advanced."),
      { code: "AI_WORKFLOW_NETWORK_FAILED" },
    );
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const failureCode =
      typeof body === "object" &&
      body !== null &&
      "code" in body &&
      typeof body.code === "string"
        ? body.code
        : "AI_WORKFLOW_FAILED";
    throw Object.assign(
      new Error("AI workflow failed safely. No plan was advanced."),
      { code: failureCode },
    );
  }
  const body: unknown = await response.json();
  const parsed = AutoAiWorkflowResultSchema.safeParse(body);
  if (!parsed.success) {
    throw Object.assign(
      new Error("AI workflow returned an invalid response. No plan was advanced."),
      { code: "AI_WORKFLOW_INVALID" },
    );
  }
  return parsed.data;
}
