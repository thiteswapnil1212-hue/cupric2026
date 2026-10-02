import type { EmergencyState } from "../../domain/emergency-state/schema";
import type { PlanAction } from "../../domain/plan-action/schema";
import type { ResponsePlan } from "../../domain/response-plan/schema";
import type { StateChange } from "../../domain/state-change/schema";
import { validatePlan } from "../emergency-engine/plan-validator";
import { detectEmergencyStateChanges } from "../change-detection/detector";
import {
  approvePlan,
  rejectPlan,
  submitPlanForApproval,
  type DecisionMetadata,
} from "../human-approval/plan-approval";
import { executeApprovedPlan } from "../simulation/engine";
import type { ResourceRoutingAssessment } from "../agents/resource-routing/schema";
import type { RiskAssessment } from "../agents/risk-assessment/schema";
import type { ResponsePlanningResult } from "../agents/response-planning/types";
import { getDemoState } from "./fixtures";
import type { DemoError, DemoOperationResult, DemoSnapshot, DemoStage } from "./schema";

const demoTimes = {
  initialPlan: "2026-10-02T08:41:00.000Z",
  executed: "2026-10-02T08:44:00.000Z",
  blockage: "2026-10-02T08:47:00.000Z",
  revisedPlan: "2026-10-02T08:46:12.000Z",
  revisedExecuted: "2026-10-02T08:49:00.000Z",
} as const;

function operationError(stage: DemoStage, code: string, message: string): DemoError {
  return { stage, code, message, recovery: stage === "FAILED" ? "RESET" : "RETRY" };
}

function decisionMetadata(plan: ResponsePlan, reason: string): DecisionMetadata {
  return {
    id: `DEMO-DECISION-${plan.id}`,
    incidentId: plan.incidentId,
    coordinatorId: "DEMO-COORDINATOR",
    reason,
    decidedAt: plan.id === "PLAN-001" ? demoTimes.executed : demoTimes.revisedExecuted,
    recordedAt: plan.id === "PLAN-001" ? demoTimes.executed : demoTimes.revisedExecuted,
  };
}

function changeRecord(
  id: string,
  entityType: StateChange["entityType"],
  entityId: string,
  changeType: StateChange["changeType"],
  description: string,
  previousValue: StateChange["previousValue"],
  newValue: StateChange["newValue"],
  occurredAt: string,
): StateChange {
  return { id, entityType, entityId, changeType, description, previousValue, newValue, occurredAt, detectedAt: occurredAt };
}

function createPlanResult(
  state: EmergencyState,
  planId: string,
  actions: readonly PlanAction[],
  summary: string,
  rationale: string,
): ResponsePlanningResult {
  const plan: ResponsePlan = {
    id: planId,
    incidentId: state.incident.id,
    stateVersion: state.stateVersion,
    status: "DRAFT",
    priority: "URGENT",
    summary,
    rationale,
    generatedAt: planId === "PLAN-001" ? demoTimes.initialPlan : demoTimes.revisedPlan,
    updatedAt: planId === "PLAN-001" ? demoTimes.initialPlan : demoTimes.revisedPlan,
    actions: actions.map((action) => ({ actionId: action.id, sequence: action.sequence })),
    alternatives: [],
    dependencies: {
      resourceIds: [...new Set(actions.flatMap((action) => action.resourceIds))],
      facilityIds: [...new Set(actions.flatMap((action) => action.facilityIds))],
      routeIds: [...new Set(actions.flatMap((action) => action.routeIds))],
    },
  };
  const actionById = new Map<string, PlanAction>();
  for (const action of [...state.planActions, ...actions]) actionById.set(action.id, action);
  const validation = validatePlan(plan, { ...state, planActions: [...actionById.values()] });
  return {
    plan,
    actions,
    alternatives: [],
    constraints: [],
    reasoning: rationale,
    confidence: 1,
    validation,
  };
}

type DemoAgents = {
  riskAssessment: (state: EmergencyState) => Promise<RiskAssessment>;
  resourceRouting: (state: EmergencyState) => Promise<ResourceRoutingAssessment>;
  responsePlanning: (state: EmergencyState) => Promise<ResponsePlanningResult>;
};

