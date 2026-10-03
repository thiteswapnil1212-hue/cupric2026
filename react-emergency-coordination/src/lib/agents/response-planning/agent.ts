import "server-only";

import {
  EmergencyStateSchema,
  type EmergencyState,
} from "../../../domain/emergency-state/schema";
import type { PlanAction } from "../../../domain/plan-action/schema";
import {
  ResponsePlanSchema,
  type ResponsePlan,
} from "../../../domain/response-plan/schema";
import {
  GeminiError,
  generateStructuredJson,
  serializeGeminiInput,
  type GeminiGenerationMetadata,
} from "../../ai/gemini";
import { validateEmergencyStateConsistency } from "../../emergency-state/consistency";
import {
  validatePlan,
} from "../../emergency-engine/plan-validator";
import {
  ResourceRoutingAssessmentSchema,
  type ResourceRoutingAssessment,
} from "../resource-routing/schema";
import {
  RiskAssessmentSchema,
  type RiskAssessment,
} from "../risk-assessment/schema";
import {
  ResponsePlanningOutputSchema,
  type ProposedPlanAction,
  type ResponsePlanningOutput,
} from "./schema";
import type { ResponsePlanningAlternative, ResponsePlanningResult } from "./types";
export type { ResponsePlanningAlternative, ResponsePlanningResult } from "./types";

const responsePlanningSystemInstruction = `You are the Response Planning Agent in REACT.

RESPONSIBILITY
Propose one primary response plan and up to five recommendation-only alternatives. The primary plan is a draft for human review, not an approval or execution decision.

AUTHORITATIVE FACTS
EmergencyState is the factual source of truth. Risk assessment and resource-routing assessment are supporting analyses, not authority to change EmergencyState. Use only exact resource, facility, and route IDs present in EmergencyState. Do not invent operational facts, IDs, capacity, availability, status, locations, or incident details. Any targetLocation must exactly match a location in EmergencyState.

DO NOT
- Change the supplied state or claim that any action has been executed.
- Approve, reject, or modify an existing plan.
- Invent resource, facility, or route IDs.
- Treat alternatives as executable actions; they are recommendations only.
- Silently repair missing, conflicting, or unavailable facts.

OUTPUT
Return only the requested structured response. Propose ordered, uniquely sequenced actions. Keep recommendations and rationale grounded in the supplied facts. If information is incomplete, state the uncertainty in constraints or reasoning instead of filling gaps.`;

export type ResponsePlanningAgentErrorCode =
  | "RESPONSE_PLANNING_INPUT_INVALID"
  | "RESPONSE_PLANNING_ASSESSMENT_INVALID"
  | "RESPONSE_PLANNING_FACT_CONFLICT"
  | "RESPONSE_PLANNING_GEMINI_CONFIG_ERROR"
  | "RESPONSE_PLANNING_GEMINI_REQUEST_ERROR"
  | "RESPONSE_PLANNING_GEMINI_TIMEOUT"
  | "RESPONSE_PLANNING_GEMINI_UNAVAILABLE"
  | "RESPONSE_PLANNING_INVALID_STRUCTURED_OUTPUT"
  | "RESPONSE_PLANNING_SCHEMA_VALIDATION_FAILED"
  | "RESPONSE_PLANNING_OUTPUT_INVALID"
  | "RESPONSE_PLANNING_ID_GENERATION_CONFLICT"
  | "RESPONSE_PLANNING_PRIMARY_PLAN_INVALID";

export class ResponsePlanningAgentError extends Error {
  readonly code: ResponsePlanningAgentErrorCode;
  readonly issues: readonly string[] | undefined;
  readonly geminiGeneration: GeminiGenerationMetadata | undefined;

  constructor(
    code: ResponsePlanningAgentErrorCode,
    message: string,
    issues?: readonly string[],
    geminiGeneration?: GeminiGenerationMetadata,
  ) {
    super(message);
    this.name = "ResponsePlanningAgentError";
    this.code = code;
    this.issues = issues;
    this.geminiGeneration = geminiGeneration;
  }
}

