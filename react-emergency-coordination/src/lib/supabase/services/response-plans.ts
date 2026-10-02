import type { PlanAction } from "../../../domain/plan-action/schema";
import {
  ResponsePlanSchema,
  type ResponsePlan,
} from "../../../domain/response-plan/schema";
import { supabase } from "../client";
import { listPlanActionsForPlan } from "./plan-actions";

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

export type CreateResponsePlanInput = Omit<ResponsePlan, "actions">;
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

type ResponsePlanAlternativeRow = {
  plan_id: string;
  sequence: number;
  id: string;
  summary: string;
  rationale: string;
};

type ResponsePlanResourceDependencyRow = {
  plan_id: string;
  sequence: number;
  resource_id: string;
};

type ResponsePlanFacilityDependencyRow = {
  plan_id: string;
  sequence: number;
  facility_id: string;
};

type ResponsePlanRouteDependencyRow = {
  plan_id: string;
  sequence: number;
  route_id: string;
};

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

async function listPlanAlternatives(
  planId: string,
): Promise<ResponsePlanAlternativeRow[]> {
  const { data, error } = await supabase
    .from("response_plan_alternatives")
    .select("plan_id, sequence, id, summary, rationale")
    .eq("plan_id", planId)
    .order("sequence", { ascending: true })
    .overrideTypes<ResponsePlanAlternativeRow[], { merge: false }>();

  if (error) throw error;
  return data;
}

async function listPlanResourceDependencies(
  planId: string,
): Promise<ResponsePlanResourceDependencyRow[]> {
  const { data, error } = await supabase
    .from("response_plan_resource_dependencies")
    .select("plan_id, sequence, resource_id")
    .eq("plan_id", planId)
    .order("sequence", { ascending: true })
    .overrideTypes<ResponsePlanResourceDependencyRow[], { merge: false }>();

  if (error) throw error;
  return data;
}

async function listPlanFacilityDependencies(
  planId: string,
): Promise<ResponsePlanFacilityDependencyRow[]> {
  const { data, error } = await supabase
    .from("response_plan_facility_dependencies")
    .select("plan_id, sequence, facility_id")
    .eq("plan_id", planId)
    .order("sequence", { ascending: true })
    .overrideTypes<
      ResponsePlanFacilityDependencyRow[],
      { merge: false }
    >();

  if (error) throw error;
  return data;
}

async function listPlanRouteDependencies(
  planId: string,
): Promise<ResponsePlanRouteDependencyRow[]> {
  const { data, error } = await supabase
    .from("response_plan_route_dependencies")
    .select("plan_id, sequence, route_id")
    .eq("plan_id", planId)
    .order("sequence", { ascending: true })
    .overrideTypes<ResponsePlanRouteDependencyRow[], { merge: false }>();

  if (error) throw error;
  return data;
}

async function toCompleteResponsePlan(
  row: ResponsePlanDatabaseRow,
): Promise<ResponsePlan> {
  const [actions, alternatives, resourceDependencies, facilityDependencies, routeDependencies] =
    await Promise.all([
      listPlanActionsForPlan(row.id),
      listPlanAlternatives(row.id),
      listPlanResourceDependencies(row.id),
      listPlanFacilityDependencies(row.id),
      listPlanRouteDependencies(row.id),
    ]);

  if (actions.length === 0) {
    throw new Error(
      `Response plan ${row.id} has no persisted PlanAction records; it cannot be reconstructed.`,
    );
  }

  const orderedActions = [...actions].sort((left, right) => {
    if (left.sequence !== right.sequence) return left.sequence - right.sequence;
    if (left.id < right.id) return -1;
    if (left.id > right.id) return 1;
    return 0;
  });
  if (orderedActions.some((action) => action.planId !== row.id)) {
    throw new Error(
      `Response plan ${row.id} resolved a PlanAction belonging to another plan.`,
    );
  }

  return ResponsePlanSchema.parse({
    id: row.id,
    incidentId: row.incident_id,
    stateVersion: row.state_version,
    status: row.status,
    priority: row.priority,
    summary: row.summary,
    rationale: row.rationale,
    generatedAt: row.generated_at,
    updatedAt: row.updated_at,
    actions: orderedActions.map((action: PlanAction) => ({
      actionId: action.id,
      sequence: action.sequence,
    })),
    alternatives: alternatives.map(({ id, summary, rationale }) => ({
      id,
      summary,
      rationale,
    })),
    dependencies: {
      resourceIds: resourceDependencies.map((dependency) => dependency.resource_id),
      facilityIds: facilityDependencies.map((dependency) => dependency.facility_id),
      routeIds: routeDependencies.map((dependency) => dependency.route_id),
    },
  });
}

