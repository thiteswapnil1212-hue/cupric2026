import { RouteSchema, type Route } from "../../../domain/route/schema";
import { supabase } from "../client";

type RouteDatabaseRow = {
  id: string;
  name: string;
  status: Route["status"];
  distance_km: number;
  estimated_travel_minutes: number;
  origin_latitude: number;
  origin_longitude: number;
  destination_latitude: number;
  destination_longitude: number;
  blocked_reason: string | null;
  updated_at: string;
  created_at: string;
};

type RouteDatabaseInsert = Omit<RouteDatabaseRow, "created_at">;
type RouteDatabaseUpdate = Partial<Omit<RouteDatabaseInsert, "id">>;
type RouteUpdates = Partial<Omit<Route, "id">>;

function toRoute(row: RouteDatabaseRow): Route {
  return RouteSchema.parse({
    id: row.id,
    name: row.name,
    status: row.status,
    distanceKm: row.distance_km,
    estimatedTravelMinutes: row.estimated_travel_minutes,
    origin: {
      latitude: row.origin_latitude,
      longitude: row.origin_longitude,
    },
    destination: {
      latitude: row.destination_latitude,
      longitude: row.destination_longitude,
    },
    blockedReason: row.blocked_reason,
    updatedAt: row.updated_at,
  });
}

function toDatabaseInsert(route: Route): RouteDatabaseInsert {
  return {
    id: route.id,
    name: route.name,
    status: route.status,
    distance_km: route.distanceKm,
    estimated_travel_minutes: route.estimatedTravelMinutes,
    origin_latitude: route.origin.latitude,
    origin_longitude: route.origin.longitude,
    destination_latitude: route.destination.latitude,
    destination_longitude: route.destination.longitude,
    blocked_reason: route.blockedReason,
    updated_at: route.updatedAt,
  };
}

function toDatabaseUpdates(updates: RouteUpdates): RouteDatabaseUpdate {
  const row: RouteDatabaseUpdate = {};

  if (updates.name !== undefined) row.name = updates.name;
  if (updates.status !== undefined) row.status = updates.status;
  if (updates.distanceKm !== undefined) row.distance_km = updates.distanceKm;
  if (updates.estimatedTravelMinutes !== undefined) {
    row.estimated_travel_minutes = updates.estimatedTravelMinutes;
  }
  if (updates.origin !== undefined) {
    row.origin_latitude = updates.origin.latitude;
    row.origin_longitude = updates.origin.longitude;
  }
  if (updates.destination !== undefined) {
    row.destination_latitude = updates.destination.latitude;
    row.destination_longitude = updates.destination.longitude;
  }
  if (updates.blockedReason !== undefined) {
    row.blocked_reason = updates.blockedReason;
  }
  if (updates.updatedAt !== undefined) row.updated_at = updates.updatedAt;

  return row;
}

export async function getRouteById(id: string): Promise<Route | null> {
  const { data, error } = await supabase
    .from("routes")
    .select("*")
    .eq("id", id)
    .limit(1)
    .overrideTypes<RouteDatabaseRow[], { merge: false }>();

  if (error) throw error;
  return data[0] === undefined ? null : toRoute(data[0]);
}

export async function listRoutes(): Promise<Route[]> {
  const { data, error } = await supabase
    .from("routes")
    .select("*")
    .order("updated_at", { ascending: false })
    .overrideTypes<RouteDatabaseRow[], { merge: false }>();

  if (error) throw error;
  return data.map(toRoute);
}

export async function listOpenRoutes(): Promise<Route[]> {
  const { data, error } = await supabase
    .from("routes")
    .select("*")
    .eq("status", "OPEN")
    .order("updated_at", { ascending: false })
    .overrideTypes<RouteDatabaseRow[], { merge: false }>();

  if (error) throw error;
  return data.map(toRoute);
}

export async function createRoute(route: Route): Promise<Route> {
  const { data, error } = await supabase
    .from("routes")
    .insert(toDatabaseInsert(route))
    .select("*")
    .limit(1)
    .overrideTypes<RouteDatabaseRow[], { merge: false }>();

  if (error) throw error;
  const row = data[0];
  if (row === undefined) {
    throw new Error("Supabase returned no route after insert.");
  }
  return toRoute(row);
}

export async function updateRoute(
  id: string,
  updates: RouteUpdates,
): Promise<Route | null> {
  const databaseUpdates = toDatabaseUpdates(updates);
  if (Object.keys(databaseUpdates).length === 0) {
    throw new Error("At least one route field must be supplied for update.");
  }

  const { data, error } = await supabase
    .from("routes")
    .update(databaseUpdates)
    .eq("id", id)
    .select("*")
    .limit(1)
    .overrideTypes<RouteDatabaseRow[], { merge: false }>();

  if (error) throw error;
  return data[0] === undefined ? null : toRoute(data[0]);
}
