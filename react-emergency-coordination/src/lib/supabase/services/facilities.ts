import { FacilitySchema, type Facility } from "../../../domain/facility/schema";
import { supabase } from "../client";
import { normalizeDatabaseTimestamp } from "./timestamps";

type FacilityDatabaseRow = {
  id: string;
  name: string;
  type: Facility["type"];
  status: Facility["status"];
  latitude: number;
  longitude: number;
  address: string;
  total_capacity: number;
  available_capacity: number;
  capabilities: unknown;
  updated_at: string;
  created_at: string;
};

type FacilityDatabaseInsert = Omit<FacilityDatabaseRow, "created_at">;
type FacilityDatabaseUpdate = Partial<Omit<FacilityDatabaseInsert, "id">>;
type FacilityUpdates = Partial<Omit<Facility, "id">>;

function toFacility(row: FacilityDatabaseRow): Facility {
  return FacilitySchema.parse({
    id: row.id,
    name: row.name,
    type: row.type,
    status: row.status,
    location: {
      latitude: row.latitude,
      longitude: row.longitude,
      address: row.address,
    },
    totalCapacity: row.total_capacity,
    availableCapacity: row.available_capacity,
    capabilities: row.capabilities,
    updatedAt: normalizeDatabaseTimestamp(row.updated_at),
  });
}

function toDatabaseInsert(facility: Facility): FacilityDatabaseInsert {
  return {
    id: facility.id,
    name: facility.name,
    type: facility.type,
    status: facility.status,
    latitude: facility.location.latitude,
    longitude: facility.location.longitude,
    address: facility.location.address,
    total_capacity: facility.totalCapacity,
    available_capacity: facility.availableCapacity,
    capabilities: facility.capabilities,
    updated_at: facility.updatedAt,
  };
}

function toDatabaseUpdates(updates: FacilityUpdates): FacilityDatabaseUpdate {
  const row: FacilityDatabaseUpdate = {};

  if (updates.name !== undefined) row.name = updates.name;
  if (updates.type !== undefined) row.type = updates.type;
  if (updates.status !== undefined) row.status = updates.status;
  if (updates.location !== undefined) {
    row.latitude = updates.location.latitude;
    row.longitude = updates.location.longitude;
    row.address = updates.location.address;
  }
  if (updates.totalCapacity !== undefined) {
    row.total_capacity = updates.totalCapacity;
  }
  if (updates.availableCapacity !== undefined) {
    row.available_capacity = updates.availableCapacity;
  }
  if (updates.capabilities !== undefined) row.capabilities = updates.capabilities;
  if (updates.updatedAt !== undefined) row.updated_at = updates.updatedAt;

  return row;
}

export async function getFacilityById(id: string): Promise<Facility | null> {
  const { data, error } = await supabase
    .from("facilities")
    .select("*")
    .eq("id", id)
    .limit(1)
    .overrideTypes<FacilityDatabaseRow[], { merge: false }>();

  if (error) throw error;
  return data[0] === undefined ? null : toFacility(data[0]);
}

export async function listFacilities(): Promise<Facility[]> {
  const { data, error } = await supabase
    .from("facilities")
    .select("*")
    .order("updated_at", { ascending: false })
    .overrideTypes<FacilityDatabaseRow[], { merge: false }>();

  if (error) throw error;
  return data.map(toFacility);
}

export async function listOperationalFacilities(): Promise<Facility[]> {
  const { data, error } = await supabase
    .from("facilities")
    .select("*")
    .eq("status", "OPERATIONAL")
    .order("updated_at", { ascending: false })
    .overrideTypes<FacilityDatabaseRow[], { merge: false }>();

  if (error) throw error;
  return data.map(toFacility);
}

export async function createFacility(facility: Facility): Promise<Facility> {
  const { data, error } = await supabase
    .from("facilities")
    .insert(toDatabaseInsert(facility))
    .select("*")
    .limit(1)
    .overrideTypes<FacilityDatabaseRow[], { merge: false }>();

  if (error) throw error;
  const row = data[0];
  if (row === undefined) {
    throw new Error("Supabase returned no facility after insert.");
  }
  return toFacility(row);
}

export async function updateFacility(
  id: string,
  updates: FacilityUpdates,
): Promise<Facility | null> {
  const databaseUpdates = toDatabaseUpdates(updates);
  if (Object.keys(databaseUpdates).length === 0) {
    throw new Error("At least one facility field must be supplied for update.");
  }

  const { data, error } = await supabase
    .from("facilities")
    .update(databaseUpdates)
    .eq("id", id)
    .select("*")
    .limit(1)
    .overrideTypes<FacilityDatabaseRow[], { merge: false }>();

  if (error) throw error;
  return data[0] === undefined ? null : toFacility(data[0]);
}
