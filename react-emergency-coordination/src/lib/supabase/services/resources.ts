import { ResourceSchema, type Resource } from "../../../domain/resource/schema";
import { supabase } from "../client";

type ResourceDatabaseRow = {
  id: string;
  name: string;
  type: Resource["type"];
  status: Resource["status"];
  latitude: number;
  longitude: number;
  capacity: number;
  current_assignment_id: string | null;
  capabilities: unknown;
  updated_at: string;
  created_at: string;
};

type ResourceDatabaseInsert = Omit<ResourceDatabaseRow, "created_at">;
type ResourceDatabaseUpdate = Partial<Omit<ResourceDatabaseInsert, "id">>;
type ResourceUpdates = Partial<Omit<Resource, "id">>;

function toResource(row: ResourceDatabaseRow): Resource {
  return ResourceSchema.parse({
    id: row.id,
    name: row.name,
    type: row.type,
    status: row.status,
    location: {
      latitude: row.latitude,
      longitude: row.longitude,
    },
    capacity: row.capacity,
    currentAssignmentId: row.current_assignment_id,
    capabilities: row.capabilities,
    updatedAt: row.updated_at,
  });
}

function toDatabaseInsert(resource: Resource): ResourceDatabaseInsert {
  return {
    id: resource.id,
    name: resource.name,
    type: resource.type,
    status: resource.status,
    latitude: resource.location.latitude,
    longitude: resource.location.longitude,
    capacity: resource.capacity,
    current_assignment_id: resource.currentAssignmentId,
    capabilities: resource.capabilities,
    updated_at: resource.updatedAt,
  };
}

function toDatabaseUpdates(updates: ResourceUpdates): ResourceDatabaseUpdate {
  const row: ResourceDatabaseUpdate = {};

  if (updates.name !== undefined) row.name = updates.name;
  if (updates.type !== undefined) row.type = updates.type;
  if (updates.status !== undefined) row.status = updates.status;
  if (updates.location !== undefined) {
    row.latitude = updates.location.latitude;
    row.longitude = updates.location.longitude;
  }
  if (updates.capacity !== undefined) row.capacity = updates.capacity;
  if (updates.currentAssignmentId !== undefined) {
    row.current_assignment_id = updates.currentAssignmentId;
  }
  if (updates.capabilities !== undefined) row.capabilities = updates.capabilities;
  if (updates.updatedAt !== undefined) row.updated_at = updates.updatedAt;

  return row;
}

export async function getResourceById(id: string): Promise<Resource | null> {
  const { data, error } = await supabase
    .from("resources")
    .select("*")
    .eq("id", id)
    .limit(1)
    .overrideTypes<ResourceDatabaseRow[], { merge: false }>();

  if (error) throw error;
  return data[0] === undefined ? null : toResource(data[0]);
}

export async function listResources(): Promise<Resource[]> {
  const { data, error } = await supabase
    .from("resources")
    .select("*")
    .order("updated_at", { ascending: false })
    .overrideTypes<ResourceDatabaseRow[], { merge: false }>();

  if (error) throw error;
  return data.map(toResource);
}

export async function listAvailableResources(): Promise<Resource[]> {
  const { data, error } = await supabase
    .from("resources")
    .select("*")
    .eq("status", "AVAILABLE")
    .order("updated_at", { ascending: false })
    .overrideTypes<ResourceDatabaseRow[], { merge: false }>();

  if (error) throw error;
  return data.map(toResource);
}

export async function createResource(resource: Resource): Promise<Resource> {
  const { data, error } = await supabase
    .from("resources")
    .insert(toDatabaseInsert(resource))
    .select("*")
    .limit(1)
    .overrideTypes<ResourceDatabaseRow[], { merge: false }>();

  if (error) throw error;
  const row = data[0];
  if (row === undefined) {
    throw new Error("Supabase returned no resource after insert.");
  }
  return toResource(row);
}

export async function updateResource(
  id: string,
  updates: ResourceUpdates,
): Promise<Resource | null> {
  const databaseUpdates = toDatabaseUpdates(updates);
  if (Object.keys(databaseUpdates).length === 0) {
    throw new Error("At least one resource field must be supplied for update.");
  }

  const { data, error } = await supabase
    .from("resources")
    .update(databaseUpdates)
    .eq("id", id)
    .select("*")
    .limit(1)
    .overrideTypes<ResourceDatabaseRow[], { merge: false }>();

  if (error) throw error;
  return data[0] === undefined ? null : toResource(data[0]);
}
