import type { AgentRun, AgentType } from "../../../domain/agent-run/schema";
import type { EmergencyState } from "../../../domain/emergency-state/schema";
import type { PlanAction } from "../../../domain/plan-action/schema";
import type { ResourceType } from "../../../domain/resource/schema";
import type { ResponsePlan } from "../../../domain/response-plan/schema";
import type { RouteStatus } from "../../../domain/route/schema";
import type { StateChange } from "../../../domain/state-change/schema";
import type { DemoStateSnapshot } from "../../../lib/demo/fixtures";
import type { DemoSnapshot } from "../../../lib/demo/schema";
import type { PlanValidationResult } from "../../../lib/emergency-engine/plan-validator";
import type { HumanDecision } from "../../../domain/human-decision/schema";
import type { ResourceRoutingAssessment } from "../../../lib/agents/resource-routing/schema";
import type { RiskAssessment } from "../../../lib/agents/risk-assessment/schema";
import type { ResponsePlanningResult } from "../../../lib/agents/response-planning/types";

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
  status: AgentRun["status"] | "STANDBY";
  statusLabel: string;
  timeLabel: string;
  tone: StatusTone;
  purpose: string;
  resultSummary: string;
  affectedPlan: boolean;
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
  riskAssessment: RiskAssessment | null;
  resourceRoutingAssessment: ResourceRoutingAssessment | null;
  responsePlanningResult: ResponsePlanningResult | null;
  validation: PlanValidationResult | null;
  humanDecision: HumanDecision | null;
  previousPlan: ResponsePlan | null;
  approvalAvailable: boolean;
};

export function responsePlanSourceLabel(source: ResponsePlan["source"]): string {
  if (source === "GEMINI") return "AI RECOMMENDATION";
  if (source === "DETERMINISTIC_FALLBACK") return "BUILT-IN EMERGENCY RULES";
  return "SOURCE UNAVAILABLE";
}

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