type ResponsePlanningFacts = {
  stateVersion: number;
  incident: {
    id: string;
    type: EmergencyState["incident"]["type"];
    status: EmergencyState["incident"]["status"];
    severity: EmergencyState["incident"]["severity"];
    priority: EmergencyState["incident"]["priority"];
    location: EmergencyState["incident"]["location"];
    affectedPopulation: number;
    hazards: string[];
  };
  resources: {
    id: string;
    name: string;
    type: EmergencyState["resources"][number]["type"];
    status: EmergencyState["resources"][number]["status"];
    location: EmergencyState["resources"][number]["location"];
    capacity: number;
    currentAssignmentId: string | null;
    capabilities: string[];
  }[];
  facilities: {
    id: string;
    name: string;
    type: EmergencyState["facilities"][number]["type"];
    status: EmergencyState["facilities"][number]["status"];
    location: EmergencyState["facilities"][number]["location"];
    totalCapacity: number;
    availableCapacity: number;
    capabilities: string[];
  }[];
  routes: {
    id: string;
    name: string;
    status: EmergencyState["routes"][number]["status"];
    distanceKm: number;
    estimatedTravelMinutes: number;
    origin: EmergencyState["routes"][number]["origin"];
    destination: EmergencyState["routes"][number]["destination"];
    blockedReason: string | null;
  }[];
  riskAssessment: RiskAssessment;
  resourceRoutingAssessment: ResourceRoutingAssessment;
};

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareIds(left: { id: string }, right: { id: string }): number {
  return compareStrings(left.id, right.id);
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareStrings);
}

function formatZodIssues(
  issues: readonly { path: PropertyKey[]; message: string }[],
  fallback: string,
): string[] {
  return issues.map((issue) => {
    const path = issue.path.map(String).join(".") || fallback;
    return `${path}: ${issue.message}`;
  });
}

function serializeResponsePlanningFacts(
  state: EmergencyState,
  riskAssessment: RiskAssessment,
  resourceRoutingAssessment: ResourceRoutingAssessment,
): string {
  const facts: ResponsePlanningFacts = {
    stateVersion: state.stateVersion,
    incident: {
      id: state.incident.id,
      type: state.incident.type,
      status: state.incident.status,
      severity: state.incident.severity,
      priority: state.incident.priority,
      location: { ...state.incident.location },
      affectedPopulation: state.incident.affectedPopulation,
      hazards: [...state.incident.hazards].sort(compareStrings),
    },
    resources: [...state.resources].sort(compareIds).map((resource) => ({
      id: resource.id,
      name: resource.name,
      type: resource.type,
      status: resource.status,
      location: { ...resource.location },
      capacity: resource.capacity,
      currentAssignmentId: resource.currentAssignmentId,
      capabilities: [...resource.capabilities].sort(compareStrings),
    })),
    facilities: [...state.facilities].sort(compareIds).map((facility) => ({
      id: facility.id,
      name: facility.name,
      type: facility.type,
      status: facility.status,
      location: { ...facility.location },
      totalCapacity: facility.totalCapacity,
      availableCapacity: facility.availableCapacity,
      capabilities: [...facility.capabilities].sort(compareStrings),
    })),
    routes: [...state.routes].sort(compareIds).map((route) => ({
      id: route.id,
      name: route.name,
      status: route.status,
      distanceKm: route.distanceKm,
      estimatedTravelMinutes: route.estimatedTravelMinutes,
      origin: { ...route.origin },
      destination: { ...route.destination },
      blockedReason: route.blockedReason,
    })),
    riskAssessment: {
      ...riskAssessment,
      hazardFactors: [...riskAssessment.hazardFactors].sort(compareStrings),
      riskFactors: [...riskAssessment.riskFactors].sort(compareStrings),
      keyConcerns: [...riskAssessment.keyConcerns].sort(compareStrings),
    },
    resourceRoutingAssessment: {
      resources: [...resourceRoutingAssessment.resources]
        .sort((left, right) => compareStrings(left.resourceId, right.resourceId))
        .map((resource) => ({
          ...resource,
          capabilityMatch: [...resource.capabilityMatch].sort(compareStrings),
          notes: [...resource.notes].sort(compareStrings),
        })),
      facilities: [...resourceRoutingAssessment.facilities]
        .sort((left, right) => compareStrings(left.facilityId, right.facilityId))
        .map((facility) => ({
          ...facility,
          notes: [...facility.notes].sort(compareStrings),
        })),
      routes: [...resourceRoutingAssessment.routes]
        .sort((left, right) => compareStrings(left.routeId, right.routeId))
        .map((route) => ({ ...route, notes: [...route.notes].sort(compareStrings) })),
      constraints: [...resourceRoutingAssessment.constraints].sort(compareStrings),
      reasoning: resourceRoutingAssessment.reasoning,
    },
  };

  return serializeGeminiInput(facts);
}

