"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  MapContainer,
  Marker,
  Pane,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import L, { type LatLngTuple } from "leaflet";
import { Crosshair } from "lucide-react";
import type { EmergencyState } from "../../domain/emergency-state/schema";
import type { ResponsePlan } from "../../domain/response-plan/schema";
import type { Resource } from "../../domain/resource/schema";
import type { Facility } from "../../domain/facility/schema";
import type { Route } from "../../domain/route/schema";
import {
  DEMO_ROAD_GEOMETRY,
  routeHasDemoRoadGeometry,
} from "../../lib/demo/road-geometry";
import type { OperationalMapProps } from "./operational-map";

type OverlayKind = "incident" | "rescue" | "hospital";

function statePoints(state: EmergencyState): LatLngTuple[] {
  return [
    [state.incident.location.latitude, state.incident.location.longitude],
    ...state.resources.map(
      (resource) =>
        [resource.location.latitude, resource.location.longitude] as LatLngTuple,
    ),
    ...state.facilities.map(
      (facility) =>
        [facility.location.latitude, facility.location.longitude] as LatLngTuple,
    ),
  ];
}

function fitOperationalMap(
  map: L.Map,
  points: LatLngTuple[] | L.LatLngBounds,
): void {
  const bounds = Array.isArray(points) ? L.latLngBounds(points) : points;
  if (!bounds.isValid()) return;
  map.fitBounds(bounds, {
    paddingTopLeft: [42, 42],
    paddingBottomRight: [42, 54],
    maxZoom: 15,
    animate: false,
  });
}

