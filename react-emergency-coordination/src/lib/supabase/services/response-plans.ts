import type { ResponsePlan } from "../../../domain/response-plan/schema";
import { supabase } from "../client";

type ResponsePlanDatabaseRow = {
  id: string;
  incident_id: string;
  state_version: number;
  status: ResponsePlan["status"];
  priority: ResponsePlan["priority"];
  summary: string;
  rationale: string;
  generated_at: string;
  updated_at: string;
  created_at: string;
};

export type ResponsePlanRecord = Pick<
  ResponsePlan,
  | "id"
  | "incidentId"
  | "stateVersion"
  | "status"
  | "priority"
  | "summary"
  | "rationale"
  | "generatedAt"
  | "updatedAt"
> & { createdAt: string };

export type CreateResponsePlanInput = Omit<ResponsePlanRecord, "createdAt">;
export type ResponsePlanUpdates = Partial<
  Omit<CreateResponsePlanInput, "id">
>;

type ResponsePlanDatabaseInsert = Omit<
  ResponsePlanDatabaseRow,
  "created_at"
>;
type ResponsePlanDatabaseUpdate = Partial<
  Omit<ResponsePlanDatabaseInsert, "id">
>;

const activePlanStatuses: ResponsePlan["status"][] = [
  "PENDING_APPROVAL",
  "APPROVED",
  "MODIFIED",
  "EXECUTING",
];

function toResponsePlanRecord(
  row: ResponsePlanDatabaseRow,
): ResponsePlanRecord {
  return {
    id: row.id,
    incidentId: row.incident_id,
    stateVersion: row.state_version,
    status: row.status,
    priority: row.priority,
    summary: row.summary,
    rationale: row.rationale,
    generatedAt: row.generated_at,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

function toDatabaseInsert(
  plan: CreateResponsePlanInput,
): ResponsePlanDatabaseInsert {
  return {
    id: plan.id,
    incident_id: plan.incidentId,
    state_version: plan.stateVersion,
    status: plan.status,
    priority: plan.priority,
    summary: plan.summary,
    rationale: plan.rationale,
    generated_at: plan.generatedAt,
    updated_at: plan.updatedAt,
  };
}

function toDatabaseUpdates(
  updates: ResponsePlanUpdates,
): ResponsePlanDatabaseUpdate {
  const row: ResponsePlanDatabaseUpdate = {};

  if (updates.incidentId !== undefined) row.incident_id = updates.incidentId;
  if (updates.stateVersion !== undefined) row.state_version = updates.stateVersion;
  if (updates.status !== undefined) row.status = updates.status;
  if (updates.priority !== undefined) row.priority = updates.priority;
  if (updates.summary !== undefined) row.summary = updates.summary;
  if (updates.rationale !== undefined) row.rationale = updates.rationale;
  if (updates.generatedAt !== undefined) row.generated_at = updates.generatedAt;
  if (updates.updatedAt !== undefined) row.updated_at = updates.updatedAt;

  return row;
}

export async function getResponsePlanById(
  id: string,
): Promise<ResponsePlanRecord | null> {
  const { data, error } = await supabase
    .from("response_plans")
    .select("*")
    .eq("id", id)
    .limit(1)
    .overrideTypes<ResponsePlanDatabaseRow[], { merge: false }>();

  if (error) throw error;
  return data[0] === undefined ? null : toResponsePlanRecord(data[0]);
}

export async function listResponsePlansForIncident(
  incidentId: string,
): Promise<ResponsePlanRecord[]> {
  const { data, error } = await supabase
    .from("response_plans")
    .select("*")
    .eq("incident_id", incidentId)
    .order("updated_at", { ascending: false })
    .overrideTypes<ResponsePlanDatabaseRow[], { merge: false }>();

  if (error) throw error;
  return data.map(toResponsePlanRecord);
}

export async function getActiveResponsePlanForIncident(
  incidentId: string,
): Promise<ResponsePlanRecord | null> {
  const { data, error } = await supabase
    .from("response_plans")
    .select("*")
    .eq("incident_id", incidentId)
    .in("status", activePlanStatuses)
    .order("updated_at", { ascending: false })
    .limit(1)
    .overrideTypes<ResponsePlanDatabaseRow[], { merge: false }>();

  if (error) throw error;
  return data[0] === undefined ? null : toResponsePlanRecord(data[0]);
}

export async function createResponsePlan(
  plan: CreateResponsePlanInput,
): Promise<ResponsePlanRecord> {
  const { data, error } = await supabase
    .from("response_plans")
    .insert(toDatabaseInsert(plan))
    .select("*")
    .limit(1)
    .overrideTypes<ResponsePlanDatabaseRow[], { merge: false }>();

  if (error) throw error;
  const row = data[0];
  if (row === undefined) {
    throw new Error("Supabase returned no response plan after insert.");
  }
  return toResponsePlanRecord(row);
}

export async function updateResponsePlan(
  id: string,
  updates: ResponsePlanUpdates,
): Promise<ResponsePlanRecord | null> {
  const databaseUpdates = toDatabaseUpdates(updates);
  if (Object.keys(databaseUpdates).length === 0) {
    throw new Error("At least one response plan field must be supplied for update.");
  }

  const { data, error } = await supabase
    .from("response_plans")
    .update(databaseUpdates)
    .eq("id", id)
    .select("*")
    .limit(1)
    .overrideTypes<ResponsePlanDatabaseRow[], { merge: false }>();

  if (error) throw error;
  return data[0] === undefined ? null : toResponsePlanRecord(data[0]);
}