function validateRiskAssessmentFacts(
  assessment: RiskAssessment,
  state: EmergencyState,
): void {
  const conflicts: string[] = [];

  if (assessment.affectedPopulation !== state.incident.affectedPopulation) {
    conflicts.push("affectedPopulation must equal incident.affectedPopulation");
  }

  const suppliedHazards = new Set(state.incident.hazards);
  if (assessment.hazardFactors.some((hazard) => !suppliedHazards.has(hazard))) {
    conflicts.push("hazardFactors must only contain supplied incident hazards");
  }

  if (conflicts.length > 0) {
    throw new ResponsePlanningAgentError(
      "RESPONSE_PLANNING_FACT_CONFLICT",
      "Risk assessment contradicted authoritative EmergencyState facts.",
      conflicts,
    );
  }
}

function validateResourceRoutingFacts(
  assessment: ResourceRoutingAssessment,
  state: EmergencyState,
): void {
  const issues: string[] = [];
  const resourceById = new Map(state.resources.map((resource) => [resource.id, resource]));
  const facilityById = new Map(state.facilities.map((facility) => [facility.id, facility]));
  const routeById = new Map(state.routes.map((route) => [route.id, route]));

  const seenResources = new Set<string>();
  for (const assessed of assessment.resources) {
    if (seenResources.has(assessed.resourceId)) {
      issues.push(`Resource ${assessed.resourceId} appears more than once.`);
      continue;
    }
    seenResources.add(assessed.resourceId);
    const expected = resourceById.get(assessed.resourceId);
    if (expected === undefined) {
      issues.push(`Unknown resource ${assessed.resourceId} was assessed.`);
      continue;
    }
    if (assessed.status !== expected.status || assessed.capacity !== expected.capacity) {
      issues.push(`Resource ${assessed.resourceId} has conflicting status or capacity.`);
    }
    if (
      assessed.capabilityMatch.some(
        (capability) => !expected.capabilities.includes(capability),
      )
    ) {
      issues.push(`Resource ${assessed.resourceId} has an unknown capability match.`);
    }
  }
  for (const resource of state.resources) {
    if (!seenResources.has(resource.id)) {
      issues.push(`Resource ${resource.id} was omitted from the assessment.`);
    }
  }

  const seenFacilities = new Set<string>();
  for (const assessed of assessment.facilities) {
    if (seenFacilities.has(assessed.facilityId)) {
      issues.push(`Facility ${assessed.facilityId} appears more than once.`);
      continue;
    }
    seenFacilities.add(assessed.facilityId);
    const expected = facilityById.get(assessed.facilityId);
    if (expected === undefined) {
      issues.push(`Unknown facility ${assessed.facilityId} was assessed.`);
      continue;
    }
    if (
      assessed.status !== expected.status ||
      assessed.totalCapacity !== expected.totalCapacity ||
      assessed.availableCapacity !== expected.availableCapacity
    ) {
      issues.push(`Facility ${assessed.facilityId} has conflicting status or capacity.`);
    }
  }
  for (const facility of state.facilities) {
    if (!seenFacilities.has(facility.id)) {
      issues.push(`Facility ${facility.id} was omitted from the assessment.`);
    }
  }

  const seenRoutes = new Set<string>();
  for (const assessed of assessment.routes) {
    if (seenRoutes.has(assessed.routeId)) {
      issues.push(`Route ${assessed.routeId} appears more than once.`);
      continue;
    }
    seenRoutes.add(assessed.routeId);
    const expected = routeById.get(assessed.routeId);
    if (expected === undefined) {
      issues.push(`Unknown route ${assessed.routeId} was assessed.`);
      continue;
    }
    if (
      assessed.status !== expected.status ||
      assessed.distanceKm !== expected.distanceKm ||
      assessed.estimatedTravelMinutes !== expected.estimatedTravelMinutes
    ) {
      issues.push(`Route ${assessed.routeId} has conflicting status or route metrics.`);
    }
  }
  for (const route of state.routes) {
    if (!seenRoutes.has(route.id)) {
      issues.push(`Route ${route.id} was omitted from the assessment.`);
    }
  }

  if (issues.length > 0) {
    throw new ResponsePlanningAgentError(
      "RESPONSE_PLANNING_FACT_CONFLICT",
      "Resource-routing assessment contradicted authoritative EmergencyState facts.",
      issues,
    );
  }
}