function MapCamera({
  points,
  fitVersion,
}: {
  points: LatLngTuple[];
  fitVersion: number;
}) {
  const map = useMap();
  const pointKey = points.map(([lat, lng]) => `${lat},${lng}`).join(";");
  const bounds = useRef<L.LatLngBounds | null>(null);

  useEffect(() => {
    bounds.current = L.latLngBounds(points);
  }, [points]);

  useEffect(() => {
    if (bounds.current?.isValid()) fitOperationalMap(map, bounds.current);
  }, [fitVersion, map, pointKey]);

  useEffect(() => {
    const container = map.getContainer();
    let frame = 0;
    const observer = new ResizeObserver(() => {
      map.invalidateSize({ pan: false, debounceMoveend: true });
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (bounds.current?.isValid()) fitOperationalMap(map, bounds.current);
      });
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [map]);

  return null;
}

function RecenterControl({ points }: { points: LatLngTuple[] }) {
  const map = useMap();

  return (
    <div className="leaflet-top leaflet-right operational-map-fit-control">
      <div className="leaflet-control leaflet-bar">
        <button
          type="button"
          aria-label="Fit incident and response area"
          title="Fit incident and response area"
          onClick={() => fitOperationalMap(map, points)}
        >
          <Crosshair size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function overlayIcon(kind: OverlayKind, status = "ACTIVE"): L.DivIcon {
  const label = kind === "incident" ? "!" : kind === "hospital" ? "H" : "R";
  return L.divIcon({
    className: "operational-map-marker-shell",
    html: `<span class="operational-map-marker operational-map-marker-${kind} operational-map-marker-status-${status.toLowerCase()}">${label}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    tooltipAnchor: [0, -12],
  });
}

function entityMarker<T extends Resource | Facility>({
  entity,
  position,
  kind,
  status,
  labelDirection,
  labelOffset,
}: {
  entity: T;
  position: LatLngTuple;
  kind: "rescue" | "hospital";
  status: string;
  labelDirection: "top" | "right" | "left" | "bottom";
  labelOffset: [number, number];
}) {
  return (
    <Marker
      position={position}
      icon={overlayIcon(kind, status)}
      keyboard
      title={`${entity.name} · ${status.replaceAll("_", " ")}`}
    >
      <Tooltip
        permanent
        direction={labelDirection}
        offset={labelOffset}
        className={`operational-map-tooltip operational-map-tooltip-${kind}`}
      >
        <strong>{entity.name}</strong>
        <span>{status.replaceAll("_", " ")}</span>
      </Tooltip>
    </Marker>
  );
}

function RouteLines({
  routes,
  activePlan,
  previousPlan,
  whatIf,
}: {
  routes: readonly Route[];
  activePlan: ResponsePlan | null;
  previousPlan: ResponsePlan | null;
  whatIf: OperationalMapProps["whatIf"];
}) {
  const realRoutes = whatIf?.realState.routes ?? [];
  const realPlan = whatIf?.realPlan ?? null;

  return (
    <>
      {whatIf && (
        <Pane name="realRouteContext" style={{ zIndex: 390 }}>
          {realRoutes.filter(routeHasDemoRoadGeometry).map((route) => (
            <Polyline
              key={`real-${route.id}`}
              positions={DEMO_ROAD_GEOMETRY[route.id]}
              pathOptions={{
                color: route.status === "OPEN" ? "#75877d" : "#a84a45",
                weight: 3,
                opacity: 0.38,
                dashArray: "4 7",
                lineCap: "round",
                lineJoin: "round",
                interactive: false,
              }}
            />
          ))}
        </Pane>
      )}
      <Pane name="operationalRoutes" style={{ zIndex: 410 }}>
        {routes.filter(routeHasDemoRoadGeometry).map((route) => {
          const selected =
            activePlan?.dependencies.routeIds.includes(route.id) ?? false;
          const selectedInRealPlan =
            realPlan?.dependencies.routeIds.includes(route.id) ?? false;
          const selectedAlternative =
            whatIf !== null &&
            whatIf !== undefined &&
            selected &&
            !selectedInRealPlan &&
            route.status === "OPEN";
          const affectedPreviousPlan =
            !whatIf &&
            route.status !== "OPEN" &&
            (previousPlan?.dependencies.routeIds.includes(route.id) ?? false);
          const label = route.status === "BLOCKED" || route.status === "CLOSED"
            ? `${route.id} · BLOCKED`
            : selectedAlternative
              ? `${route.id} · WHAT-IF SELECTED`
              : selected
                ? `${route.id} · ACTIVE`
                : `${route.id} · AVAILABLE`;
          const color = route.status === "BLOCKED" || route.status === "CLOSED"
            ? "#b44343"
            : selectedAlternative
              ? "#3676a6"
              : selected
                ? "#197653"
                : "#5d9275";

          return (
            <Polyline
              key={`${whatIf ? "hypothetical" : "real"}-${route.id}`}
              positions={DEMO_ROAD_GEOMETRY[route.id]}
              pathOptions={{
                color,
                weight: selected || selectedAlternative ? 7 : 4,
                opacity: selected || route.status !== "OPEN" ? 0.95 : 0.76,
                dashArray:
                  route.status === "BLOCKED" || route.status === "CLOSED"
                    ? "8 8"
                    : selectedAlternative
                      ? "12 6"
                      : undefined,
                lineCap: "round",
                lineJoin: "round",
                className: [
                  "operational-route-line",
                  selected ? "operational-route-selected" : "",
                  selectedAlternative ? "operational-route-what-if" : "",
                  affectedPreviousPlan ? "operational-route-affected" : "",
                ]
                  .filter(Boolean)
                  .join(" "),
              }}
            >
              <Tooltip
                permanent
                direction="center"
                offset={[
                  route.id === "R3" ? 86 : 0,
                  route.id === "R1" ? 12 : route.id === "R2" ? -60 : 0,
                ]}
                className={`operational-route-label${selectedAlternative ? " operational-route-label-what-if" : ""}${route.status !== "OPEN" ? " operational-route-label-blocked" : ""}`}
              >
                {label}
              </Tooltip>
            </Polyline>
          );
        })}
      </Pane>
    </>
  );
}

function Legend({ whatIf }: { whatIf: boolean }) {
  return (
    <div className="operational-map-legend" aria-label="Map legend">
      <span><i className="map-legend-dot map-legend-incident" />Incident</span>
      <span><i className="map-legend-dot map-legend-rescue" />Rescue team</span>
      <span><i className="map-legend-dot map-legend-hospital" />Hospital</span>
      <span><i className="map-legend-line map-legend-active" />Active route</span>
      <span><i className="map-legend-line map-legend-available" />Available route</span>
      <span><i className="map-legend-line map-legend-blocked" />Blocked route</span>
      {whatIf && <span><i className="map-legend-line map-legend-hypothetical" />What-If overlay</span>}
    </div>
  );
}

export default function LeafletOperationalMap({
  state,
  activePlan,
  previousPlan,
  reassessing,
  whatIf = null,
}: OperationalMapProps) {
  const points = useMemo(() => statePoints(state), [state]);
  const rescueTeams = state.resources.filter(
    (resource) => resource.type === "RESCUE_TEAM",
  );
  const whatIfActive = whatIf !== null;

  return (
    <div
      className={`operational-map-frame${whatIfActive ? " operational-map-frame-what-if" : ""}${reassessing ? " operational-map-frame-reassessing" : ""}`}
      role="region"
      aria-label={`${whatIfActive ? "What-If simulation map" : "Operational map"} showing a simulated emergency in Pune`}
      data-map-mode={whatIfActive ? "what-if" : "real"}
    >
      <MapContainer
        className="operational-map-leaflet"
        center={[18.519418, 73.856164]}
        zoom={14}
        minZoom={12}
        maxZoom={19}
        scrollWheelZoom
        zoomControl
        preferCanvas
        aria-label="OpenStreetMap geographic base with REACT operational overlays"
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>'
        />
        <MapCamera points={points} fitVersion={whatIfActive ? 1 : 0} />
        <RecenterControl points={points} />
        <RouteLines
          routes={state.routes}
          activePlan={activePlan}
          previousPlan={previousPlan}
          whatIf={whatIf}
        />
        <Pane name="operationalMarkers" style={{ zIndex: 650 }}>
          <Marker
            position={[
              state.incident.location.latitude,
              state.incident.location.longitude,
            ]}
            icon={overlayIcon("incident", state.incident.status)}
            keyboard
            title={`Simulated incident · ${state.incident.title}`}
          >
            <Tooltip
              permanent
              direction="top"
              offset={[0, -5]}
              className="operational-map-tooltip operational-map-tooltip-incident"
            >
              <strong>Simulated incident</strong>
              <span>{state.incident.title}</span>
            </Tooltip>
          </Marker>
          {rescueTeams.map((resource) =>
            entityMarker({
              entity: resource,
              position: [
                resource.location.latitude,
                resource.location.longitude,
              ],
              kind: "rescue",
              status: resource.status,
              labelDirection:
                resource.location.latitude > state.incident.location.latitude
                  ? "right"
                  : "left",
              labelOffset:
                resource.location.latitude > state.incident.location.latitude
                  ? [30, 45]
                  : [0, 0],
            }),
          )}
          {state.facilities.map((facility) =>
            entityMarker({
              entity: facility,
              position: [
                facility.location.latitude,
                facility.location.longitude,
              ],
              kind: "hospital",
              status: facility.status,
              labelDirection:
                facility.location.latitude > state.incident.location.latitude
                  ? "top"
                  : "right",
              labelOffset:
                facility.location.latitude > state.incident.location.latitude
                  ? [100, 10]
                  : [0, 0],
            }),
          )}
        </Pane>
      </MapContainer>
      <span className="operational-map-demo-label">
        {whatIfActive ? "WHAT-IF SIMULATION · NOT EXECUTED" : "DEMO · SIMULATED INCIDENT"}
      </span>
      <Legend whatIf={whatIfActive} />
      {whatIfActive && (
        <p className="operational-map-layer-note">
          Faint dashed lines show the real response; bold lines show this isolated scenario.
        </p>
      )}
    </div>
  );
}
