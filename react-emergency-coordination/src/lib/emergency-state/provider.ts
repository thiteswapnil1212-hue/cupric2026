import type { EmergencyState } from "../../domain/emergency-state/schema";
import type { ResponsePlan } from "../../domain/response-plan/schema";

export interface EmergencyStateProvider {
  getPlan(planId: string): Promise<ResponsePlan | null>;
  getStateForPlan(plan: ResponsePlan): Promise<EmergencyState | null>;
}

export class EmergencyStateProviderError extends Error {
  readonly code = "STATE_PROVIDER_UNAVAILABLE";

  constructor() {
    super("Emergency state provider is not configured.");
    this.name = "EmergencyStateProviderError";
  }
}

export function createUnavailableEmergencyStateProvider(): EmergencyStateProvider {
  return {
    async getPlan() {
      throw new EmergencyStateProviderError();
    },
    async getStateForPlan() {
      throw new EmergencyStateProviderError();
    },
  };
}