function deterministicAgents(planId: string): DemoAgents {
  return {
    riskAssessment: async (state): Promise<RiskAssessment> => ({
      severity: state.incident.severity,
      urgency: "IMMEDIATE",
      priority: 5,
      affectedPopulation: state.incident.affectedPopulation,
      hazardFactors: [...state.incident.hazards],
      riskFactors: ["Active structural fire", "Emergency access dependency"],
      keyConcerns: ["Route availability", "Hospital capacity"],
      reasoning: "Deterministic demo risk assessment from current EmergencyState.",
      confidence: 1,
    }),
    resourceRouting: async (state): Promise<ResourceRoutingAssessment> => ({
      resources: state.resources.map((resource) => ({
        resourceId: resource.id,
        status: resource.status,
        availability: resource.status === "AVAILABLE" ? "AVAILABLE" : resource.status === "UNAVAILABLE" || resource.status === "OUT_OF_SERVICE" ? "UNAVAILABLE" : "ASSIGNED",
        capacity: resource.capacity,
        capabilityMatch: [...resource.capabilities],
        notes: ["Deterministic demo assessment"],
      })),
      facilities: state.facilities.map((facility) => ({
        facilityId: facility.id,
        status: facility.status,
        totalCapacity: facility.totalCapacity,
        availableCapacity: facility.availableCapacity,
        capacityStatus: facility.availableCapacity === 0 ? "FULL" : facility.status === "LIMITED" ? "LIMITED" : "AVAILABLE",
        notes: ["Deterministic demo assessment"],
      })),
      routes: state.routes.map((route) => ({
        routeId: route.id,
        status: route.status,
        distanceKm: route.distanceKm,
        estimatedTravelMinutes: route.estimatedTravelMinutes,
        usability: route.status === "OPEN" ? "USABLE" : route.status === "PARTIALLY_BLOCKED" ? "PARTIALLY_BLOCKED" : route.status,
        notes: ["Deterministic demo assessment"],
      })),
      constraints: ["Use only current EmergencyState facts."],
      reasoning: "Deterministic demo resource and route assessment from current EmergencyState.",
    }),
    responsePlanning: async (state): Promise<ResponsePlanningResult> => {
      const routeId = state.routes.find((route) => route.status === "OPEN")?.id ?? "R2";
      const resourceIds = planId === "PLAN-001"
        ? ["RES-RT-01", "RES-AMB-01"]
        : ["RES-RT-02", "RES-AMB-02"];
      const actions: PlanAction[] = [
        {
          id: planId === "PLAN-001" ? "ACT-001" : "ACT-101",
          planId,
          sequence: 1,
          type: "DISPATCH_RESOURCE",
          status: "PENDING",
          description: planId === "PLAN-001" ? "Dispatch Rescue Team Alpha" : "Continue rescue operations with Rescue Team Bravo",
          priority: "URGENT",
          resourceIds: [resourceIds[0] ?? "RES-RT-01"],
          facilityIds: [],
          routeIds: [routeId],
          targetLocation: {
            latitude: state.incident.location.latitude,
            longitude: state.incident.location.longitude,
          },
          estimatedDurationMinutes: 8,
          createdAt: state.updatedAt,
          updatedAt: state.updatedAt,
        },
        {
          id: planId === "PLAN-001" ? "ACT-002" : "ACT-102",
          planId,
          sequence: 2,
          type: "DISPATCH_RESOURCE",
          status: "PENDING",
          description: planId === "PLAN-001" ? "Dispatch Ambulance 07" : "Reroute Ambulance 08 via R2",
          priority: "URGENT",
          resourceIds: [resourceIds[1] ?? "RES-AMB-01"],
          facilityIds: [],
          routeIds: [routeId],
          targetLocation: {
            latitude: state.incident.location.latitude,
            longitude: state.incident.location.longitude,
          },
          estimatedDurationMinutes: 9,
          createdAt: state.updatedAt,
          updatedAt: state.updatedAt,
        },
        {
          id: planId === "PLAN-001" ? "ACT-003" : "ACT-103",
          planId,
          sequence: 3,
          type: "NOTIFY_FACILITY",
          status: "PENDING",
          description: planId === "PLAN-001" ? "Allocate casualties to Hospital A" : "Adjust Hospital A allocation",
          priority: "HIGH",
          resourceIds: [],
          facilityIds: ["FAC-HOSP-A"],
          routeIds: [],
          capacityDemand: planId === "PLAN-001" ? 12 : 4,
          targetLocation: null,
          estimatedDurationMinutes: 5,
          createdAt: state.updatedAt,
          updatedAt: state.updatedAt,
        },
        {
          id: planId === "PLAN-001" ? "ACT-004" : "ACT-104",
          planId,
          sequence: 4,
          type: "NOTIFY_FACILITY",
          status: "PENDING",
          description: planId === "PLAN-001" ? "Allocate remaining casualties to Hospital B" : "Maintain Hospital B standby allocation",
          priority: "HIGH",
          resourceIds: [],
          facilityIds: ["FAC-HOSP-B"],
          routeIds: [],
          capacityDemand: planId === "PLAN-001" ? 8 : 2,
          targetLocation: null,
          estimatedDurationMinutes: 5,
          createdAt: state.updatedAt,
          updatedAt: state.updatedAt,
        },
      ];
      return createPlanResult(state, planId, actions, planId === "PLAN-001" ? "Coordinate rescue access and hospital allocation." : "Adapt response through the R2 alternative route.", "Deterministic demo response plan generated from the current EmergencyState.");
    },
  };
}

