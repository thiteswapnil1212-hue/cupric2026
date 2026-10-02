import { EmergencyStateSchema, type EmergencyState } from "../../domain/emergency-state/schema";
import type { PlanAction } from "../../domain/plan-action/schema";
import type { ResponsePlan } from "../../domain/response-plan/schema";
import type { Facility } from "../../domain/facility/schema";
import type { Incident } from "../../domain/incident/schema";
import type { Resource } from "../../domain/resource/schema";
import type { Route } from "../../domain/route/schema";
import { validateEmergencyStateConsistency } from "./consistency";

export type LoadEmergencyStateOptions = {
  initializeMissingVersion?: boolean;
};

export type EmergencyStateLoadErrorCode =
  | "INVALID_INCIDENT_ID"
  | "INCIDENT_NOT_FOUND"
  | "STATE_NOT_FOUND"
  | "STATE_VERSION_CONFLICT"
  | "INVALID_PERSISTED_STATE"
  | "DATABASE_UNAVAILABLE"
  | "DATABASE_ERROR";

export class EmergencyStateLoadError extends Error {
  constructor(
    readonly code: EmergencyStateLoadErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "EmergencyStateLoadError";
  }
}

export type EmergencyStateLoaderDependencies = {
  readonly getIncident: (incidentId: string) => Promise<Incident | null>;
  readonly getVersion: (incidentId: string) => Promise<number | null>;
  readonly initializeVersion: (incidentId: string) => Promise<number>;
  readonly listResources: () => Promise<Resource[]>;
  readonly listFacilities: () => Promise<Facility[]>;
  readonly listRoutes: () => Promise<Route[]>;
  readonly getActivePlan: (incidentId: string) => Promise<ResponsePlan | null>;
  readonly listPlanActions: (planId: string) => Promise<PlanAction[]>;
};

async function defaultDependencies(): Promise<EmergencyStateLoaderDependencies> {
  const [services, plans, versions] = await Promise.all([
    import("../supabase/services"),
    import("../supabase/services/response-plans"),
    import("../supabase/services/emergency-states"),
  ]);
  return {
    getIncident: services.getIncidentById,
    getVersion: versions.getEmergencyStateVersion,
    initializeVersion: versions.initializeEmergencyStateVersion,
    listResources: services.listResources,
    listFacilities: services.listFacilities,
    listRoutes: services.listRoutes,
    getActivePlan: plans.getCompleteActiveResponsePlanForIncident,
    listPlanActions: services.listPlanActionsForPlan,
  };
}

function mapLoadError(
  error: unknown,
  usesDefaultSupabase: boolean,
): EmergencyStateLoadError {
  if (error instanceof EmergencyStateLoadError) return error;
  if (
    (usesDefaultSupabase &&
      (!process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
        !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim())) ||
    (error instanceof TypeError && /fetch|network/i.test(error.message))
  ) {
    return new EmergencyStateLoadError(
      "DATABASE_UNAVAILABLE",
      "Supabase configuration is unavailable.",
      { cause: error },
    );
  }
  return new EmergencyStateLoadError(
    "DATABASE_ERROR",
    "Supabase failed to load a complete EmergencyState.",
    { cause: error },
  );
}

