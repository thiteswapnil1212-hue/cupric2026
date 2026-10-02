import type { EmergencyState } from "../../domain/emergency-state/schema";
import type { PlanAction } from "../../domain/plan-action/schema";
import type { ResponsePlan } from "../../domain/response-plan/schema";
import type { StateChange } from "../../domain/state-change/schema";
import type { SimulationError } from "./errors";

export type SimulationEntityState =
  | {
      readonly kind: "RESOURCE";
      readonly id: string;
      readonly status: string;
      readonly currentAssignmentId: string | null;
    }
  | {
      readonly kind: "FACILITY";
      readonly id: string;
      readonly status: string;
      readonly availableCapacity: number;
    }
  | {
      readonly kind: "ROUTE";
      readonly id: string;
      readonly status: string;
    };

export type SimulationEvent = {
  readonly id: string;
  readonly actionId: string;
  readonly sequence: number;
  readonly actionType: PlanAction["type"];
  readonly resourceIds: readonly string[];
  readonly facilityIds: readonly string[];
  readonly routeIds: readonly string[];
  readonly before: readonly SimulationEntityState[];
  readonly after: readonly SimulationEntityState[];
  readonly success: boolean;
  readonly reason: string | null;
  readonly occurredAt: string;
};

export type SimulationSuccess = {
  readonly success: true;
  readonly state: EmergencyState;
  readonly plan: ResponsePlan;
  readonly executedActions: readonly string[];
  readonly failedAction: null;
  readonly remainingActions: readonly string[];
  readonly stateChanges: readonly StateChange[];
  readonly events: readonly SimulationEvent[];
  readonly error: null;
};

export type SimulationFailure = {
  readonly success: false;
  readonly state: EmergencyState;
  readonly plan: ResponsePlan;
  readonly executedActions: readonly string[];
  readonly failedAction: string | null;
  readonly remainingActions: readonly string[];
  readonly stateChanges: readonly StateChange[];
  readonly events: readonly SimulationEvent[];
  readonly error: SimulationError;
};

export type SimulationResult = SimulationSuccess | SimulationFailure;