function initialSnapshot(): DemoSnapshot {
  const fixture = getDemoState("initial");
  return {
    stage: "IDLE",
    state: fixture.state,
    agentRuns: fixture.agentRuns,
    stateChanges: [],
    currentPlan: null,
    previousPlan: null,
    riskAssessment: null,
    resourceRoutingAssessment: null,
    responsePlanningResult: null,
    validation: null,
    humanDecision: null,
    progress: { current: 0, total: 9, label: "Ready to start" },
    error: null,
  };
}

export class DemoController {
  private snapshot: DemoSnapshot = initialSnapshot();

  getSnapshot(): DemoSnapshot {
    return this.snapshot;
  }

  resetDemo(): DemoOperationResult {
    this.snapshot = initialSnapshot();
    return { success: true, snapshot: this.snapshot };
  }

  async startDemo(): Promise<DemoOperationResult> {
    const fixture = getDemoState("initial");
    this.snapshot = { ...this.snapshot, stage: "EMERGENCY_INITIALIZED", state: fixture.state, agentRuns: fixture.agentRuns, stateChanges: [changeRecord("DEMO-001", "INCIDENT", fixture.state.incident.id, "CREATED", "Emergency detected", null, "ACTIVE", fixture.state.incident.reportedAt)], progress: { current: 1, total: 9, label: "Emergency initialized" }, error: null };
    const agents = deterministicAgents("PLAN-001");
    const riskAssessment = await agents.riskAssessment(fixture.state);
    const resourceRoutingAssessment = await agents.resourceRouting(fixture.state);
    const generated = await agents.responsePlanning(fixture.state);
    if (!generated.validation.valid) return this.fail("PLAN_GENERATED", "PLAN_VALIDATION_FAILED", generated.validation.errors.map((issue) => issue.message).join(" "));
    const submitted = submitPlanForApproval(generated.plan);
    if (!submitted.success) return this.fail("PLAN_GENERATED", submitted.error.code, submitted.error.message);
    this.snapshot = { ...this.snapshot, stage: "AWAITING_APPROVAL", currentPlan: submitted.plan, state: { ...fixture.state, activePlan: submitted.plan }, riskAssessment, resourceRoutingAssessment, responsePlanningResult: generated, validation: generated.validation, stateChanges: [...this.snapshot.stateChanges, changeRecord("DEMO-002", "PLAN", submitted.plan.id, "CREATED", "Response Plan-001 generated", null, "PENDING_APPROVAL", demoTimes.initialPlan)], progress: { current: 2, total: 9, label: "Human authorization required" } };
    return { success: true, snapshot: this.snapshot };
  }

