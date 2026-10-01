import {
  PlanActionSchema,
  type PlanAction,
} from "../../../domain/plan-action/schema";
import { supabase } from "../client";

type PlanActionDatabaseRow = {
  id: string;
  plan_id: string;
  sequence: number;
  type: PlanAction["type"];
  status: PlanAction["status"];
  description: string;
  priority: PlanAction["priority"];
  resource_ids: unknown;
  facility_ids: unknown;
  route_ids: unknown;
  target_latitude: number | null;
  target_longitude: number | null;
  estimated_duration_minutes: number;
  created_at: string;
  updated_at: string;
};

type PlanActionDatabaseInsert = PlanActionDatabaseRow;
type PlanActionDatabaseUpdate = Partial<
  Omit<PlanActionDatabaseInsert, "id" | "created_at">
>;
type PlanActionUpdates = Partial<Omit<PlanAction, "id" | "createdAt">>;

function toPlanAction(row: PlanActionDatabaseRow): PlanAction {
  let targetLocation: PlanAction["targetLocation"];

  if (row.target_latitude === null && row.target_longitude === null) {
    targetLocation = null;
  } else if (
    row.target_latitude !== null &&
    row.target_longitude !== null
  ) {
    targetLocation = {
      latitude: row.target_latitude,
      longitude: row.target_longitude,
    };
  } else {
    throw new Error("Database returned an incomplete plan action target location.");
  }

  return PlanActionSchema.parse({
    id: row.id,
    planId: row.plan_id,
    sequence: row.sequence,
    type: row.type,
    status: row.status,
    description: row.description,
    priority: row.priority,
    resourceIds: row.resource_ids,
    facilityIds: row.facility_ids,
    routeIds: row.route_ids,
    targetLocation,
    estimatedDurationMinutes: row.estimated_duration_minutes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function toDatabaseInsert(action: PlanAction): PlanActionDatabaseInsert {
  return {
    id: action.id,
    plan_id: action.planId,
    sequence: action.sequence,
    type: action.type,
    status: action.status,
    description: action.description,
    priority: action.priority,
    resource_ids: action.resourceIds,
    facility_ids: action.facilityIds,
    route_ids: action.routeIds,
    target_latitude: action.targetLocation?.latitude ?? null,
    target_longitude: action.targetLocation?.longitude ?? null,
    estimated_duration_minutes: action.estimatedDurationMinutes,
    created_at: action.createdAt,
    updated_at: action.updatedAt,
  };
}

function toDatabaseUpdates(updates: PlanActionUpdates): PlanActionDatabaseUpdate {
  const row: PlanActionDatabaseUpdate = {};

  if (updates.planId !== undefined) row.plan_id = updates.planId;
  if (updates.sequence !== undefined) row.sequence = updates.sequence;
  if (updates.type !== undefined) row.type = updates.type;
  if (updates.status !== undefined) row.status = updates.status;
  if (updates.description !== undefined) row.description = updates.description;
  if (updates.priority !== undefined) row.priority = updates.priority;
  if (updates.resourceIds !== undefined) row.resource_ids = updates.resourceIds;
  if (updates.facilityIds !== undefined) row.facility_ids = updates.facilityIds;
  if (updates.routeIds !== undefined) row.route_ids = updates.routeIds;
  if (updates.targetLocation !== undefined) {
    row.target_latitude = updates.targetLocation?.latitude ?? null;
    row.target_longitude = updates.targetLocation?.longitude ?? null;
  }
  if (updates.estimatedDurationMinutes !== undefined) {
    row.estimated_duration_minutes = updates.estimatedDurationMinutes;
  }
  if (updates.updatedAt !== undefined) row.updated_at = updates.updatedAt;

  return row;
}

export async function getPlanActionById(
  id: string,
): Promise<PlanAction | null> {
  const { data, error } = await supabase
    .from("plan_actions")
    .select("*")
    .eq("id", id)
    .limit(1)
    .overrideTypes<PlanActionDatabaseRow[], { merge: false }>();

  if (error) throw error;
  return data[0] === undefined ? null : toPlanAction(data[0]);
}

export async function listPlanActionsForPlan(
  planId: string,
): Promise<PlanAction[]> {
  const { data, error } = await supabase
    .from("plan_actions")
    .select("*")
    .eq("plan_id", planId)
    .order("sequence", { ascending: true })
    .overrideTypes<PlanActionDatabaseRow[], { merge: false }>();

  if (error) throw error;
  return data.map(toPlanAction);
}

export async function createPlanAction(action: PlanAction): Promise<PlanAction> {
  const { data, error } = await supabase
    .from("plan_actions")
    .insert(toDatabaseInsert(action))
    .select("*")
    .limit(1)
    .overrideTypes<PlanActionDatabaseRow[], { merge: false }>();

  if (error) throw error;
  const row = data[0];
  if (row === undefined) {
    throw new Error("Supabase returned no plan action after insert.");
  }
  return toPlanAction(row);
}

export async function updatePlanAction(
  id: string,
  updates: PlanActionUpdates,
): Promise<PlanAction | null> {
  const databaseUpdates = toDatabaseUpdates(updates);
  if (Object.keys(databaseUpdates).length === 0) {
    throw new Error("At least one plan action field must be supplied for update.");
  }

  const { data, error } = await supabase
    .from("plan_actions")
    .update(databaseUpdates)
    .eq("id", id)
    .select("*")
    .limit(1)
    .overrideTypes<PlanActionDatabaseRow[], { merge: false }>();

  if (error) throw error;
  return data[0] === undefined ? null : toPlanAction(data[0]);
}
