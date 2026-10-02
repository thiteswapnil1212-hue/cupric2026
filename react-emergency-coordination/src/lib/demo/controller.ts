import type { EmergencyState } from "../../domain/emergency-state/schema";
import type { PlanAction } from "../../domain/plan-action/schema";
import type { ResponsePlan } from "../../domain/response-plan/schema";
import type { StateChange } from "../../domain/state-change/schema";
import type { AgentType } from "../../domain/agent-run/schema";
import { validatePlan } from "../emergency-engine/plan-validator";
import { transitionRouteStatus } from "../emergency-engine/routes";
import { detectEmergencyStateChanges } from "../change-detection/detector";
import {
  approvePlan,
  modifyPlan,
  rejectPlan,
  submitPlanForApproval,
  type DecisionMetadata,
} from "../human-approval/plan-approval";
import { executeApprovedPlan } from "../simulation/engine";
import type { SimulationResult } from "../simulation/schema";
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

function operationError(stage: DemoStage, code: string, message: string, occurredAt: string): DemoError {
  return { stage, code, message, recovery: "RESET", recoverable: false, occurredAt };
}

function agentError(error: unknown): { code: string; message: string } {
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return { code: error.code, message: error.message };
  }
  return { code: "AGENT_EXECUTION_FAILED", message: "Agent workflow failed. No plan was advanced." };
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

export type DemoAgents = {
  riskAssessment: (state: EmergencyState) => Promise<RiskAssessment>;
  resourceRouting: (state: EmergencyState) => Promise<ResourceRoutingAssessment>;
  responsePlanning: (state: EmergencyState) => Promise<ResponsePlanningResult>;
};

export type DemoAgentFactory = (planId: string) => DemoAgents;
export type DemoSimulationExecutor = typeof executeApprovedPlan;