function mapGeminiError(error: GeminiError): ResponsePlanningAgentError {
  switch (error.code) {
    case "GEMINI_CONFIG_ERROR":
      return new ResponsePlanningAgentError(
        "RESPONSE_PLANNING_GEMINI_CONFIG_ERROR",
        "Response planning Gemini configuration is unavailable.",
      );
    case "GEMINI_REQUEST_ERROR":
      return new ResponsePlanningAgentError(
        "RESPONSE_PLANNING_GEMINI_REQUEST_ERROR",
        "Response planning Gemini request failed.",
        undefined,
        error.metadata,
      );
    case "GEMINI_TIMEOUT":
      return new ResponsePlanningAgentError(
        "RESPONSE_PLANNING_GEMINI_TIMEOUT",
        "Response planning Gemini request timed out.",
        undefined,
        error.metadata,
      );
    case "GEMINI_AI_UNAVAILABLE":
      return new ResponsePlanningAgentError(
        "RESPONSE_PLANNING_GEMINI_UNAVAILABLE",
        "Response planning is unavailable because all configured Gemini models failed.",
        undefined,
        error.metadata,
      );
    case "GEMINI_EMPTY_RESPONSE":
    case "GEMINI_INVALID_JSON":
      return new ResponsePlanningAgentError(
        "RESPONSE_PLANNING_INVALID_STRUCTURED_OUTPUT",
        "Gemini did not return a usable structured response plan.",
      );
    case "GEMINI_SCHEMA_VALIDATION_FAILED":
      return new ResponsePlanningAgentError(
        "RESPONSE_PLANNING_SCHEMA_VALIDATION_FAILED",
        "Gemini response plan did not match the required schema.",
        error.validationIssues,
        error.metadata,
      );
  }
}

function validateProposalReferences(
  output: ResponsePlanningOutput,
  state: EmergencyState,
): void {
  const resources = new Set(state.resources.map((resource) => resource.id));
  const facilities = new Set(state.facilities.map((facility) => facility.id));
  const routes = new Set(state.routes.map((route) => route.id));
  const locations = [
    state.incident.location,
    ...state.resources.map((resource) => resource.location),
    ...state.facilities.map((facility) => facility.location),
    ...state.routes.flatMap((route) => [route.origin, route.destination]),
  ];
  const issues: string[] = [];

  function checkReferences(
    actionName: string,
    resourceIds: readonly string[],
    facilityIds: readonly string[],
    routeIds: readonly string[],
  ): void {
    for (const [label, ids, knownIds] of [
      ["resource", resourceIds, resources],
      ["facility", facilityIds, facilities],
      ["route", routeIds, routes],
    ] as const) {
      const seen = new Set<string>();
      for (const id of ids) {
        if (seen.has(id)) {
          issues.push(`${actionName} repeats ${label} ID ${id}.`);
        }
        seen.add(id);
        if (!knownIds.has(id)) {
          issues.push(`${actionName} references unknown ${label} ID ${id}.`);
        }
      }
    }
  }

  for (const action of output.primaryPlan.actions) {
    const name = `Primary action ${action.sequence}`;
    checkReferences(name, action.resourceIds, action.facilityIds, action.routeIds);
    if (
      action.targetLocation !== null &&
      !locations.some(
        (location) =>
          location.latitude === action.targetLocation?.latitude &&
          location.longitude === action.targetLocation.longitude,
      )
    ) {
      issues.push(`${name} has a targetLocation not present in EmergencyState.`);
    }
  }

  for (const [index, alternative] of output.alternatives.entries()) {
    checkReferences(
      `Alternative ${index + 1}`,
      alternative.resourceIds,
      alternative.facilityIds,
      alternative.routeIds,
    );
  }

  if (issues.length > 0) {
    throw new ResponsePlanningAgentError(
      "RESPONSE_PLANNING_OUTPUT_INVALID",
      "Response planning output contains unsupported operational references.",
      issues,
    );
  }
}