  async approveCurrentPlan(): Promise<DemoOperationResult> {
    const plan = this.snapshot.currentPlan;
    if (plan === null || (this.snapshot.stage !== "AWAITING_APPROVAL" && this.snapshot.stage !== "AWAITING_REVISED_APPROVAL")) return this.fail(this.snapshot.stage, "INVALID_TRANSITION", "Approval is only allowed when a plan is awaiting human approval.");
    const approved = approvePlan(plan, { ...decisionMetadata(plan, "Coordinator approved deterministic demo plan."), currentState: this.snapshot.state });
    if (!approved.success) return this.fail(this.snapshot.stage, approved.error.code, approved.error.message);
    const executingStage: DemoStage = plan.id === "PLAN-001" ? "EXECUTING" : "EXECUTING_REVISED_PLAN";
    this.snapshot = { ...this.snapshot, stage: executingStage, state: { ...this.snapshot.state, activePlan: approved.plan }, currentPlan: approved.plan, humanDecision: approved.decision ?? null, progress: { current: plan.id === "PLAN-001" ? 3 : 8, total: 9, label: "Simulated execution in progress" } };
    const executed = executeApprovedPlan(this.snapshot.state, approved.plan);
    if (!executed.success) return this.fail(executingStage, executed.error.code, executed.error.message);
    const executionChanges = executed.stateChanges;
    this.snapshot = { ...this.snapshot, stage: "COMPLETED", state: executed.state, currentPlan: executed.plan, stateChanges: [...this.snapshot.stateChanges, ...executionChanges, changeRecord(`DEMO-${plan.id}-APPROVED`, "PLAN", plan.id, "STATUS_CHANGED", `${plan.id} approved and executed`, "APPROVED", "COMPLETED", plan.id === "PLAN-001" ? demoTimes.executed : demoTimes.revisedExecuted)], progress: { current: plan.id === "PLAN-001" ? 4 : 9, total: 9, label: plan.id === "PLAN-001" ? "Plan-001 complete · situation monitoring" : "Demo completed" }, error: null };
    return { success: true, snapshot: this.snapshot };
  }

  rejectCurrentPlan(reason: string): DemoOperationResult {
    const plan = this.snapshot.currentPlan;
    if (plan === null || (this.snapshot.stage !== "AWAITING_APPROVAL" && this.snapshot.stage !== "AWAITING_REVISED_APPROVAL")) return this.fail(this.snapshot.stage, "INVALID_TRANSITION", "Rejection is only allowed when a plan is awaiting human approval.");
    const rejected = rejectPlan(plan, { ...decisionMetadata(plan, reason), reason, currentState: this.snapshot.state });
    if (!rejected.success) return this.fail(this.snapshot.stage, rejected.error.code, rejected.error.message);
    this.snapshot = { ...this.snapshot, stage: "FAILED", currentPlan: rejected.plan, state: { ...this.snapshot.state, activePlan: rejected.plan }, humanDecision: rejected.decision ?? null, progress: { ...this.snapshot.progress, label: "Plan rejected · reset required" }, error: null };
    return { success: true, snapshot: this.snapshot };
  }

  modifyCurrentPlan(): DemoOperationResult {
    const error = operationError(this.snapshot.stage, "MODIFICATION_REQUIRES_PLAN_INPUT", "Demo modification requires a concrete modified ResponsePlan.");
    this.snapshot = { ...this.snapshot, error };
    return { success: false, snapshot: this.snapshot, error };
  }