export function deterministicDemoAgents(planId: string): DemoAgents {
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
      const actionId = (sequence: number): string =>
        `ACT-${String((Number(planId.slice("PLAN-".length)) - 1) * 100 + sequence).padStart(3, "0")}`;
      const resourceIds = planId === "PLAN-001"
        ? ["RES-RT-01", "RES-AMB-01"]
        : ["RES-RT-02", "RES-AMB-02"];
      const actions: PlanAction[] = [
        {
          id: actionId(1),
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
          id: actionId(2),
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
          id: actionId(3),
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
          id: actionId(4),
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
    state: { ...fixture.state, activePlan: null },
    agentRuns: fixture.agentRuns,
    stateChanges: [],
    currentPlan: null,
    previousPlan: null,
    planHistory: [],
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

  constructor(
    private readonly agentFactory: DemoAgentFactory = deterministicDemoAgents,
    private readonly simulationExecutor: DemoSimulationExecutor = executeApprovedPlan,
  ) {}

  getSnapshot(): DemoSnapshot {
    return this.snapshot;
  }

  resetDemo(): DemoOperationResult {
    this.snapshot = initialSnapshot();
    return { success: true, snapshot: this.snapshot };
  }

  captureUnexpectedFailure(error: unknown): DemoOperationResult {
    const failure = agentError(error);
    return this.fail(this.snapshot.stage, failure.code, failure.message);
  }

  async startDemo(): Promise<DemoOperationResult> {
    if (this.snapshot.stage !== "IDLE") return this.fail(this.snapshot.stage, "INVALID_TRANSITION", "Reset the demo before starting a new run.");
    const fixture = getDemoState("initial");
    const initialState: EmergencyState = { ...fixture.state, activePlan: null };
    this.snapshot = { ...this.snapshot, stage: "EMERGENCY_INITIALIZED", state: initialState, agentRuns: fixture.agentRuns, stateChanges: [changeRecord("DEMO-001", "INCIDENT", initialState.incident.id, "CREATED", "Emergency detected", null, "ACTIVE", initialState.incident.reportedAt)], progress: { current: 1, total: 9, label: "Emergency initialized" }, error: null };
    let riskAssessment: RiskAssessment;
    let resourceRoutingAssessment: ResourceRoutingAssessment;
    let generated: ResponsePlanningResult;
    let activeAgent: AgentType = "RISK_ASSESSMENT";
    try {
      const agents = this.agentFactory("PLAN-001");
      riskAssessment = await agents.riskAssessment(initialState);
      activeAgent = "RESOURCE_ROUTING";
      resourceRoutingAssessment = await agents.resourceRouting(initialState);
      activeAgent = "RESPONSE_PLANNING";
      generated = await agents.responsePlanning(initialState);
    } catch (error) {
      const failure = agentError(error);
      this.markAgentFailure(activeAgent, failure.message);
      return this.fail("ANALYZING", failure.code, failure.message);
    }
    if (!generated.validation.valid) {
      this.snapshot = { ...this.snapshot, riskAssessment, resourceRoutingAssessment, responsePlanningResult: generated, validation: generated.validation };
      return this.fail("PLAN_GENERATED", "PLAN_VALIDATION_FAILED", generated.validation.errors.map((issue) => `${issue.code}: ${issue.message}`).join(" "));
    }
    const submitted = submitPlanForApproval(generated.plan);
    if (!submitted.success) return this.fail("PLAN_GENERATED", submitted.error.code, submitted.error.message);
    this.snapshot = { ...this.snapshot, stage: "AWAITING_APPROVAL", currentPlan: submitted.plan, planHistory: [submitted.plan], state: { ...initialState, activePlan: submitted.plan }, riskAssessment, resourceRoutingAssessment, responsePlanningResult: generated, validation: generated.validation, stateChanges: [...this.snapshot.stateChanges, changeRecord("DEMO-002", "PLAN", submitted.plan.id, "CREATED", "Response Plan-001 generated", null, "PENDING_APPROVAL", demoTimes.initialPlan)], progress: { current: 2, total: 9, label: "Human authorization required" } };
    return { success: true, snapshot: this.snapshot };
  }

  async approveCurrentPlan(): Promise<DemoOperationResult> {
    const plan = this.snapshot.currentPlan;
    if (plan === null || (this.snapshot.stage !== "AWAITING_APPROVAL" && this.snapshot.stage !== "AWAITING_REVISED_APPROVAL")) return this.fail(this.snapshot.stage, "INVALID_TRANSITION", "Approval is only allowed when a plan is awaiting human approval.");
    const approved = approvePlan(plan, { ...decisionMetadata(plan, "Coordinator approved deterministic demo plan."), currentState: this.snapshot.state });
    if (!approved.success) return this.fail(this.snapshot.stage, approved.error.code, approved.error.message);
    this.snapshot = {
      ...this.snapshot,
      stage: "AWAITING_EXECUTION",
      state: { ...this.snapshot.state, activePlan: approved.plan },
      currentPlan: approved.plan,
      planHistory: this.updatePlanHistory(approved.plan),
      humanDecision: approved.decision ?? null,
      stateChanges: [
        ...this.snapshot.stateChanges,
        changeRecord(
          `DEMO-${plan.id}-HUMAN-APPROVED`,
          "PLAN",
          plan.id,
          "STATUS_CHANGED",
          `${plan.id} approved by the coordinator`,
          "PENDING_APPROVAL",
          "APPROVED",
          approved.plan.updatedAt,
        ),
      ],
      progress: { current: plan.id === "PLAN-001" ? 3 : 8, total: 9, label: "Plan approved · execution available" },
      error: null,
    };
    return { success: true, snapshot: this.snapshot };
  }

  beginExecution(): DemoOperationResult {
    const plan = this.snapshot.currentPlan;
    if (plan === null || this.snapshot.stage !== "AWAITING_EXECUTION" || plan.status !== "APPROVED") {
      return this.fail(this.snapshot.stage, "INVALID_TRANSITION", "Execution is only allowed for an approved plan awaiting execution.");
    }
    const executingStage: DemoStage = plan.id === "PLAN-001" ? "EXECUTING" : "EXECUTING_REVISED_PLAN";
    this.snapshot = {
      ...this.snapshot,
      stage: executingStage,
      progress: { current: plan.id === "PLAN-001" ? 3 : 8, total: 9, label: "Execution in progress" },
    };
    return { success: true, snapshot: this.snapshot };
  }

  completeExecution(): DemoOperationResult {
    const plan = this.snapshot.currentPlan;
    if (
      plan === null ||
      (this.snapshot.stage !== "EXECUTING" && this.snapshot.stage !== "EXECUTING_REVISED_PLAN") ||
      plan.status !== "APPROVED"
    ) {
      return this.fail(this.snapshot.stage, "INVALID_TRANSITION", "Only an approved plan in the executing state can be completed.");
    }
    const executed: SimulationResult = this.simulationExecutor(this.snapshot.state, plan);
    if (!executed.success) return this.fail(this.snapshot.stage, executed.error.code, executed.error.message);
    const executionChanges = executed.stateChanges;
    this.snapshot = {
      ...this.snapshot,
      stage: "COMPLETED",
      state: executed.state,
      currentPlan: executed.plan,
      planHistory: this.updatePlanHistory(executed.plan),
      stateChanges: [...this.snapshot.stateChanges, ...executionChanges, changeRecord(`DEMO-${plan.id}-APPROVED`, "PLAN", plan.id, "STATUS_CHANGED", `${plan.id} approved and executed`, "APPROVED", "COMPLETED", plan.id === "PLAN-001" ? demoTimes.executed : demoTimes.revisedExecuted)],
      progress: { current: plan.id === "PLAN-001" ? 4 : 9, total: 9, label: plan.id === "PLAN-001" ? "Plan-001 complete · situation monitoring" : "Demo completed" },
      error: null,
    };
    return { success: true, snapshot: this.snapshot };
  }

  rejectCurrentPlan(reason: string): DemoOperationResult {
    const plan = this.snapshot.currentPlan;
    if (plan === null || (this.snapshot.stage !== "AWAITING_APPROVAL" && this.snapshot.stage !== "AWAITING_REVISED_APPROVAL")) return this.fail(this.snapshot.stage, "INVALID_TRANSITION", "Rejection is only allowed when a plan is awaiting human approval.");
    const normalizedReason = reason.trim() || "Coordinator rejected the deterministic demo plan.";
    const rejected = rejectPlan(plan, { ...decisionMetadata(plan, normalizedReason), reason: normalizedReason, currentState: this.snapshot.state });
    if (!rejected.success) return this.fail(this.snapshot.stage, rejected.error.code, rejected.error.message);
    this.snapshot = { ...this.snapshot, stage: "FAILED", currentPlan: rejected.plan, planHistory: this.updatePlanHistory(rejected.plan), state: { ...this.snapshot.state, activePlan: rejected.plan }, humanDecision: rejected.decision ?? null, stateChanges: [...this.snapshot.stateChanges, changeRecord(`DEMO-${plan.id}-HUMAN-REJECTED`, "PLAN", plan.id, "STATUS_CHANGED", `${plan.id} rejected by the coordinator`, "PENDING_APPROVAL", "REJECTED", rejected.plan.updatedAt)], progress: { ...this.snapshot.progress, label: "Plan rejected · reset required" }, error: null };
    return { success: true, snapshot: this.snapshot };
  }

  async modifyCurrentPlan(reason: string = "Coordinator requested a plan modification."): Promise<DemoOperationResult> {
    const plan = this.snapshot.currentPlan;
    if (plan === null || (this.snapshot.stage !== "AWAITING_APPROVAL" && this.snapshot.stage !== "AWAITING_REVISED_APPROVAL")) return this.fail(this.snapshot.stage, "INVALID_TRANSITION", "Modification is only allowed when a plan is awaiting human approval.");
    const sequence = Number(plan.id.slice("PLAN-".length));
    if (!Number.isInteger(sequence) || sequence < 1) return this.fail(this.snapshot.stage, "INVALID_PLAN_ID", "The current plan id cannot be used to generate a revised plan.");
    const modifiedPlanId = `PLAN-${String(sequence + 1).padStart(3, "0")}`;

    try {
      const modifiedPlanFactory = this.agentFactory(modifiedPlanId);
      const modified = await modifiedPlanFactory.responsePlanning(this.snapshot.state);

      if (!modified.validation.valid) {
        this.snapshot = { ...this.snapshot, responsePlanningResult: modified, validation: modified.validation };
        return this.fail(this.snapshot.stage, "PLAN_VALIDATION_FAILED", modified.validation.errors.map((issue) => `${issue.code}: ${issue.message}`).join(" "));
      }

      const actionsById = new Map(
        this.snapshot.state.planActions.map((action) => [action.id, action]),
      );
      for (const action of modified.actions) actionsById.set(action.id, action);
      const modifiedState: EmergencyState = {
        ...this.snapshot.state,
        planActions: [...actionsById.values()],
      };
      const modifiedDecision = modifyPlan(plan, modified.plan, {
        ...decisionMetadata(plan, reason.trim() || "Coordinator requested a plan modification."),
        reason: reason.trim() || "Coordinator requested a plan modification.",
        currentState: modifiedState,
      });
      if (!modifiedDecision.success) return this.fail(this.snapshot.stage, modifiedDecision.error.code, modifiedDecision.error.message);

      const resubmitted = submitPlanForApproval({
        ...modifiedDecision.plan,
        status: "DRAFT",
        updatedAt: this.snapshot.state.updatedAt,
      });
      if (!resubmitted.success) return this.fail(this.snapshot.stage, resubmitted.error.code, resubmitted.error.message);

      const nextStage: DemoStage = this.snapshot.stage === "AWAITING_REVISED_APPROVAL" ? "AWAITING_REVISED_APPROVAL" : "AWAITING_APPROVAL";
      this.snapshot = {
        ...this.snapshot,
        stage: nextStage,
        state: { ...modifiedState, activePlan: resubmitted.plan },
        currentPlan: resubmitted.plan,
        planHistory: [
          ...this.snapshot.planHistory.map((historyPlan) =>
            historyPlan.id === plan.id
              ? { ...historyPlan, status: "SUPERSEDED" as const, updatedAt: modifiedState.updatedAt }
              : historyPlan,
          ),
          resubmitted.plan,
        ],
        previousPlan: plan,
        humanDecision: modifiedDecision.decision ?? null,
        responsePlanningResult: modified,
        validation: modified.validation,
        stateChanges: [
          ...this.snapshot.stateChanges,
          changeRecord(
            `DEMO-${modifiedPlanId}-MODIFIED`,
            "PLAN",
            modifiedPlanId,
            "CREATED",
            `${modifiedPlanId} generated after coordinator modification`,
            null,
            "PENDING_APPROVAL",
            resubmitted.plan.generatedAt,
          ),
          changeRecord(
            `DEMO-${plan.id}-SUPERSEDED`,
            "PLAN",
            plan.id,
            "STATUS_CHANGED",
            `${plan.id} superseded by ${modifiedPlanId}`,
            "PENDING_APPROVAL",
            "SUPERSEDED",
            modifiedState.updatedAt,
          ),
        ],
        progress: { current: this.snapshot.stage === "AWAITING_REVISED_APPROVAL" ? 8 : 2, total: 9, label: "Modified plan pending approval" },
        error: null,
      };
      return { success: true, snapshot: this.snapshot };
    } catch (error) {
      const failure = agentError(error);
      return this.fail(this.snapshot.stage, failure.code, failure.message);
    }
  }

  async simulateRouteBlockage(): Promise<DemoOperationResult> {
    const activePlan = this.snapshot.currentPlan;
    if (this.snapshot.stage !== "COMPLETED" || activePlan === null || activePlan.id !== "PLAN-001") return this.fail(this.snapshot.stage, "INVALID_TRANSITION", "R1 blockage can only be simulated after Plan-001 execution.");
    const previousState = this.snapshot.state;
    const primaryRoute = previousState.routes.find((route) => route.id === "R1");
    if (primaryRoute === undefined) return this.fail("SITUATION_CHANGED", "ROUTE_NOT_FOUND", "Primary route R1 is not present in the current emergency state.");
    const transitionedRoute = transitionRouteStatus(primaryRoute, "BLOCKED", "Flooding reported on primary access route.");
    const blockedRoute = transitionedRoute.route;
    if (!transitionedRoute.valid || blockedRoute === null) return this.fail("SITUATION_CHANGED", transitionedRoute.errors[0]?.code ?? "ROUTE_TRANSITION_FAILED", transitionedRoute.errors[0]?.message ?? "Route R1 could not be blocked.");
    const currentState: EmergencyState = {
      ...previousState,
      routes: previousState.routes.map((route) => route.id === "R1" ? { ...blockedRoute, updatedAt: demoTimes.blockage } : route),
      stateVersion: previousState.stateVersion + 1,
      updatedAt: demoTimes.blockage,
    };
    this.snapshot = { ...this.snapshot, stage: "SITUATION_CHANGED", state: currentState, previousPlan: activePlan, stateChanges: [...this.snapshot.stateChanges, changeRecord("DEMO-ROUTE-001", "ROUTE", "R1", "STATUS_CHANGED", "Route R1 blocked", "OPEN", "BLOCKED", demoTimes.blockage)], progress: { current: 5, total: 9, label: "Situation changed · detecting impact" } };
    const detection = detectEmergencyStateChanges({ previousState, currentState, activePlan });
    if (detection.success === false) return this.fail("CHANGE_DETECTED", "CHANGE_DETECTION_FAILED", detection.error.message);
    this.snapshot = {
      ...this.snapshot,
      stage: "CHANGE_DETECTED",
      stateChanges: [
        ...this.snapshot.stateChanges,
        changeRecord(
          "DEMO-CHANGE-001",
          "PLAN",
          activePlan.id,
          "UPDATED",
          `Change detected: ${detection.classification}`,
          null,
          detection.classification,
          demoTimes.blockage,
        ),
      ],
    };
    if (detection.classification !== "PLAN_AFFECTED_REASSESSMENT_REQUIRED") return this.fail("CHANGE_DETECTED", "UNEXPECTED_CHANGE_CLASSIFICATION", detection.reason);
    this.snapshot = {
      ...this.snapshot,
      stage: "REASSESSING",
      stateChanges: [
        ...this.snapshot.stateChanges,
        changeRecord(
          "DEMO-REASSESSMENT-001",
          "PLAN",
          activePlan.id,
          "UPDATED",
          `Reassessment started for affected plan ${activePlan.id}`,
          "ACTIVE",
          "REASSESSING",
          demoTimes.blockage,
        ),
      ],
      progress: { current: 6, total: 9, label: "Plan dependency affected · reassessing" },
    };
    let riskAssessment: RiskAssessment;
    let resourceRoutingAssessment: ResourceRoutingAssessment;
    let revised: ResponsePlanningResult;
    let activeAgent: AgentType = "RISK_ASSESSMENT";
    try {
      const agents = this.agentFactory("PLAN-002");
      riskAssessment = await agents.riskAssessment(currentState);
      activeAgent = "RESOURCE_ROUTING";
      resourceRoutingAssessment = await agents.resourceRouting(currentState);
      activeAgent = "RESPONSE_PLANNING";
      revised = await agents.responsePlanning(currentState);
    } catch (error) {
      const failure = agentError(error);
      this.markAgentFailure(activeAgent, failure.message);
      return this.fail("REASSESSING", failure.code, failure.message);
    }
    if (!revised.validation.valid) {
      this.snapshot = { ...this.snapshot, riskAssessment, resourceRoutingAssessment, responsePlanningResult: revised, validation: revised.validation };
      return this.fail("REASSESSING", "PLAN_VALIDATION_FAILED", revised.validation.errors.map((issue) => `${issue.code}: ${issue.message}`).join(" "));
    }
    const revisedPlan = submitPlanForApproval(revised.plan);
    if (!revisedPlan.success) return this.fail("REASSESSING", revisedPlan.error.code, revisedPlan.error.message);
    this.snapshot = { ...this.snapshot, stage: "AWAITING_REVISED_APPROVAL", state: { ...currentState, planActions: [...currentState.planActions, ...revised.actions], activePlan: revisedPlan.plan }, currentPlan: revisedPlan.plan, previousPlan: activePlan, planHistory: [...this.snapshot.planHistory, revisedPlan.plan], riskAssessment, resourceRoutingAssessment, responsePlanningResult: revised, validation: revised.validation, humanDecision: null, stateChanges: [...this.snapshot.stateChanges, changeRecord("DEMO-PLAN-002", "PLAN", revisedPlan.plan.id, "CREATED", "Response Plan-002 generated", null, "PENDING_APPROVAL", demoTimes.revisedPlan)], progress: { current: 7, total: 9, label: "Revised plan ready · human authorization required" }, error: null };
    return { success: true, snapshot: this.snapshot };
  }

  retryDemo(): Promise<DemoOperationResult> {
    if (this.snapshot.stage !== "IDLE") return Promise.resolve(this.fail(this.snapshot.stage, "RESET_REQUIRED", "Reset the demo before retrying a failed workflow."));
    return this.startDemo();
  }

  private markAgentFailure(agentType: AgentType, message: string): void {
    this.snapshot = {
      ...this.snapshot,
      agentRuns: this.snapshot.agentRuns.map((run) =>
        run.agentType === agentType
          ? {
              ...run,
              status: "FAILED",
              completedAt: this.snapshot.state.updatedAt,
              durationMs: 0,
              output: null,
              errorMessage: message,
            }
          : run,
      ),
    };
  }

  private updatePlanHistory(plan: ResponsePlan): ResponsePlan[] {
    const index = this.snapshot.planHistory.findIndex((item) => item.id === plan.id);
    if (index === -1) return [...this.snapshot.planHistory, plan];
    return this.snapshot.planHistory.map((item) => item.id === plan.id ? plan : item);
  }

  private fail(stage: DemoStage, code: string, message: string): DemoOperationResult {
    const error = operationError(stage, code, message, this.snapshot.state.updatedAt);
    this.snapshot = { ...this.snapshot, stage: "FAILED", progress: { ...this.snapshot.progress, label: "Demo failed" }, error };
    return { success: false, snapshot: this.snapshot, error };
  }
}

export function createDemoController(
  agentFactory?: DemoAgentFactory,
  simulationExecutor?: DemoSimulationExecutor,
): DemoController {
  return new DemoController(agentFactory, simulationExecutor);
}
