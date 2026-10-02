import type { AgentRun, AgentType } from "../../../domain/agent-run/schema";
import type { EmergencyState } from "../../../domain/emergency-state/schema";
import type { PlanAction } from "../../../domain/plan-action/schema";
import type { ResourceType } from "../../../domain/resource/schema";
import type { ResponsePlan } from "../../../domain/response-plan/schema";
import type { RouteStatus } from "../../../domain/route/schema";
import type { StateChange } from "../../../domain/state-change/schema";

export type StatusTone = "green" | "blue" | "amber" | "red" | "gray";

export type DashboardResource = {
  id: string;
  name: string;
  type: ResourceType;
  typeLabel: string;
  status: string;
  statusLabel: string;
  assignment: string;
  location: string;
  tone: StatusTone;
};

export type DashboardFacility = {
  id: string;
  name: string;
  availableCapacity: number;
  totalCapacity: number;
  status: string;
  statusLabel: string;
  tone: StatusTone;
};

export type DashboardRoute = {
  id: string;
  name: string;
  status: RouteStatus;
  statusLabel: string;
  tone: StatusTone;
};

export type DashboardAction = PlanAction & {
  sequenceLabel: string;
};

export type DashboardAgent = {
  id: string;
  label: string;
  status: AgentRun["status"];
  statusLabel: string;
  timeLabel: string;
  tone: StatusTone;
};

export type DashboardTimelineItem = {
  id: string;
  timeLabel: string;
  title: string;
  detail: string;
  tone: StatusTone;
};

export type DashboardViewModel = {
  incident: EmergencyState["incident"];
  stateVersion: number;
  updatedAt: string;
  resources: DashboardResource[];
  facilities: DashboardFacility[];
  routes: DashboardRoute[];
  activePlan: ResponsePlan | null;
  actions: DashboardAction[];
  agents: DashboardAgent[];
  timeline: DashboardTimelineItem[];
  reassessment: {
    required: boolean;
    routeId: string | null;
    revisedPlanId: string | null;
  };
};

const agentLabels: Record<AgentType, string> = {
  RISK_ASSESSMENT: "Risk Assessment",
  RESOURCE_ROUTING: "Resource & Routing",
  RESPONSE_PLANNING: "Response Planning",
};

function titleCase(value: string): string {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function resourceTone(status: DashboardResource["status"]): StatusTone {
  if (status === "AVAILABLE") return "green";
  if (status === "DISPATCHED" || status === "ASSIGNED") return "blue";
  if (status === "BUSY") return "amber";
  return "red";
}

function routeTone(status: RouteStatus): StatusTone {
  if (status === "OPEN") return "green";
  if (status === "PARTIALLY_BLOCKED") return "amber";
  return "red";
}

function typeLabel(type: ResourceType): string {
  return titleCase(type);
}

function timeLabel(value: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function actionForPlan(state: EmergencyState, plan: ResponsePlan | null): DashboardAction[] {
  if (plan === null) return [];
  return plan.actions
    .map((reference) => state.planActions.find((action) => action.id === reference.actionId))
    .filter((action): action is PlanAction => action !== undefined)
    .sort((left, right) => left.sequence - right.sequence)
    .map((action) => ({ ...action, sequenceLabel: String(action.sequence).padStart(2, "0") }));
}

function toTimeline(changes: readonly StateChange[]): DashboardTimelineItem[] {
  return [...changes]
    .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt))
    .map((change) => ({
      id: change.id,
      timeLabel: timeLabel(change.occurredAt),
      title: change.description,
      detail: `${change.entityType} ${change.entityId}`,
      tone: change.changeType === "STATUS_CHANGED" ? "red" : change.entityType === "PLAN" ? "green" : "gray",
    }));
}

export function createDashboardViewModel(
  snapshot: { state: EmergencyState; agentRuns: readonly AgentRun[]; stateChanges: readonly StateChange[] },
): DashboardViewModel {
  const { state, agentRuns, stateChanges } = snapshot;
  const plan = state.activePlan;
  const changedRoute = state.routes.find((route) => route.status !== "OPEN");
  return {
    incident: state.incident,
    stateVersion: state.stateVersion,
    updatedAt: state.updatedAt,
    resources: state.resources.map((resource) => ({
      id: resource.id,
      name: resource.name,
      type: resource.type,
      typeLabel: typeLabel(resource.type),
      status: resource.status,
      statusLabel: titleCase(resource.status),
      assignment: resource.currentAssignmentId ?? "Unassigned",
      location: resource.location.latitude.toFixed(3) + ", " + resource.location.longitude.toFixed(3),
      tone: resourceTone(resource.status),
    })),
    facilities: state.facilities.map((facility) => ({
      id: facility.id,
      name: facility.name,
      availableCapacity: facility.availableCapacity,
      totalCapacity: facility.totalCapacity,
      status: facility.status,
      statusLabel: titleCase(facility.status),
      tone: facility.status === "OPERATIONAL" ? "green" : facility.status === "LIMITED" ? "amber" : "red",
    })),
    routes: state.routes.map((route) => ({
      id: route.id,
      name: route.name,
      status: route.status,
      statusLabel: titleCase(route.status),
      tone: routeTone(route.status),
    })),
    activePlan: plan,
    actions: actionForPlan(state, plan),
    agents: agentRuns.map((run) => ({
      id: run.id,
      label: agentLabels[run.agentType],
      status: run.status,
      statusLabel: titleCase(run.status),
      timeLabel: timeLabel(run.completedAt ?? run.startedAt),
      tone: run.status === "COMPLETED" ? "green" : run.status === "RUNNING" ? "amber" : "red",
    })),
    timeline: toTimeline(stateChanges),
    reassessment: {
      required: changedRoute !== undefined,
      routeId: changedRoute?.id ?? null,
      revisedPlanId: changedRoute === undefined ? null : plan?.id ?? null,
    },
  };
}
