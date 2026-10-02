import { z } from "zod";
import type { EmergencyState } from "../../domain/emergency-state/schema";
import {
  validateEmergencyStateConsistency,
  type EmergencyStateConsistencyResult,
} from "./consistency";

type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

export type EmergencyStateSnapshot = {
  readonly state: DeepReadonly<EmergencyState>;
  readonly stateVersion: number;
  readonly capturedAt: string;
  readonly consistency: DeepReadonly<EmergencyStateConsistencyResult>;
};

export type EmergencyStateSnapshotFailureReason =
  | "CONSISTENCY"
  | "CAPTURE_TIMESTAMP";

export class EmergencyStateSnapshotError extends Error {
  readonly reason: EmergencyStateSnapshotFailureReason;
  readonly consistency: DeepReadonly<EmergencyStateConsistencyResult> | null;

  constructor(
    reason: EmergencyStateSnapshotFailureReason,
    message: string,
    consistency: EmergencyStateConsistencyResult | null = null,
  ) {
    super(message);
    this.name = "EmergencyStateSnapshotError";
    this.reason = reason;
    this.consistency = consistency;
  }
}

const isoDateTimeSchema = z.iso.datetime();

export function createEmergencyStateSnapshot(
  state: EmergencyState,
  capturedAt: string,
): EmergencyStateSnapshot {
  const consistency = validateEmergencyStateConsistency(state);
  if (!consistency.valid) {
    throw new EmergencyStateSnapshotError(
      "CONSISTENCY",
      `Cannot create EmergencyStateSnapshot: ${consistency.errors.length} consistency error(s).`,
      consistency,
    );
  }

  if (!isoDateTimeSchema.safeParse(capturedAt).success) {
    throw new EmergencyStateSnapshotError(
      "CAPTURE_TIMESTAMP",
      "Cannot create EmergencyStateSnapshot: capturedAt must be a valid ISO datetime.",
      consistency,
    );
  }

  return {
    state,
    stateVersion: state.stateVersion,
    capturedAt,
    consistency,
  };
}

export async function loadEmergencyStateSnapshot(
  incidentId: string,
): Promise<EmergencyStateSnapshot> {
  const { loadEmergencyState } = await import("./loader");
  const state = await loadEmergencyState(incidentId, {
    initializeMissingVersion: false,
  });

  return createEmergencyStateSnapshot(state, new Date().toISOString());
}