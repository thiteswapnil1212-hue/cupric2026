import { EmergencyStateSchema, type EmergencyState } from "../../domain/emergency-state/schema";
import type { IncidentType } from "../../domain/incident/schema";
import type { PlanAction } from "../../domain/plan-action/schema";
import type { FacilityType } from "../../domain/facility/schema";
import type { ResourceType } from "../../domain/resource/schema";
import type { ResponsePlan } from "../../domain/response-plan/schema";
import { RiskAssessmentSchema, type RiskAssessment } from "./risk-assessment/schema";
import {
  ResourceRoutingAssessmentSchema,
  type ResourceRoutingAssessment,
} from "./resource-routing/schema";
import {
  ResponsePlanningResultSchema,
  type ResponsePlanningGenerationMetadata,
  type ResponsePlanningResult,
} from "./response-planning/types";
import { validateEmergencyStateConsistency } from "../emergency-state/consistency";
import { validatePlan } from "../emergency-engine/plan-validator";
import type { PlanValidationResult } from "../emergency-engine/plan-validator";
import { canAssignResource, isResourceAvailable } from "../emergency-engine/resources";
import { isFacilityAvailable, validateFacilityCapacityAllocation, validateFacilityStatus } from "../emergency-engine/facilities";
import { isRouteAvailable, isRouteFullyOpen, validateRouteUse } from "../emergency-engine/routes";
import type { GeminiFailureCategory, GeminiModel } from "../ai/gemini-contract";

export class DeterministicFallbackError extends Error {
  readonly code = "DETERMINISTIC_FALLBACK_INVALID";
  readonly validation: PlanValidationResult | undefined;

  constructor(validation?: PlanValidationResult) {
    super("Deterministic fallback could not create a PlanValidator-valid plan.");
    this.name = "DeterministicFallbackError";
    this.validation = validation;
  }
}

function sameLocation(
  left: { latitude: number; longitude: number },
  right: { latitude: number; longitude: number },
): boolean {
  return left.latitude === right.latitude && left.longitude === right.longitude;
}

const resourceCapabilitiesByIncident: Partial<
  Record<IncidentType, Partial<Record<ResourceType, readonly RegExp[]>>>
> = {
  FIRE: {
    FIRE_UNIT: [/fire/],
    RESCUE_TEAM: [/rescue/],
    AMBULANCE: [/patient transport/, /medical/],
    MEDICAL_TEAM: [/medical/, /triage/],
  },
  MEDICAL: {
    AMBULANCE: [/patient transport/, /medical/],
    MEDICAL_TEAM: [/medical/, /triage/],
    HELICOPTER: [/medical/, /patient transport/],
  },
  BUILDING_COLLAPSE: {
    RESCUE_TEAM: [/rescue/, /structural/],
    FIRE_UNIT: [/fire/, /rescue/],
    HELICOPTER: [/rescue/],
  },
  FLOOD: {
    RESCUE_TEAM: [/rescue/, /water/, /flood/],
    FIRE_UNIT: [/rescue/, /water/, /flood/],
    HELICOPTER: [/rescue/, /water/, /flood/],
  },
  ROAD_ACCIDENT: {
    AMBULANCE: [/patient transport/, /medical/],
    MEDICAL_TEAM: [/medical/, /triage/],
    RESCUE_TEAM: [/rescue/],
    POLICE_UNIT: [/traffic/, /road safety/],
  },
  INDUSTRIAL_ACCIDENT: {
    FIRE_UNIT: [/fire/, /hazmat/],
    MEDICAL_TEAM: [/medical/, /triage/],
    RESCUE_TEAM: [/rescue/],
  },
};

const facilityCapabilitiesByIncident: Partial<
  Record<IncidentType, Partial<Record<FacilityType, readonly RegExp[]>>>
