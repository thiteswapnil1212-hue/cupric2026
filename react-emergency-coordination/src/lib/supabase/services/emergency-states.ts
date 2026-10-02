import { supabase } from "../client";

type EmergencyStateVersionDatabaseRow = {
  incident_id: string;
  state_version: number;
  updated_at: string;
};

function assertIncidentId(incidentId: string): void {
  if (typeof incidentId !== "string" || incidentId.trim().length === 0) {
    throw new TypeError("incidentId must be a non-empty string.");
  }
}

function assertStateVersion(stateVersion: number): number {
  if (!Number.isSafeInteger(stateVersion) || stateVersion < 1) {
    throw new Error(`Invalid persisted emergency state version: ${stateVersion}`);
  }
  return stateVersion;
}

export async function getEmergencyStateVersion(
  incidentId: string,
): Promise<number | null> {
  assertIncidentId(incidentId);

  const { data, error } = await supabase
    .from("emergency_states")
    .select("incident_id, state_version, updated_at")
    .eq("incident_id", incidentId)
    .limit(1)
    .overrideTypes<EmergencyStateVersionDatabaseRow[], { merge: false }>();

  if (error) throw error;
  const row = data[0];
  return row === undefined ? null : assertStateVersion(row.state_version);
}

export async function initializeEmergencyStateVersion(
  incidentId: string,
): Promise<number> {
  assertIncidentId(incidentId);

  const { error } = await supabase.from("emergency_states").upsert(
    { incident_id: incidentId },
    { onConflict: "incident_id", ignoreDuplicates: true },
  );

  if (error) throw error;

  const stateVersion = await getEmergencyStateVersion(incidentId);
  if (stateVersion === null) {
    throw new Error(
      `Emergency state version was not initialized for incident ${incidentId}.`,
    );
  }
  return stateVersion;
}

export async function incrementEmergencyStateVersion(
  incidentId: string,
): Promise<number> {
  assertIncidentId(incidentId);

  const { data, error } = await supabase
    .rpc("increment_emergency_state_version", {
      p_incident_id: incidentId,
    })
    .overrideTypes<number, { merge: false }>();

  if (error) throw error;
  return assertStateVersion(data);
}