export async function loadEmergencyState(
  incidentId: string,
  options: LoadEmergencyStateOptions = {},
  injectedDependencies?: EmergencyStateLoaderDependencies,
): Promise<EmergencyState> {
  if (typeof incidentId !== "string" || incidentId.trim().length === 0) {
    throw new EmergencyStateLoadError(
      "INVALID_INCIDENT_ID",
      "incidentId must be a non-empty string.",
    );
  }

  try {
    const deps = injectedDependencies ?? await defaultDependencies();
    const incident = await deps.getIncident(incidentId);
    if (incident === null) {
      throw new EmergencyStateLoadError(
        "INCIDENT_NOT_FOUND",
        `Incident not found: ${incidentId}`,
      );
    }
    if (incident.id !== incidentId) {
      throw new EmergencyStateLoadError(
        "INVALID_PERSISTED_STATE",
        `Loaded incident does not match requested id: ${incidentId}`,
      );
    }

    let stateVersion = await deps.getVersion(incidentId);
    if (stateVersion === null && options.initializeMissingVersion === true) {
      stateVersion = await deps.initializeVersion(incidentId);
    }
    if (stateVersion === null) {
      throw new EmergencyStateLoadError(
        "STATE_NOT_FOUND",
        `Emergency state version is not initialized for incident ${incidentId}.`,
      );
    }

    const [resources, facilities, routes, activePlan] = await Promise.all([
      deps.listResources(),
      deps.listFacilities(),
      deps.listRoutes(),
      deps.getActivePlan(incidentId),
    ]);
    const planActions =
      activePlan === null ? [] : await deps.listPlanActions(activePlan.id);

    if (activePlan !== null) {
      if (activePlan.incidentId !== incident.id) {
        throw new EmergencyStateLoadError(
          "INVALID_PERSISTED_STATE",
          `Active response plan ${activePlan.id} does not belong to incident ${incident.id}.`,
        );
      }
      if (activePlan.stateVersion > stateVersion) {
        throw new EmergencyStateLoadError(
          "INVALID_PERSISTED_STATE",
          `Active response plan ${activePlan.id} is newer than the persisted emergency state version.`,
        );
      }

      for (const reference of activePlan.actions) {
        const action = planActions.find((candidate) => candidate.id === reference.actionId);
        if (
          action === undefined ||
          action.planId !== activePlan.id ||
          action.sequence !== reference.sequence
        ) {
          throw new EmergencyStateLoadError(
            "INVALID_PERSISTED_STATE",
            `Active response plan ${activePlan.id} references an absent or mismatched PlanAction ${reference.actionId}.`,
          );
        }
      }
      if (planActions.length !== activePlan.actions.length) {
        throw new EmergencyStateLoadError(
          "INVALID_PERSISTED_STATE",
          `Active response plan ${activePlan.id} has unreferenced persisted PlanAction records.`,
        );
      }
    }

    const latestUpdatedAt = [
      incident.updatedAt,
      ...(activePlan === null ? [] : [activePlan.updatedAt]),
      ...resources.map((resource) => resource.updatedAt),
      ...facilities.map((facility) => facility.updatedAt),
      ...routes.map((route) => route.updatedAt),
      ...planActions.map((action) => action.updatedAt),
    ].reduce((latest, timestamp) =>
      Date.parse(timestamp) > Date.parse(latest) ? timestamp : latest,
    );

    const finalStateVersion = await deps.getVersion(incidentId);
    if (finalStateVersion === null) {
      throw new EmergencyStateLoadError(
        "STATE_NOT_FOUND",
        `Emergency state version disappeared for incident ${incidentId}.`,
      );
    }
    if (finalStateVersion !== stateVersion) {
      throw new EmergencyStateLoadError(
        "STATE_VERSION_CONFLICT",
        `Emergency state changed while loading incident ${incidentId}; reload and retry.`,
      );
    }

    const parsed = EmergencyStateSchema.safeParse({
      incident,
      resources,
      facilities,
      routes,
      planActions,
      activePlan,
      stateVersion,
      updatedAt: new Date(latestUpdatedAt).toISOString(),
    });
    if (!parsed.success) {
      throw new EmergencyStateLoadError(
        "INVALID_PERSISTED_STATE",
        "Persisted records do not form a valid EmergencyState.",
        { cause: parsed.error },
      );
    }
    const consistency = validateEmergencyStateConsistency(parsed.data);
    if (!consistency.valid) {
      throw new EmergencyStateLoadError(
        "INVALID_PERSISTED_STATE",
        "Persisted records fail EmergencyState consistency validation.",
      );
    }
    return parsed.data;
  } catch (error) {
    throw mapLoadError(error, injectedDependencies === undefined);
  }
}