> = {
  FIRE: {
    HOSPITAL: [/emergency care/, /medical/, /trauma/],
    MEDICAL_CENTER: [/emergency care/, /medical/, /trauma/],
  },
  MEDICAL: {
    HOSPITAL: [/emergency care/, /medical/, /trauma/],
    MEDICAL_CENTER: [/emergency care/, /medical/, /trauma/],
  },
  ROAD_ACCIDENT: {
    HOSPITAL: [/emergency care/, /medical/, /trauma/],
    MEDICAL_CENTER: [/emergency care/, /medical/, /trauma/],
  },
  INDUSTRIAL_ACCIDENT: {
    HOSPITAL: [/emergency care/, /medical/, /trauma/],
    MEDICAL_CENTER: [/emergency care/, /medical/, /trauma/],
  },
};

function resourceSupportsIncident(
  resource: EmergencyState["resources"][number],
  incident: EmergencyState["incident"],
): boolean {
  const requiredCapabilities =
    resourceCapabilitiesByIncident[incident.type]?.[resource.type];
  if (requiredCapabilities === undefined) return false;
  if (
    incident.type === "FIRE" &&
    resource.type === "AMBULANCE" &&
    incident.affectedPopulation === 0
  ) {
    return false;
  }
  return resource.capabilities.some((capability) =>
    requiredCapabilities.some((pattern) =>
      pattern.test(capability.toLocaleLowerCase()),
    ),
  );
}

function facilitySupportsIncident(
  facility: EmergencyState["facilities"][number],
  incident: EmergencyState["incident"],
): boolean {
  const requiredCapabilities =
    facilityCapabilitiesByIncident[incident.type]?.[facility.type];
  return requiredCapabilities !== undefined &&
    facility.capabilities.some((capability) =>
      requiredCapabilities.some((pattern) =>
        pattern.test(capability.toLocaleLowerCase()),
      ),
    );
}

export function createDeterministicAssessments(state: EmergencyState): {
  riskAssessment: RiskAssessment;
  resourceRoutingAssessment: ResourceRoutingAssessment;
} {
  const parsed = EmergencyStateSchema.safeParse(state);
  const consistency = parsed.success
    ? validateEmergencyStateConsistency(parsed.data)
    : null;
  if (!parsed.success || consistency === null || !consistency.valid) {
    throw new DeterministicFallbackError();
  }
  const facts = parsed.data;
  const riskAssessment = RiskAssessmentSchema.parse({
    severity: facts.incident.severity,
    urgency:
      facts.incident.severity === "CRITICAL"
        ? "IMMEDIATE"
        : facts.incident.severity === "HIGH"
          ? "HIGH"
          : facts.incident.severity === "MODERATE"
            ? "MODERATE"
            : "LOW",
    priority:
      facts.incident.priority === "URGENT"
        ? 5
        : facts.incident.priority === "HIGH"
          ? 4
          : facts.incident.priority === "NORMAL"
            ? 3
            : 1,
    affectedPopulation: facts.incident.affectedPopulation,
    hazardFactors: facts.incident.hazards.slice(0, 8),
    riskFactors: [
      `Recorded incident severity: ${facts.incident.severity}.`,
      `Recorded affected population: ${facts.incident.affectedPopulation}.`,
    ],
    keyConcerns: facts.incident.hazards.slice(0, 6),
    reasoning:
      "Deterministic assessment uses only severity, priority, affected population, and hazards recorded in EmergencyState.",
    confidence: 1,
  });
  const resourceRoutingAssessment = ResourceRoutingAssessmentSchema.parse({
    resources: facts.resources.map((resource) => ({
      resourceId: resource.id,
      status: resource.status,
      availability:
        isResourceAvailable(resource) &&
        canAssignResource(facts.resources, resource.id, "AUTO-FALLBACK-CHECK").valid
          ? "AVAILABLE"
          : resource.currentAssignmentId !== null ||
              resource.status === "ASSIGNED" ||
              resource.status === "DISPATCHED"
            ? "ASSIGNED"
            : "UNAVAILABLE",
      capacity: resource.capacity,
      capabilityMatch: [],
      notes: ["Status and capacity copied from EmergencyState."],
    })),
    facilities: facts.facilities.map((facility) => ({
      facilityId: facility.id,
      status: facility.status,
      totalCapacity: facility.totalCapacity,
      availableCapacity: facility.availableCapacity,
      capacityStatus:
        facility.status === "FULL"
          ? "FULL"
          : !validateFacilityStatus(facility).valid ||
              !isFacilityAvailable(facility)
            ? "UNAVAILABLE"
            : validateFacilityCapacityAllocation([facility], facility.id, 1)
                  .valid
              ? facility.status === "LIMITED"
                ? "LIMITED"
                : "AVAILABLE"
              : "FULL",
      notes: ["Status and capacity copied from EmergencyState."],
    })),
    routes: facts.routes.map((route) => {
      const validation = validateRouteUse(route);
      return {
        routeId: route.id,
        status: route.status,
        distanceKm: route.distanceKm,
        estimatedTravelMinutes: route.estimatedTravelMinutes,
        usability:
          validation.warnings.some(
            (issue) => issue.code === "ROUTE_PARTIALLY_BLOCKED",
          )
            ? "PARTIALLY_BLOCKED"
            : route.status === "BLOCKED"
              ? "BLOCKED"
              : route.status === "CLOSED"
                ? "CLOSED"
                : "USABLE",
        notes: ["Status and route metrics copied from EmergencyState."],
      };
    }),
    constraints: [],
    reasoning:
      "Deterministic assessment copies current resource, facility, and route facts from EmergencyState.",
  });
  return { riskAssessment, resourceRoutingAssessment };
}

