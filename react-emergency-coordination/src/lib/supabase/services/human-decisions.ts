import {
  HumanDecisionSchema,
  type HumanDecision,
} from "../../../domain/human-decision/schema";
import { supabase } from "../client";

type HumanDecisionDatabaseRow = {
  id: string;
  plan_id: string;
  incident_id: string;
  decision: HumanDecision["decision"];
  status: HumanDecision["status"];
  coordinator_id: string;
  reason: string;
  modified_plan_id: string | null;
  decided_at: string;
  recorded_at: string;
  created_at: string;
};

type HumanDecisionDatabaseInsert = Omit<
  HumanDecisionDatabaseRow,
  "created_at"
>;

function toHumanDecision(row: HumanDecisionDatabaseRow): HumanDecision {
  return HumanDecisionSchema.parse({
    id: row.id,
    planId: row.plan_id,
    incidentId: row.incident_id,
    decision: row.decision,
    status: row.status,
    coordinatorId: row.coordinator_id,
    reason: row.reason,
    modifiedPlanId: row.modified_plan_id,
    decidedAt: row.decided_at,
    recordedAt: row.recorded_at,
  });
}

function toDatabaseInsert(
  decision: HumanDecision,
): HumanDecisionDatabaseInsert {
  return {
    id: decision.id,
    plan_id: decision.planId,
    incident_id: decision.incidentId,
    decision: decision.decision,
    status: decision.status,
    coordinator_id: decision.coordinatorId,
    reason: decision.reason,
    modified_plan_id: decision.modifiedPlanId,
    decided_at: decision.decidedAt,
    recorded_at: decision.recordedAt,
  };
}

export async function getHumanDecisionById(
  id: string,
): Promise<HumanDecision | null> {
  const { data, error } = await supabase
    .from("human_decisions")
    .select("*")
    .eq("id", id)
    .limit(1)
    .overrideTypes<HumanDecisionDatabaseRow[], { merge: false }>();

  if (error) throw error;
  return data[0] === undefined ? null : toHumanDecision(data[0]);
}

export async function listHumanDecisionsForPlan(
  planId: string,
): Promise<HumanDecision[]> {
  const { data, error } = await supabase
    .from("human_decisions")
    .select("*")
    .eq("plan_id", planId)
    .order("recorded_at", { ascending: true })
    .overrideTypes<HumanDecisionDatabaseRow[], { merge: false }>();

  if (error) throw error;
  return data.map(toHumanDecision);
}

export async function createHumanDecision(
  decision: HumanDecision,
): Promise<HumanDecision> {
  const { data, error } = await supabase
    .from("human_decisions")
    .insert(toDatabaseInsert(decision))
    .select("*")
    .limit(1)
    .overrideTypes<HumanDecisionDatabaseRow[], { merge: false }>();

  if (error) throw error;
  const row = data[0];
  if (row === undefined) {
    throw new Error("Supabase returned no human decision after insert.");
  }
  return toHumanDecision(row);
}
