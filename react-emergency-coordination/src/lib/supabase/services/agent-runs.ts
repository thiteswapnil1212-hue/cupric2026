import {
  AgentRunSchema,
  type AgentRun,
} from "../../../domain/agent-run/schema";
import { supabase } from "../client";

type AgentRunDatabaseRow = {
  id: string;
  incident_id: string;
  agent_type: AgentRun["agentType"];
  status: AgentRun["status"];
  state_version: number;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  output: unknown | null;
  error_message: string | null;
  created_at: string;
};

type AgentRunDatabaseInsert = Omit<AgentRunDatabaseRow, "created_at">;
type AgentRunDatabaseUpdate = Partial<
  Omit<AgentRunDatabaseInsert, "id">
>;
type AgentRunUpdates = Partial<Omit<AgentRun, "id">>;

function toAgentRun(row: AgentRunDatabaseRow): AgentRun {
  return AgentRunSchema.parse({
    id: row.id,
    incidentId: row.incident_id,
    agentType: row.agent_type,
    status: row.status,
    stateVersion: row.state_version,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
    output: row.output,
    errorMessage: row.error_message,
  });
}

function toDatabaseInsert(run: AgentRun): AgentRunDatabaseInsert {
  return {
    id: run.id,
    incident_id: run.incidentId,
    agent_type: run.agentType,
    status: run.status,
    state_version: run.stateVersion,
    started_at: run.startedAt,
    completed_at: run.completedAt,
    duration_ms: run.durationMs,
    output: run.output,
    error_message: run.errorMessage,
  };
}

function toDatabaseUpdates(updates: AgentRunUpdates): AgentRunDatabaseUpdate {
  const row: AgentRunDatabaseUpdate = {};

  if (updates.incidentId !== undefined) row.incident_id = updates.incidentId;
  if (updates.agentType !== undefined) row.agent_type = updates.agentType;
  if (updates.status !== undefined) row.status = updates.status;
  if (updates.stateVersion !== undefined) row.state_version = updates.stateVersion;
  if (updates.startedAt !== undefined) row.started_at = updates.startedAt;
  if (updates.completedAt !== undefined) row.completed_at = updates.completedAt;
  if (updates.durationMs !== undefined) row.duration_ms = updates.durationMs;
  if (updates.output !== undefined) row.output = updates.output;
  if (updates.errorMessage !== undefined) row.error_message = updates.errorMessage;

  return row;
}

export async function getAgentRunById(id: string): Promise<AgentRun | null> {
  const { data, error } = await supabase
    .from("agent_runs")
    .select("*")
    .eq("id", id)
    .limit(1)
    .overrideTypes<AgentRunDatabaseRow[], { merge: false }>();

  if (error) throw error;
  return data[0] === undefined ? null : toAgentRun(data[0]);
}

export async function listAgentRunsForIncident(
  incidentId: string,
): Promise<AgentRun[]> {
  const { data, error } = await supabase
    .from("agent_runs")
    .select("*")
    .eq("incident_id", incidentId)
    .order("started_at", { ascending: true })
    .overrideTypes<AgentRunDatabaseRow[], { merge: false }>();

  if (error) throw error;
  return data.map(toAgentRun);
}

export async function listAgentRunsForStateVersion(
  incidentId: string,
  stateVersion: number,
): Promise<AgentRun[]> {
  const { data, error } = await supabase
    .from("agent_runs")
    .select("*")
    .eq("incident_id", incidentId)
    .eq("state_version", stateVersion)
    .order("started_at", { ascending: true })
    .overrideTypes<AgentRunDatabaseRow[], { merge: false }>();

  if (error) throw error;
  return data.map(toAgentRun);
}

export async function createAgentRun(run: AgentRun): Promise<AgentRun> {
  const { data, error } = await supabase
    .from("agent_runs")
    .insert(toDatabaseInsert(run))
    .select("*")
    .limit(1)
    .overrideTypes<AgentRunDatabaseRow[], { merge: false }>();

  if (error) throw error;
  const row = data[0];
  if (row === undefined) {
    throw new Error("Supabase returned no agent run after insert.");
  }
  return toAgentRun(row);
}

export async function updateAgentRun(
  id: string,
  updates: AgentRunUpdates,
): Promise<AgentRun | null> {
  const databaseUpdates = toDatabaseUpdates(updates);
  if (Object.keys(databaseUpdates).length === 0) {
    throw new Error("At least one agent run field must be supplied for update.");
  }

  const { data, error } = await supabase
    .from("agent_runs")
    .update(databaseUpdates)
    .eq("id", id)
    .select("*")
    .limit(1)
    .overrideTypes<AgentRunDatabaseRow[], { merge: false }>();

  if (error) throw error;
  return data[0] === undefined ? null : toAgentRun(data[0]);
}