export function createDeterministicFallbackPlan(
  state: EmergencyState,
  planId: string,
  assessment: {
    riskAssessment: RiskAssessment;
    resourceRoutingAssessment: ResourceRoutingAssessment;
  },
  metadata: {
    modelsAttempted: readonly GeminiModel[];
    failureCategory: GeminiFailureCategory | null;
  },
): ResponsePlanningResult {
  const parsed = EmergencyStateSchema.safeParse(state);
  const consistency = parsed.success
    ? validateEmergencyStateConsistency(parsed.data)
    : null;
  if (!parsed.success || consistency === null || !consistency.valid) {
    throw new DeterministicFallbackError();
  }
  const facts = parsed.data;
  const dispatchCandidates = facts.resources
    .filter(
      (resource) =>
        isResourceAvailable(resource) &&
        canAssignResource(facts.resources, resource.id, `${planId}-ACTION-001`).valid &&
        resourceSupportsIncident(resource, facts.incident),
    )
    .flatMap((resource) =>
      facts.routes
        .filter(
          (route) =>
            validateRouteUse(route).valid &&
            isRouteAvailable(route) &&
            isRouteFullyOpen(route) &&
            sameLocation(route.origin, resource.location) &&
            sameLocation(route.destination, facts.incident.location),
        )
        .map((route) => ({ type: "DISPATCH_RESOURCE" as const, resource, route })),
    )
    .map((candidate) => ({ ...candidate, facility: null }));
  const facilityCandidates = facts.facilities
    .filter(
      (facility) =>
        facilitySupportsIncident(facility, facts.incident) &&
        validateFacilityStatus(facility).valid &&
        isFacilityAvailable(facility) &&
        validateFacilityCapacityAllocation([facility], facility.id, 1).valid,
    )
    .flatMap((facility) =>
      facts.routes
        .filter(
          (route) =>
            validateRouteUse(route).valid &&
            isRouteAvailable(route) &&
            isRouteFullyOpen(route) &&
            sameLocation(route.origin, facts.incident.location) &&
            sameLocation(route.destination, facility.location),
        )
        .map((route) => ({
          type: "NOTIFY_FACILITY" as const,
          resource: null,
          facility,
          route,
        })),
    );
  const candidates = [...dispatchCandidates, ...facilityCandidates].sort(
    (left, right) =>
      (left.type === "DISPATCH_RESOURCE" ? 0 : 1) -
        (right.type === "DISPATCH_RESOURCE" ? 0 : 1) ||
      left.route.estimatedTravelMinutes -
        right.route.estimatedTravelMinutes ||
      (left.resource?.id ?? left.facility?.id ?? "").localeCompare(
        right.resource?.id ?? right.facility?.id ?? "",
      ) ||
      left.route.id.localeCompare(right.route.id),
  );

  const timestamp = facts.updatedAt;
  let selectedResult:
    | { action: PlanAction; plan: ResponsePlan; validation: PlanValidationResult }
    | undefined;
  let lastValidation: PlanValidationResult | undefined;
  for (const [index, candidate] of candidates.entries()) {
    const actionId = `${planId}-ACTION-${String(index + 1).padStart(3, "0")}`;
    const action: PlanAction = {
      id: actionId,
      planId,
      sequence: 1,
      type: candidate.type,
      status: "PENDING",
      description:
        candidate.type === "DISPATCH_RESOURCE" && candidate.resource !== null
          ? `Dispatch ${candidate.resource.name} to the incident using ${candidate.route.name}.`
          : candidate.facility !== null
            ? `Notify ${candidate.facility.name} using the verified route ${candidate.route.name}.`
            : "No compatible emergency action could be established.",
      priority: "URGENT",
      resourceIds: candidate.resource === null ? [] : [candidate.resource.id],
      facilityIds: candidate.facility === null ? [] : [candidate.facility.id],
      routeIds: [candidate.route.id],
      targetLocation:
        candidate.facility === null
          ? {
              latitude: facts.incident.location.latitude,
              longitude: facts.incident.location.longitude,
            }
          : {
              latitude: candidate.facility.location.latitude,
              longitude: candidate.facility.location.longitude,
            },
      estimatedDurationMinutes: candidate.route.estimatedTravelMinutes,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const plan: ResponsePlan = {
      id: planId,
      incidentId: facts.incident.id,
      stateVersion: facts.stateVersion,
      status: "DRAFT",
      priority: "URGENT",
      summary:
        candidate.type === "DISPATCH_RESOURCE"
          ? "Dispatch a compatible available resource via a verified open route."
          : "Notify a compatible facility using a verified open route and available capacity.",
      rationale:
        "Generated only from incident compatibility, current availability, exact route endpoints, and recorded facility capacity.",
      source: "DETERMINISTIC_FALLBACK",
      generatedAt: timestamp,
      updatedAt: timestamp,
      actions: [{ actionId: action.id, sequence: action.sequence }],
      alternatives: [],
      dependencies: {
        resourceIds: candidate.resource === null ? [] : [candidate.resource.id],
        facilityIds: candidate.facility === null ? [] : [candidate.facility.id],
        routeIds: [candidate.route.id],
      },
    };
    const validation = validatePlan(plan, {
      ...facts,
      planActions: [...facts.planActions, action],
    });
    if (validation.valid) {
      selectedResult = { action, plan, validation };
      break;
    }
    lastValidation = validation;
  }
  if (selectedResult === undefined) {
    throw new DeterministicFallbackError(lastValidation);
  }
  const { action, plan, validation } = selectedResult;
  const generation: ResponsePlanningGenerationMetadata = {
    aiAttempted: true,
    modelsAttempted: metadata.modelsAttempted,
    selectedModel: null,
    failureCategory: metadata.failureCategory,
    fallbackActivated: true,
    fallbackValidation: validation,
  };
  const result = {
    plan,
    actions: [action],
    alternatives: [],
    constraints: [
      "No capacity was allocated; selected actions require current availability and exact verified route endpoints.",
    ],
    reasoning:
      "Deterministic fallback is based only on incident-compatible resources or facilities, current availability/capacity, exact route endpoints, and current state facts.",
    confidence: 1,
    validation,
    generation,
  };
  const validated = ResponsePlanningResultSchema.safeParse(result);
  if (!validated.success) throw new DeterministicFallbackError();
  return validated.data;
}