  async simulateRouteBlockage(): Promise<DemoOperationResult> {
    if (this.snapshot.stage !== "COMPLETED" || this.snapshot.currentPlan?.id !== "PLAN-001") return this.fail(this.snapshot.stage, "INVALID_TRANSITION", "R1 blockage can only be simulated after Plan-001 execution.");
    const previousState = this.snapshot.state;
    const currentState: EmergencyState = {
      ...previousState,
      routes: previousState.routes.map((route) => route.id === "R1" ? { ...route, status: "BLOCKED", blockedReason: "Flooding reported on primary access route.", updatedAt: demoTimes.blockage } : route),
      stateVersion: previousState.stateVersion + 1,
      updatedAt: demoTimes.blockage,
    };
    this.snapshot = { ...this.snapshot, stage: "SITUATION_CHANGED", state: currentState, previousPlan: this.snapshot.currentPlan, stateChanges: [...this.snapshot.stateChanges, changeRecord("DEMO-ROUTE-001", "ROUTE", "R1", "STATUS_CHANGED", "Route R1 blocked", "OPEN", "BLOCKED", demoTimes.blockage)], progress: { current: 5, total: 9, label: "Situation changed · detecting impact" } };
    const detection = detectEmergencyStateChanges({ previousState, currentState, activePlan: this.snapshot.currentPlan });
    if (detection.success === false) return this.fail("CHANGE_DETECTED", "CHANGE_DETECTION_FAILED", detection.error.message);
    if (detection.classification !== "PLAN_AFFECTED_REASSESSMENT_REQUIRED") return this.fail("CHANGE_DETECTED", "UNEXPECTED_CHANGE_CLASSIFICATION", detection.reason);
    this.snapshot = { ...this.snapshot, stage: "REASSESSING", progress: { current: 6, total: 9, label: "Plan dependency affected · reassessing" } };
    const agents = deterministicAgents("PLAN-002");
    const riskAssessment = await agents.riskAssessment(currentState);
    const resourceRoutingAssessment = await agents.resourceRouting(currentState);
    const revised = await agents.responsePlanning(currentState);
    if (!revised.validation.valid) return this.fail("REASSESSING", "PLAN_VALIDATION_FAILED", revised.validation.errors.map((issue) => issue.message).join(" "));
    const revisedPlan = submitPlanForApproval(revised.plan);
    if (!revisedPlan.success) return this.fail("REASSESSING", revisedPlan.error.code, revisedPlan.error.message);
    this.snapshot = { ...this.snapshot, stage: "AWAITING_REVISED_APPROVAL", state: { ...currentState, planActions: [...currentState.planActions, ...revised.actions], activePlan: revisedPlan.plan }, currentPlan: revisedPlan.plan, previousPlan: this.snapshot.currentPlan, riskAssessment, resourceRoutingAssessment, responsePlanningResult: revised, validation: revised.validation, humanDecision: null, stateChanges: [...this.snapshot.stateChanges, changeRecord("DEMO-PLAN-002", "PLAN", revisedPlan.plan.id, "CREATED", "Response Plan-002 generated", null, "PENDING_APPROVAL", demoTimes.revisedPlan)], progress: { current: 7, total: 9, label: "Revised plan ready · human authorization required" }, error: null };
    return { success: true, snapshot: this.snapshot };
  }

  retryDemo(): Promise<DemoOperationResult> {
    return this.startDemo();
  }

  private revisedActions(state: EmergencyState): PlanAction[] {
    const routeId = state.routes.find((route) => route.status === "OPEN")?.id ?? "R2";
    return [
      { ...state.planActions[0], id: "ACT-101", planId: "PLAN-002", sequence: 1, description: "Continue rescue operations with Rescue Team Bravo", resourceIds: ["RES-RT-02"], routeIds: [routeId], status: "PENDING", createdAt: demoTimes.revisedPlan, updatedAt: demoTimes.revisedPlan },
      { ...state.planActions[1], id: "ACT-102", planId: "PLAN-002", sequence: 2, description: "Reroute Ambulance 08 via R2", resourceIds: ["RES-AMB-02"], routeIds: [routeId], status: "PENDING", createdAt: demoTimes.revisedPlan, updatedAt: demoTimes.revisedPlan },
      { ...state.planActions[2], id: "ACT-103", planId: "PLAN-002", sequence: 3, description: "Adjust Hospital A allocation", resourceIds: [], facilityIds: ["FAC-HOSP-A"], routeIds: [], capacityDemand: 4, status: "PENDING", createdAt: demoTimes.revisedPlan, updatedAt: demoTimes.revisedPlan },
      { ...state.planActions[3], id: "ACT-104", planId: "PLAN-002", sequence: 4, description: "Maintain Hospital B standby allocation", resourceIds: [], facilityIds: ["FAC-HOSP-B"], routeIds: [], capacityDemand: 2, status: "PENDING", createdAt: demoTimes.revisedPlan, updatedAt: demoTimes.revisedPlan },
    ];
  }

  private fail(stage: DemoStage, code: string, message: string): DemoOperationResult {
    const error = operationError("FAILED", code, message);
    this.snapshot = { ...this.snapshot, stage: "FAILED", progress: { ...this.snapshot.progress, label: "Demo failed" }, error };
    return { success: false, snapshot: this.snapshot, error };
  }
}

export function createDemoController(): DemoController {
  return new DemoController();
}
