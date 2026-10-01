import {
  StateChangeSchema,
  type StateChange,
} from "../../../domain/state-change/schema";
import { supabase } from "../client";

type StateChangeDatabaseRow = {
  id: string;
  entity_type: StateChange["entityType"];
  entity_id: string;
  change_type: StateChange["changeType"];
  description: string;
  previous_value: unknown | null;
  new_value: unknown | null;
  occurred_at: string;
  detected_at: string;
  created_at: string;
};

type StateChangeDatabaseInsert = Omit<StateChangeDatabaseRow, "created_at">;

function toStateChange(row: StateChangeDatabaseRow): StateChange {
  return StateChangeSchema.parse({
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    changeType: row.change_type,
    description: row.description,
    previousValue: row.previous_value,
    newValue: row.new_value,
    occurredAt: row.occurred_at,
    detectedAt: row.detected_at,
  });
}

function toDatabaseInsert(change: StateChange): StateChangeDatabaseInsert {
  return {
    id: change.id,
    entity_type: change.entityType,
    entity_id: change.entityId,
    change_type: change.changeType,
    description: change.description,
    previous_value: change.previousValue,
    new_value: change.newValue,
    occurred_at: change.occurredAt,
    detected_at: change.detectedAt,
  };
}

export async function getStateChangeById(
  id: string,
): Promise<StateChange | null> {
  const { data, error } = await supabase
    .from("state_changes")
    .select("*")
    .eq("id", id)
    .limit(1)
    .overrideTypes<StateChangeDatabaseRow[], { merge: false }>();

  if (error) throw error;
  return data[0] === undefined ? null : toStateChange(data[0]);
}

export async function listStateChangesForIncident(
  incidentId: string,
): Promise<StateChange[]> {
  const { data, error } = await supabase
    .from("state_changes")
    .select("*")
    .eq("entity_type", "INCIDENT")
    .eq("entity_id", incidentId)
    .order("detected_at", { ascending: true })
    .overrideTypes<StateChangeDatabaseRow[], { merge: false }>();

  if (error) throw error;
  return data.map(toStateChange);
}

export async function createStateChange(
  change: StateChange,
): Promise<StateChange> {
  const { data, error } = await supabase
    .from("state_changes")
    .insert(toDatabaseInsert(change))
    .select("*")
    .limit(1)
    .overrideTypes<StateChangeDatabaseRow[], { merge: false }>();

  if (error) throw error;
  const row = data[0];
  if (row === undefined) {
    throw new Error("Supabase returned no state change after insert.");
  }
  return toStateChange(row);
}