function createPlanActions(
  proposals: readonly ProposedPlanAction[],
  planId: string,
  timestamp: string,
  state: EmergencyState,
): PlanAction[] {
  const existingIds = new Set([
    ...state.planActions.map((action) => action.id),
    ...state.planActions.map((action) => action.planId),
    ...(state.activePlan === null ? [] : [state.activePlan.id]),
  ]);
  const generatedIds = new Set<string>([planId]);
  if (existingIds.has(planId)) {
    throw new ResponsePlanningAgentError(
      "RESPONSE_PLANNING_ID_GENERATION_CONFLICT",
      "A generated response plan ID conflicts with an existing plan or action.",
    );
  }

  return proposals.map((proposal) => {
    const id = crypto.randomUUID();
    if (existingIds.has(id) || generatedIds.has(id)) {
      throw new ResponsePlanningAgentError(
        "RESPONSE_PLANNING_ID_GENERATION_CONFLICT",
        "A generated PlanAction ID conflicts with an existing candidate ID.",
      );
    }
    generatedIds.add(id);
    return {
      id,
      planId,
      sequence: proposal.sequence,
      type: proposal.type,
      status: "PENDING",
      description: proposal.description,
      priority: proposal.priority,
      resourceIds: [...proposal.resourceIds],
      facilityIds: [...proposal.facilityIds],
      routeIds: [...proposal.routeIds],
      ...(proposal.capacityDemand === undefined
        ? {}
        : { capacityDemand: proposal.capacityDemand }),
      targetLocation:
        proposal.targetLocation === null
          ? null
          : { ...proposal.targetLocation },
      estimatedDurationMinutes: proposal.estimatedDurationMinutes,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  });
}

function createDependencies(actions: readonly PlanAction[]): ResponsePlan["dependencies"] {
  return {
    resourceIds: sortedUnique(actions.flatMap((action) => action.resourceIds)),
    facilityIds: sortedUnique(actions.flatMap((action) => action.facilityIds)),
    routeIds: sortedUnique(actions.flatMap((action) => action.routeIds)),
  };
}

function createAlternatives(
  output: ResponsePlanningOutput,
  state: EmergencyState,
  generatedIds: ReadonlySet<string>,
): ResponsePlanningAlternative[] {
  const existingIds = new Set([
    ...(state.activePlan === null ? [] : [state.activePlan.id]),
    ...state.planActions.map((action) => action.id),
    ...state.planActions.map((action) => action.planId),
    ...generatedIds,
  ]);

  return output.alternatives.map((alternative) => {
    const id = crypto.randomUUID();
    if (existingIds.has(id)) {
      throw new ResponsePlanningAgentError(
        "RESPONSE_PLANNING_ID_GENERATION_CONFLICT",
        "A generated alternative ID conflicts with an existing candidate ID.",
      );
    }
    existingIds.add(id);
    return { id, ...alternative, recommendationOnly: true };
  });
}

export async function runResponsePlanning(
  emergencyState: EmergencyState,
  riskAssessment: RiskAssessment,
  resourceRoutingAssessment: ResourceRoutingAssessment,
): Promise<ResponsePlanningResult> {
  const stateValidation = EmergencyStateSchema.safeParse(emergencyState);
  if (!stateValidation.success) {
    throw new ResponsePlanningAgentError(
      "RESPONSE_PLANNING_INPUT_INVALID",
      "Response planning requires a valid EmergencyState.",
      formatZodIssues(stateValidation.error.issues, "emergencyState"),
    );
  }

  const riskValidation = RiskAssessmentSchema.safeParse(riskAssessment);
  const routingValidation = ResourceRoutingAssessmentSchema.safeParse(
    resourceRoutingAssessment,
  );
  if (!riskValidation.success || !routingValidation.success) {
    const issues = [
      ...(riskValidation.success
        ? []
        : formatZodIssues(riskValidation.error.issues, "riskAssessment")),
      ...(routingValidation.success
        ? []
        : formatZodIssues(
            routingValidation.error.issues,
            "resourceRoutingAssessment",
          )),
    ];
    throw new ResponsePlanningAgentError(
      "RESPONSE_PLANNING_ASSESSMENT_INVALID",
      "Response planning requires valid risk and resource-routing assessments.",
      issues,
    );
  }

  const state = stateValidation.data;
  const risk = riskValidation.data;
  const routing = routingValidation.data;
  const consistency = validateEmergencyStateConsistency(state);
  if (!consistency.valid) {
    throw new ResponsePlanningAgentError(
      "RESPONSE_PLANNING_INPUT_INVALID",
      "Response planning requires a consistent EmergencyState.",
      consistency.errors.map((issue) => `${issue.code}: ${issue.message}`),
    );
  }

  validateRiskAssessmentFacts(risk, state);
  validateResourceRoutingFacts(routing, state);

  let generatedOutput: ResponsePlanningOutput;
  try {
    generatedOutput = await generateStructuredJson({
      systemInstruction: responsePlanningSystemInstruction,
      input: serializeResponsePlanningFacts(state, risk, routing),
      schema: ResponsePlanningOutputSchema,
    });
  } catch (error) {
    if (error instanceof GeminiError) throw mapGeminiError(error);
    throw new ResponsePlanningAgentError(
      "RESPONSE_PLANNING_GEMINI_REQUEST_ERROR",
      "Response planning could not complete its Gemini request.",
    );
  }

  const outputValidation = ResponsePlanningOutputSchema.safeParse(generatedOutput);
  if (!outputValidation.success) {
    throw new ResponsePlanningAgentError(
      "RESPONSE_PLANNING_SCHEMA_VALIDATION_FAILED",
      "Response planning output did not match the required schema.",
      formatZodIssues(outputValidation.error.issues, "responsePlanning"),
    );
  }
  const output = outputValidation.data;
  validateProposalReferences(output, state);

  const timestamp = new Date().toISOString();
  const planId = crypto.randomUUID();
  const actions = createPlanActions(
    output.primaryPlan.actions,
    planId,
    timestamp,
    state,
  );
  const generatedCandidateIds = new Set([
    planId,
    ...actions.map((action) => action.id),
  ]);
  const alternatives = createAlternatives(output, state, generatedCandidateIds);
  const plan: ResponsePlan = {
    id: planId,
    incidentId: state.incident.id,
    stateVersion: state.stateVersion,
    status: "DRAFT",
    priority: output.primaryPlan.priority,
    summary: output.primaryPlan.summary,
    rationale: output.primaryPlan.rationale,
    generatedAt: timestamp,
    updatedAt: timestamp,
    actions: [...actions]
      .sort((left, right) => left.sequence - right.sequence)
      .map((action) => ({ actionId: action.id, sequence: action.sequence })),
    alternatives: alternatives.map(({ id, summary, rationale }) => ({
      id,
      summary,
      rationale,
    })),
    dependencies: createDependencies(actions),
  };

  const candidateState: EmergencyState = {
    ...state,
    planActions: [...state.planActions, ...actions],
  };
  const validation = validatePlan(plan, candidateState);
  if (!validation.valid) {
    throw new ResponsePlanningAgentError(
      "RESPONSE_PLANNING_PRIMARY_PLAN_INVALID",
      "The proposed primary response plan failed deterministic PlanValidator checks.",
      validation.errors.map((issue) => `${issue.code}: ${issue.message}`),
    );
  }

  return {
    plan: ResponsePlanSchema.parse(plan),
    actions,
    alternatives,
    constraints: output.constraints,
    reasoning: output.reasoning,
    confidence: output.confidence,
    validation,
  };
}