function resourceAssignment(
  state: EmergencyState,
  resource: EmergencyState["resources"][number],
  plan: ResponsePlan | null,
): { assignment: string; statusLabel: string; tone: StatusTone } {
  if (resource.currentAssignmentId === null) {
    return {
      assignment: "Unassigned",
      statusLabel: titleCase(resource.status),
      tone: resourceTone(resource.status),
    };
  }

  const action = state.planActions.find(
    (candidate) => candidate.id === resource.currentAssignmentId,
  );
  if (action === undefined) {
    return {
      assignment: "Assignment recorded",
      statusLabel: titleCase(resource.status),
      tone: resourceTone(resource.status),
    };
  }

  const actionIsCurrent = plan?.actions.some(
    (reference) => reference.actionId === action.id,
  ) ?? false;
  const assignmentIsSuperseded =
    plan !== null && action.planId !== plan.id && !actionIsCurrent;

  if (assignmentIsSuperseded) {
    return {
      assignment: `Previous plan: ${action.planId}`,
      statusLabel: "Superseded",
      tone: "gray",
    };
  }

  return {
    assignment: actionIsCurrent
      ? `Current plan: ${plan?.id ?? action.planId}`
      : `${action.planId} assignment`,
    statusLabel: titleCase(resource.status),
    tone: resourceTone(resource.status),
  };
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
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

const agentPurposes: Record<AgentType, string> = {
  RISK_ASSESSMENT: "Evaluates severity, hazards, and population impact.",
  RESOURCE_ROUTING: "Checks resources, facilities, and route feasibility.",
  RESPONSE_PLANNING: "Builds an executable response recommendation.",
};

function runsForSnapshot(snapshot: DemoStateSnapshot | DemoSnapshot): readonly AgentRun[] {
  if (!("stage" in snapshot)) return snapshot.agentRuns;
  if (snapshot.stage === "EMERGENCY_INITIALIZED" || snapshot.stage === "ANALYZING" || snapshot.stage === "REASSESSING") {
    return snapshot.agentRuns.map((run) => ({ ...run, status: "RUNNING", completedAt: null, durationMs: null, output: null }));
  }
  return snapshot.agentRuns;
}

function actionForPlan(state: EmergencyState, plan: ResponsePlan | null): DashboardAction[] {
  if (plan === null) return [];
  return plan.actions
    .map((reference) => state.planActions.find((action) => action.id === reference.actionId))
    .filter((action): action is PlanAction => action !== undefined)
    .sort((left, right) => left.sequence - right.sequence)
    .map((action) => ({ ...action, sequenceLabel: String(action.sequence).padStart(2, "0") }));
}

function toTimeline(
  changes: readonly StateChange[],
  resources: EmergencyState["resources"],
): DashboardTimelineItem[] {
  const resourceNames = new Map(resources.map((resource) => [resource.id, resource.name]));
  return [...new Map(changes.map((change) => [change.id, change])).values()]
    .map((change, insertionOrder) => ({ change, insertionOrder }))
    .sort((left, right) =>
      Date.parse(left.change.occurredAt) - Date.parse(right.change.occurredAt) ||
      left.insertionOrder - right.insertionOrder,
    )
    .map((change) => ({
      id: change.change.id,
      timeLabel: timeLabel(change.change.occurredAt),
      title: resources.reduce(
        (description, resource) => description.replaceAll(resource.id, resource.name),
        change.change.description ===
        "Change detected: PLAN_AFFECTED_REASSESSMENT_REQUIRED"
          ? "Change detected: active plan affected — reassessment started"
          : change.change.description,
      ),
      detail: `${change.change.entityType} ${resourceNames.get(change.change.entityId) ?? change.change.entityId}`,
      tone: change.change.changeType === "STATUS_CHANGED" ? "red" : change.change.entityType === "PLAN" ? "green" : "gray",
    }));
}

export function createDashboardViewModel(
  snapshot: DemoStateSnapshot | DemoSnapshot,
): DashboardViewModel {
  const { state, stateChanges } = snapshot;
  const idle = "stage" in snapshot && snapshot.stage === "IDLE";
  const agentRuns = runsForSnapshot(snapshot);
  const plan = "currentPlan" in snapshot
    ? snapshot.currentPlan
    : state.activePlan;
  const previousPlan = "previousPlan" in snapshot
    ? snapshot.previousPlan
    : null;
  const approvalAvailable = "stage" in snapshot
    ? (snapshot.stage === "AWAITING_APPROVAL" || snapshot.stage === "AWAITING_REVISED_APPROVAL") && plan?.status === "PENDING_APPROVAL"
    : plan?.status === "PENDING_APPROVAL";
  const changedRoute = state.routes.find((route) => route.status !== "OPEN");
  return {
    incident: state.incident,
    stateVersion: state.stateVersion,
    updatedAt: state.updatedAt,
    resources: state.resources.map((resource) => {
      const assignment = resourceAssignment(state, resource, plan);
      const isSuperseded =
        previousPlan !== null && assignment.statusLabel === "Superseded";
      return {
        id: resource.id,
        name: resource.name,
        type: resource.type,
        typeLabel: typeLabel(resource.type),
        status: resource.status,
        statusLabel: isSuperseded
          ? assignment.statusLabel
          : titleCase(resource.status),
        assignment: assignment.assignment,
        location: `${resource.location.latitude.toFixed(3)}, ${resource.location.longitude.toFixed(3)}`,
        tone: isSuperseded ? "gray" : assignment.tone,
      };
    }),
    facilities: state.facilities.map((facility) => ({
      id: facility.id,
      name: facility.name,
      availableCapacity: facility.availableCapacity,
      totalCapacity: facility.totalCapacity,
      status: facility.status,
      statusLabel: titleCase(facility.status),
      tone: facility.status === "OPERATIONAL" ? "green" : facility.status === "LIMITED" ? "amber" : facility.status === "FULL" ? "blue" : "red",
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
    agents: agentRuns.map((run) => {
      const hasWorkflowResult = "stage" in snapshot && (
        run.agentType === "RISK_ASSESSMENT"
          ? snapshot.riskAssessment !== null
          : run.agentType === "RESOURCE_ROUTING"
            ? snapshot.resourceRoutingAssessment !== null
            : snapshot.responsePlanningResult !== null
      );
      const status = idle
        ? "STANDBY"
        : hasWorkflowResult
          ? "COMPLETED"
          : "stage" in snapshot && snapshot.stage === "FAILED" && run.status !== "COMPLETED"
            ? run.status
            : "PENDING";
      const resultSummary = idle
        ? "Awaiting demo start"
        : "stage" in snapshot && run.agentType === "RISK_ASSESSMENT" && snapshot.riskAssessment
          ? `${snapshot.riskAssessment.severity} severity · priority ${snapshot.riskAssessment.priority}`
          : "stage" in snapshot && run.agentType === "RESOURCE_ROUTING" && snapshot.resourceRoutingAssessment
            ? `${snapshot.resourceRoutingAssessment.resources.length} resources, ${snapshot.resourceRoutingAssessment.facilities.length} facilities, and ${snapshot.resourceRoutingAssessment.routes.length} routes evaluated.`
            : "stage" in snapshot && run.agentType === "RESPONSE_PLANNING" && snapshot.responsePlanningResult
              ? `${snapshot.responsePlanningResult.plan.id} generated · validation ${snapshot.responsePlanningResult.validation.valid ? "passed" : "failed"}`
              : idle ? "Awaiting demo start" : run.errorMessage ?? "Workflow result unavailable";
      return {
        id: run.id,
        label: agentLabels[run.agentType],
        status,
        statusLabel: idle ? "STANDBY" : titleCase(status),
        timeLabel: idle ? "Not started" : hasWorkflowResult ? "Result available" : "Not available",
        tone: idle ? "gray" : status === "COMPLETED" ? "green" : status === "RUNNING" ? "amber" : status === "PENDING" ? "gray" : "red",
        purpose: agentPurposes[run.agentType],
        resultSummary,
        affectedPlan: !idle && hasWorkflowResult,
      };
    }),
    timeline: toTimeline(stateChanges, state.resources),
    reassessment: {
      required: changedRoute !== undefined,
      routeId: changedRoute?.id ?? null,
      revisedPlanId: changedRoute === undefined ? null : plan?.id ?? null,
    },
    riskAssessment: "riskAssessment" in snapshot ? snapshot.riskAssessment : null,
    resourceRoutingAssessment: "resourceRoutingAssessment" in snapshot ? snapshot.resourceRoutingAssessment : null,
    responsePlanningResult: "responsePlanningResult" in snapshot ? snapshot.responsePlanningResult : null,
    validation: "validation" in snapshot ? snapshot.validation : null,
    humanDecision: "humanDecision" in snapshot ? snapshot.humanDecision : null,
    previousPlan: "previousPlan" in snapshot ? snapshot.previousPlan : null,
    approvalAvailable,
  };
}
