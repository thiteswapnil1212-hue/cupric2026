import {
  EmergencyStateSchema,
  type EmergencyState,
} from "../../domain/emergency-state/schema";
import {
  getIncidentById,
  listFacilities,
  listPlanActionsForPlan,
  listResources,
  listRoutes,
} from "../supabase/services";
import { getCompleteActiveResponsePlanForIncident } from "../supabase/services/response-plans";
import {
  getEmergencyStateVersion,
  initializeEmergencyStateVersion,
} from "../supabase/services/emergency-states";

export type LoadEmergencyStateOptions = {
  initializeMissingVersion?: boolean;
};

export async function loadEmergencyState(
  incidentId: string,
  options: LoadEmergencyStateOptions = {},
): Promise<EmergencyState> {
  if (typeof incidentId !== "string" || incidentId.trim().length === 0) {
    throw new TypeError("incidentId must be a non-empty string.");
  }

  const incident = await getIncidentById(incidentId);
  if (incident === null) {
    throw new Error(`Incident not found: ${incidentId}`);
  }
  if (incident.id !== incidentId) {
    throw new Error(`Loaded incident does not match requested id: ${incidentId}`);
  }

  const stateVersionPromise =
    options.initializeMissingVersion === false
      ? getEmergencyStateVersion(incidentId).then((stateVersion) => {
          if (stateVersion === null) {
            throw new Error(
              `Emergency state version is not initialized for incident ${incidentId}.`,
            );
          }
          return stateVersion;
        })
      : initializeEmergencyStateVersion(incidentId);

  const [stateVersion, resources, facilities, routes, activePlanRecord] =
    await Promise.all([
      stateVersionPromise,
      listResources(),
      listFacilities(),
      listRoutes(),
      getCompleteActiveResponsePlanForIncident(incidentId),
    ]);

  const planActions =
    activePlanRecord === null
      ? []
      : await listPlanActionsForPlan(activePlanRecord.id);

  if (activePlanRecord !== null) {
    if (activePlanRecord.incidentId !== incident.id) {
      throw new Error(
        `Active response plan ${activePlanRecord.id} does not belong to incident ${incident.id}.`,
      );
    }
    if (activePlanRecord.stateVersion > stateVersion) {
      throw new Error(
        `Active response plan ${activePlanRecord.id} is newer than the persisted emergency state version.`,
      );
    }

    for (const actionReference of activePlanRecord.actions) {
      const action = planActions.find(
        (planAction) => planAction.id === actionReference.actionId,
      );
      if (action === undefined) {
        throw new Error(
          `Active response plan ${activePlanRecord.id} references missing PlanAction ${actionReference.actionId}.`,
        );
      }
      if (
        action.planId !== activePlanRecord.id ||
        action.sequence !== actionReference.sequence
      ) {
        throw new Error(
          `PlanAction ${action.id} does not match its reference in active response plan ${activePlanRecord.id}.`,
        );
      }
    }

    if (planActions.length !== activePlanRecord.actions.length) {
      throw new Error(
        `Active response plan ${activePlanRecord.id} has PlanAction records without matching ordered references.`,
      );
    }
  }

  const persistedTimestamps = [
    incident.updatedAt,
    ...(activePlanRecord === null ? [] : [activePlanRecord.updatedAt]),
    ...resources.map((resource) => resource.updatedAt),
    ...facilities.map((facility) => facility.updatedAt),
    ...routes.map((route) => route.updatedAt),
    ...planActions.map((action) => action.updatedAt),
  ];
  const latestUpdatedAt = persistedTimestamps.reduce((latest, timestamp) =>
    Date.parse(timestamp) > Date.parse(latest) ? timestamp : latest,
  );

  return EmergencyStateSchema.parse({
    incident,
    resources,
    facilities,
    routes,
    planActions,
    activePlan: activePlanRecord,
    stateVersion,
    updatedAt: new Date(latestUpdatedAt).toISOString(),
  });
}
