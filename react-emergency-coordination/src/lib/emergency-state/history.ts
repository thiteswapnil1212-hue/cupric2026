import { z } from "zod";
import type { StateChange } from "../../domain/state-change/schema";
import { listStateChangesForIncident } from "../supabase/services";

export type EmergencyStateHistoryOptions = {
  limit?: number;
  since?: string;
};

const isoDateTimeSchema = z.iso.datetime();

/**
 * Returns history rows recorded directly against the incident entity.
 * The current state_changes schema cannot associate other entity rows with an incident.
 */
export async function getEmergencyStateHistory(
  incidentId: string,
  options: EmergencyStateHistoryOptions = {},
): Promise<StateChange[]> {
  if (incidentId.trim().length === 0) {
    throw new TypeError("incidentId must be a non-empty string.");
  }
  if (
    options.limit !== undefined &&
    (!Number.isSafeInteger(options.limit) || options.limit < 1)
  ) {
    throw new RangeError("History limit must be a positive safe integer.");
  }

  let sinceTimestamp: number | null = null;
  if (options.since !== undefined) {
    if (!isoDateTimeSchema.safeParse(options.since).success) {
      throw new TypeError("History since must be a valid ISO datetime.");
    }
    sinceTimestamp = Date.parse(options.since);
  }

  const changes = await listStateChangesForIncident(incidentId);
  const orderedChanges = changes
    .filter(
      (change) =>
        sinceTimestamp === null || Date.parse(change.detectedAt) >= sinceTimestamp,
    )
    .sort((left, right) => {
      const timestampDifference =
        Date.parse(right.detectedAt) - Date.parse(left.detectedAt);
      if (timestampDifference !== 0) return timestampDifference;
      if (left.id < right.id) return -1;
      if (left.id > right.id) return 1;
      return 0;
    });

  return options.limit === undefined
    ? orderedChanges
    : orderedChanges.slice(0, options.limit);
}