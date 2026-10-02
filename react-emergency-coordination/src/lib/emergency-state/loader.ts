import {
  EmergencyStateSchema,
  type EmergencyState,
} from "../../domain/emergency-state/schema";
import {
  getActiveResponsePlanForIncident,
  getIncidentById,
  listFacilities,
  listResources,
  listRoutes,
} from "../supabase/services";
import { initializeEmergencyStateVersion } from "../supabase/services/emergency-states";

export async function loadEmergencyState(
  incidentId: string,
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

  const [stateVersion, resources, facilities, routes, activePlanRecord] =
    await Promise.all([
      initializeEmergencyStateVersion(incidentId),
      listResources(),
      listFacilities(),
      listRoutes(),
      getActiveResponsePlanForIncident(incidentId),
    ]);

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

    throw new Error(
      `Cannot load EmergencyState for incident ${incident.id}: the persisted response plan does not include domain fields required by ResponsePlanSchema.`,
    );
  }

  const persistedTimestamps = [
    incident.updatedAt,
    ...resources.map((resource) => resource.updatedAt),
    ...facilities.map((facility) => facility.updatedAt),
    ...routes.map((route) => route.updatedAt),
  ];
  const latestUpdatedAt = persistedTimestamps.reduce((latest, timestamp) =>
    Date.parse(timestamp) > Date.parse(latest) ? timestamp : latest,
  );

  return EmergencyStateSchema.parse({
    incident,
    resources,
    facilities,
    routes,
    activePlan: null,
    stateVersion,
    updatedAt: new Date(latestUpdatedAt).toISOString(),
  });
}