async function persistPlanRelations(
  planId: string,
  plan: Pick<ResponsePlan, "alternatives" | "dependencies">,
): Promise<void> {
  const alternatives: ResponsePlanAlternativeRow[] = plan.alternatives.map(
    (alternative, index) => ({
      plan_id: planId,
      sequence: index + 1,
      id: alternative.id,
      summary: alternative.summary,
      rationale: alternative.rationale,
    }),
  );
  const resourceDependencies: ResponsePlanResourceDependencyRow[] =
    plan.dependencies.resourceIds.map((resourceId, index) => ({
      plan_id: planId,
      sequence: index + 1,
      resource_id: resourceId,
    }));
  const facilityDependencies: ResponsePlanFacilityDependencyRow[] =
    plan.dependencies.facilityIds.map((facilityId, index) => ({
      plan_id: planId,
      sequence: index + 1,
      facility_id: facilityId,
    }));
  const routeDependencies: ResponsePlanRouteDependencyRow[] =
    plan.dependencies.routeIds.map((routeId, index) => ({
      plan_id: planId,
      sequence: index + 1,
      route_id: routeId,
    }));

  if (alternatives.length > 0) {
    const { error } = await supabase
      .from("response_plan_alternatives")
      .insert(alternatives);
    if (error) throw error;
  }
  if (resourceDependencies.length > 0) {
    const { error } = await supabase
      .from("response_plan_resource_dependencies")
      .insert(resourceDependencies);
    if (error) throw error;
  }
  if (facilityDependencies.length > 0) {
    const { error } = await supabase
      .from("response_plan_facility_dependencies")
      .insert(facilityDependencies);
    if (error) throw error;
  }
  if (routeDependencies.length > 0) {
    const { error } = await supabase
      .from("response_plan_route_dependencies")
      .insert(routeDependencies);
    if (error) throw error;
  }
}

async function replacePlanRelations(
  planId: string,
  updates: Pick<ResponsePlanUpdates, "alternatives" | "dependencies">,
): Promise<void> {
  if (updates.alternatives !== undefined) {
    const { error } = await supabase
      .from("response_plan_alternatives")
      .delete()
      .eq("plan_id", planId);
    if (error) throw error;
  }
  if (updates.dependencies !== undefined) {
    const deleteResults = await Promise.all([
      supabase
        .from("response_plan_resource_dependencies")
        .delete()
        .eq("plan_id", planId),
      supabase
        .from("response_plan_facility_dependencies")
        .delete()
        .eq("plan_id", planId),
      supabase
        .from("response_plan_route_dependencies")
        .delete()
        .eq("plan_id", planId),
    ]);
    for (const result of deleteResults) {
      if (result.error) throw result.error;
    }
  }

  const currentRelations: Pick<ResponsePlan, "alternatives" | "dependencies"> = {
    alternatives: updates.alternatives ?? [],
    dependencies:
      updates.dependencies ?? {
        resourceIds: [],
        facilityIds: [],
        routeIds: [],
      },
  };
  await persistPlanRelations(planId, currentRelations);
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

export async function getCompleteResponsePlanById(
  id: string,
): Promise<ResponsePlan | null> {
  const { data, error } = await supabase
    .from("response_plans")
    .select("*")
    .eq("id", id)
    .limit(1)
    .overrideTypes<ResponsePlanDatabaseRow[], { merge: false }>();

  if (error) throw error;
  const row = data[0];
  return row === undefined ? null : toCompleteResponsePlan(row);
}

export async function listCompleteResponsePlansForIncident(
  incidentId: string,
): Promise<ResponsePlan[]> {
  const { data, error } = await supabase
    .from("response_plans")
    .select("*")
    .eq("incident_id", incidentId)
    .order("updated_at", { ascending: false })
    .order("id", { ascending: true })
    .overrideTypes<ResponsePlanDatabaseRow[], { merge: false }>();

  if (error) throw error;
  return Promise.all(data.map(toCompleteResponsePlan));
}

export async function listCompleteActiveResponsePlansForIncident(
  incidentId: string,
): Promise<ResponsePlan[]> {
  const { data, error } = await supabase
    .from("response_plans")
    .select("*")
    .eq("incident_id", incidentId)
    .in("status", activePlanStatuses)
    .order("updated_at", { ascending: false })
    .order("id", { ascending: true })
    .overrideTypes<ResponsePlanDatabaseRow[], { merge: false }>();

  if (error) throw error;
  return Promise.all(data.map(toCompleteResponsePlan));
}

export async function getCompleteActiveResponsePlanForIncident(
  incidentId: string,
): Promise<ResponsePlan | null> {
  const plans = await listCompleteActiveResponsePlansForIncident(incidentId);
  return plans[0] ?? null;
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
  await persistPlanRelations(row.id, plan);
  return toResponsePlanRecord(row);
}

export async function updateResponsePlan(
  id: string,
  updates: ResponsePlanUpdates,
): Promise<ResponsePlanRecord | null> {
  const databaseUpdates = toDatabaseUpdates(updates);
  const updatesRelations =
    updates.alternatives !== undefined || updates.dependencies !== undefined;
  if (Object.keys(databaseUpdates).length === 0 && !updatesRelations) {
    throw new Error("At least one response plan field must be supplied for update.");
  }

  let row: ResponsePlanDatabaseRow | undefined;
  if (Object.keys(databaseUpdates).length > 0) {
    const { data, error } = await supabase
      .from("response_plans")
      .update(databaseUpdates)
      .eq("id", id)
      .select("*")
      .limit(1)
      .overrideTypes<ResponsePlanDatabaseRow[], { merge: false }>();

    if (error) throw error;
    row = data[0];
  } else {
    const { data, error } = await supabase
      .from("response_plans")
      .select("*")
      .eq("id", id)
      .limit(1)
      .overrideTypes<ResponsePlanDatabaseRow[], { merge: false }>();

    if (error) throw error;
    row = data[0];
  }

  if (row === undefined) return null;
  await replacePlanRelations(id, {
    alternatives: updates.alternatives,
    dependencies: updates.dependencies,
  });
  return toResponsePlanRecord(row);
}
