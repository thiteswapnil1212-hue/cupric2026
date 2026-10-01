import { IncidentSchema, type Incident } from "../../../domain/incident/schema";
import { supabase } from "../client";

type IncidentDatabaseRow = {
  id: string;
  title: string;
  description: string;
  type: Incident["type"];
  status: Incident["status"];
  severity: Incident["severity"];
  priority: Incident["priority"];
  latitude: number;
  longitude: number;
  address: string;
  affected_population: number;
  hazards: unknown;
  reported_at: string;
  updated_at: string;
  created_at: string;
};

type IncidentDatabaseInsert = Omit<IncidentDatabaseRow, "created_at">;
type IncidentDatabaseUpdate = Partial<
  Omit<IncidentDatabaseInsert, "id">
>;
type IncidentUpdates = Partial<Omit<Incident, "id">>;

function toIncident(row: IncidentDatabaseRow): Incident {
  return IncidentSchema.parse({
    id: row.id,
    title: row.title,
    description: row.description,
    type: row.type,
    status: row.status,
    severity: row.severity,
    priority: row.priority,
    location: {
      latitude: row.latitude,
      longitude: row.longitude,
      address: row.address,
    },
    affectedPopulation: row.affected_population,
    hazards: row.hazards,
    reportedAt: row.reported_at,
    updatedAt: row.updated_at,
  });
}

function toDatabaseInsert(incident: Incident): IncidentDatabaseInsert {
  return {
    id: incident.id,
    title: incident.title,
    description: incident.description,
    type: incident.type,
    status: incident.status,
    severity: incident.severity,
    priority: incident.priority,
    latitude: incident.location.latitude,
    longitude: incident.location.longitude,
    address: incident.location.address,
    affected_population: incident.affectedPopulation,
    hazards: incident.hazards,
    reported_at: incident.reportedAt,
    updated_at: incident.updatedAt,
  };
}

function toDatabaseUpdates(updates: IncidentUpdates): IncidentDatabaseUpdate {
  const row: IncidentDatabaseUpdate = {};

  if (updates.title !== undefined) row.title = updates.title;
  if (updates.description !== undefined) row.description = updates.description;
  if (updates.type !== undefined) row.type = updates.type;
  if (updates.status !== undefined) row.status = updates.status;
  if (updates.severity !== undefined) row.severity = updates.severity;
  if (updates.priority !== undefined) row.priority = updates.priority;
  if (updates.location !== undefined) {
    row.latitude = updates.location.latitude;
    row.longitude = updates.location.longitude;
    row.address = updates.location.address;
  }
  if (updates.affectedPopulation !== undefined) {
    row.affected_population = updates.affectedPopulation;
  }
  if (updates.hazards !== undefined) row.hazards = updates.hazards;
  if (updates.reportedAt !== undefined) row.reported_at = updates.reportedAt;
  if (updates.updatedAt !== undefined) row.updated_at = updates.updatedAt;

  return row;
}

export async function getIncidentById(id: string): Promise<Incident | null> {
  const { data, error } = await supabase
    .from("incidents")
    .select("*")
    .eq("id", id)
    .limit(1)
    .overrideTypes<IncidentDatabaseRow[], { merge: false }>();

  if (error) throw error;
  return data[0] === undefined ? null : toIncident(data[0]);
}

export async function listIncidents(): Promise<Incident[]> {
  const { data, error } = await supabase
    .from("incidents")
    .select("*")
    .order("updated_at", { ascending: false })
    .overrideTypes<IncidentDatabaseRow[], { merge: false }>();

  if (error) throw error;
  return data.map(toIncident);
}

export async function createIncident(incident: Incident): Promise<Incident> {
  const { data, error } = await supabase
    .from("incidents")
    .insert(toDatabaseInsert(incident))
    .select("*")
    .limit(1)
    .overrideTypes<IncidentDatabaseRow[], { merge: false }>();

  if (error) throw error;
  const row = data[0];
  if (row === undefined) {
    throw new Error("Supabase returned no incident after insert.");
  }
  return toIncident(row);
}

export async function updateIncident(
  id: string,
  updates: IncidentUpdates,
): Promise<Incident | null> {
  const databaseUpdates = toDatabaseUpdates(updates);
  if (Object.keys(databaseUpdates).length === 0) {
    throw new Error("At least one incident field must be supplied for update.");
  }

  const { data, error } = await supabase
    .from("incidents")
    .update(databaseUpdates)
    .eq("id", id)
    .select("*")
    .limit(1)
    .overrideTypes<IncidentDatabaseRow[], { merge: false }>();

  if (error) throw error;
  return data[0] === undefined ? null : toIncident(data[0]);
}
