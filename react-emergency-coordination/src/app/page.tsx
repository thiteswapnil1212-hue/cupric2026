"use client";

import { useMemo, useState } from "react";
import {
  Activity, AlertTriangle, Bell, Check, ChevronRight, CircleDot, Clock3,
  Crosshair, Hospital, MapPin, Menu, MoreHorizontal, Route,
  Users, X,
} from "lucide-react";
import { getDemoState, type DemoScenario } from "../components/react/data/demo-state";
import {
  createDashboardViewModel,
  type DashboardAgent,
  type DashboardFacility,
  type DashboardResource,
  type DashboardRoute,
  type DashboardTimelineItem,
  type DashboardViewModel,
  type StatusTone,
} from "../components/react/data/view-model";
import type { ResponsePlan } from "../domain/response-plan/schema";

function StatusDot({ tone = "green" }: { tone?: StatusTone }) {
  return <span className={`status-dot status-${tone}`} aria-hidden="true" />;
}

function PanelHeading({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: string }) {
  return <div className="panel-heading"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h2>{title}</h2></div>{action && <button className="text-button">{action}<ChevronRight size={14} /></button>}</div>;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}

function apiMetadata(incidentId: string, reason: string) {
  const now = new Date().toISOString();
  return { id: `DECISION-${Date.now()}`, incidentId, coordinatorId: "COORD-DEMO", reason, decidedAt: now, recordedAt: now };
}

async function sendApproval(plan: ResponsePlan, action: "approve" | "reject" | "modify", reason: string): Promise<{ success: boolean; message: string; plan?: ResponsePlan }> {
  const body = action === "modify" ? { ...apiMetadata(plan.incidentId, reason), modifiedPlan: plan } : apiMetadata(plan.incidentId, reason);
  const response = await fetch(`/api/emergency/plans/${encodeURIComponent(plan.id)}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: action === "approve" ? JSON.stringify(body) : JSON.stringify(body),
  });
  const payload: unknown = await response.json();
  if (!isApiResponse(payload)) return { success: false, message: "The approval service returned an invalid response." };
  if (payload.success === false) return { success: false, message: `${payload.error.code}: ${payload.error.message}` };
  if (!response.ok) return { success: false, message: "The approval service rejected the request." };
  return { success: true, message: `${action.toUpperCase()} recorded for ${payload.data.plan.id}.`, plan: payload.data.plan };
}

async function refreshApprovalStatus(planId: string): Promise<{ success: boolean; message: string; plan?: ResponsePlan }> {
  const response = await fetch(`/api/emergency/plans/${encodeURIComponent(planId)}/approval-status`);
  const payload: unknown = await response.json();
  if (!isApiResponse(payload)) return { success: false, message: "The approval status service returned an invalid response." };
  if (payload.success === false) return { success: false, message: `${payload.error.code}: ${payload.error.message}` };
  if (!response.ok) return { success: false, message: "The approval status service rejected the request." };
  return { success: true, message: "Approval status refreshed.", plan: payload.data.plan };
}

type ApiResponse =
  | { success: true; data: { plan: ResponsePlan } }
  | { success: false; error: { code: string; message: string } };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isApiResponse(value: unknown): value is ApiResponse {
  if (!isRecord(value) || typeof value.success !== "boolean") return false;
  if (value.success === false) {
    return isRecord(value.error) && typeof value.error.code === "string" && typeof value.error.message === "string";
  }
  return isRecord(value.data) && ResponsePlanGuard(value.data.plan);
}

function ResponsePlanGuard(value: unknown): value is ResponsePlan {
  return isRecord(value) && typeof value.id === "string" && typeof value.incidentId === "string" && typeof value.status === "string";
}

function resourceRows(resources: DashboardResource[]) {
  return resources.map((resource) => <div className="table-row" key={resource.id}><span className="resource-name">{resource.name}</span><span>{resource.typeLabel}</span><span><span className={`status-badge badge-${resource.tone}`}><StatusDot tone={resource.tone} />{resource.statusLabel}</span></span><span>{resource.assignment}</span><span>{resource.location}</span></div>);
}

function facilityRows(facilities: DashboardFacility[]) {
  return facilities.map((facility) => <div className="facility-row" key={facility.id}><div className="facility-icon"><Hospital size={17} /></div><div className="facility-info"><strong>{facility.name}</strong><span>{facility.availableCapacity} / {facility.totalCapacity} beds available</span></div><span className={`status-badge badge-${facility.tone}`}><StatusDot tone={facility.tone} />{facility.statusLabel}</span></div>);
}

function agentRows(agents: DashboardAgent[]) {
  return agents.map((agent) => <div className="agent-row" key={agent.id}><div className="agent-check">{agent.status === "COMPLETED" ? <Check size={13} /> : <Activity size={13} />}</div><div><strong>{agent.label}</strong><span>{agent.statusLabel} · {agent.timeLabel}</span></div><span className={`agent-state ${agent.tone === "amber" ? "state-review" : ""}`}>{agent.statusLabel}</span></div>);
}

function timelineRows(items: DashboardTimelineItem[]) {
  return items.map((item) => <div className="timeline-item" key={item.id}><time>{item.timeLabel}</time><span className={`timeline-marker marker-${item.tone}`} /><div><strong>{item.title}</strong><span>{item.detail}</span></div></div>);
}

function mapRouteClass(route: DashboardRoute): string {
  return route.status === "OPEN" ? "route-active" : "route-blocked";
}

function Dashboard({ model, scenario, onScenarioChange }: { model: DashboardViewModel; scenario: DemoScenario; onScenarioChange: (scenario: DemoScenario) => void }) {
  const [decisionState, setDecisionState] = useState<{ loading: boolean; message: string; error: boolean }>({ loading: false, message: "", error: false });
  const [rejectReason, setRejectReason] = useState("");
  const [planOverride, setPlanOverride] = useState<{ sourceId: string; plan: ResponsePlan } | null>(null);
  const plan = planOverride !== null && planOverride.sourceId === model.activePlan?.id ? planOverride.plan : model.activePlan;
  const routeCount = model.routes.filter((route) => route.status !== "OPEN").length;
  const activeResources = model.resources.filter((resource) => resource.status !== "UNAVAILABLE" && resource.status !== "OUT_OF_SERVICE").length;
  const availableFacilities = model.facilities.filter((facility) => facility.status === "OPERATIONAL" || facility.status === "LIMITED").length;

  async function handleDecision(action: "approve" | "reject" | "modify") {
    if (plan === null || decisionState.loading) return;
    if (action === "reject" && rejectReason.trim() === "") {
      setDecisionState({ loading: false, message: "REJECTION_REASON_REQUIRED: Enter a reason before rejecting the plan.", error: true });
      return;
    }
    setDecisionState({ loading: true, message: "", error: false });
    try {
      const result = await sendApproval(plan, action, rejectReason.trim() || "Coordinator requested a plan modification.");
      if (result.success && result.plan !== undefined) {
        setPlanOverride({ sourceId: plan.id, plan: result.plan });
        const status = await refreshApprovalStatus(result.plan.id);
        setDecisionState({ loading: false, message: status.success ? `${result.message} ${status.message}` : `${result.message} Status refresh failed: ${status.message}`, error: !status.success });
      } else {
        setDecisionState({ loading: false, message: result.message, error: true });
      }
      if (result.success) setRejectReason("");
    } catch (error) {
      setDecisionState({ loading: false, message: error instanceof Error ? error.message : "Approval request failed.", error: true });
    }
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Crosshair size={18} /></div><div><span className="brand-name">REACT</span><span className="brand-caption">Emergency coordination</span></div></div>
      <div className="nav-section-label">Operations</div>
      <nav className="primary-nav" aria-label="Primary navigation">
        <a className="nav-item nav-active" href="#overview"><Activity size={16} />Overview</a><a className="nav-item" href="#map"><MapPin size={16} />Live map</a><a className="nav-item" href="#resources"><Users size={16} />Resources</a><a className="nav-item" href="#facilities"><Hospital size={16} />Facilities</a><a className="nav-item" href="#plans"><Route size={16} />Response plans</a>
      </nav>
      <div className="nav-section-label nav-section-lower">System</div>
      <nav className="primary-nav"><a className="nav-item" href="#timeline"><Clock3 size={16} />Situation timeline</a><a className="nav-item" href="#activity"><Bell size={16} />Activity log <span className="nav-count">{model.timeline.length}</span></a></nav>
      <div className="sidebar-footer"><div className="system-health"><StatusDot /><span>All systems operational</span></div><span className="build-label">Environment · Deterministic demo</span></div>
    </aside>
    <div className="main-column">
      <header className="topbar"><div className="mobile-menu"><Menu size={18} /></div><div className="incident-context"><span className="context-label">CURRENT INCIDENT</span><strong>{model.incident.title}</strong><span className="incident-id">{model.incident.id}</span></div><div className="topbar-meta"><div className="topbar-state"><StatusDot /><span>System status</span><strong>Operational</strong></div><div className="topbar-divider" /><div className="topbar-updated">Last updated <strong>{formatTime(model.updatedAt)}</strong></div><button className="icon-button" aria-label="Notifications"><Bell size={17} /></button><button className="user-control"><span className="avatar">JM</span><span className="user-name">Jordan Miller</span><ChevronRight size={14} /></button></div></header>
      <main className="dashboard" id="overview">
        <div className="page-header"><div><p className="eyebrow">OPERATIONS OVERVIEW</p><h1>Emergency coordination</h1></div><div className="header-actions"><span className="live-indicator"><StatusDot />Live monitoring</span><div className="demo-switch"><button className={scenario === "initial" ? "demo-active" : ""} onClick={() => onScenarioChange("initial")}>Initial state</button><button className={scenario === "replanned" ? "demo-active" : ""} onClick={() => onScenarioChange("replanned")}>Simulate R1 blockage</button></div><button className="outline-button"><MoreHorizontal size={15} />More actions</button></div></div>
        <section className="summary-strip" aria-label="Emergency summary"><div className="summary-cell summary-incident"><span className="summary-label">Incident</span><strong>{model.incident.title}</strong><small>{model.incident.location.address}</small></div><div className="summary-cell"><span className="summary-label">Status</span><strong className="value-critical"><StatusDot tone="red" />{model.incident.status} emergency</strong></div><div className="summary-cell"><span className="summary-label">Severity</span><strong className="value-critical">{model.incident.severity}</strong><small>Immediate response</small></div><div className="summary-cell"><span className="summary-label">Affected</span><strong>{model.incident.affectedPopulation} people</strong><small>Current incident estimate</small></div><div className="summary-cell"><span className="summary-label">State version</span><strong>v{model.stateVersion}</strong><small>Updated {formatTime(model.updatedAt)}</small></div></section>
        {model.reassessment.required && <div className="reassessment-alert"><div className="alert-icon"><AlertTriangle size={17} /></div><div className="alert-copy"><strong>Plan reassessment required</strong><span>{model.reassessment.routeId} is blocked and affects the active response plan.</span></div><div className="alert-detail"><span>Affected dependency</span><strong>{model.reassessment.routeId}</strong></div><div className="alert-detail"><span>Revised plan</span><strong>{model.reassessment.revisedPlanId}</strong></div><button className="alert-dismiss" aria-label="Dismiss alert"><X size={16} /></button></div>}
        <div className="primary-grid">
          <section className="panel map-panel" id="map"><PanelHeading eyebrow="SITUATIONAL AWARENESS" title="Live operational map" action="Expand map" /><div className="map-canvas"><div className="map-grid-lines" /><div className="map-road road-a" /><div className="map-road road-b" /><div className="map-road road-c" />{model.routes.map((route, index) => <div className={`map-route ${mapRouteClass(route)} map-route-${index}`} key={route.id}><span>{route.id}{route.status !== "OPEN" ? ` · ${route.status}` : ""}</span></div>)}<div className="map-marker marker-incident"><AlertTriangle size={12} /><span>Incident</span></div>{model.resources.slice(0, 2).map((resource, index) => <div className={`map-marker marker-resource-${index}`} key={resource.id}><Users size={12} /><span>{resource.name}</span></div>)}{model.facilities.map((facility, index) => <div className={`map-marker marker-facility-${index}`} key={facility.id}><Hospital size={12} /><span>{facility.name}</span></div>)}<div className="map-legend"><span><i className="legend-line active-line" />Open route</span><span><i className="legend-line blocked-line" />Blocked route</span></div><div className="map-scale">500 m</div></div><div className="map-footer"><span><StatusDot tone="red" />{routeCount} blocked routes</span><span><StatusDot />{activeResources} resources active</span><span><StatusDot tone="blue" />{availableFacilities} facilities available</span><button className="text-button">View map details <ChevronRight size={14} /></button></div></section>
          <section className="panel plan-panel" id="plans"><PanelHeading eyebrow="ACTIVE RESPONSE PLAN" title={plan?.id ?? "No active plan"} action="Plan history" />{plan && <><div className="plan-meta"><span>Incident {plan.incidentId}</span><span className="meta-separator">•</span><span>Generated {formatTime(plan.generatedAt)}</span><span className="meta-separator">•</span><span>State version {plan.stateVersion}</span><span className="meta-separator">•</span><span>Routes {plan.dependencies.routeIds.join(", ")}</span><span className="plan-status status-badge badge-approved"><StatusDot tone={plan.status === "PENDING_APPROVAL" ? "amber" : "green"} />{plan.status}</span></div><div className="plan-callout"><div className="callout-icon"><AlertTriangle size={15} /></div><div><strong>{model.reassessment.required ? "Dependency affected" : "AI recommendation ready"}</strong><span>{model.reassessment.required ? `${model.reassessment.routeId} is no longer usable. Review the revised plan.` : plan.summary}</span></div></div><div className="plan-actions">{model.actions.map((action) => <div className="plan-action" key={action.id}><span className="action-index">{action.sequenceLabel}</span><span>{action.description}</span>{action.routeIds.some((routeId: string) => model.routes.find((route) => route.id === routeId)?.status !== "OPEN") ? <span className="action-warning">Blocked</span> : <StatusDot />}</div>)}</div><div className="plan-divider" /><div className="plan-origin"><span className="ai-tag">AI RECOMMENDATION</span><span>{plan.rationale}</span></div><div className="human-decision"><div><span className="eyebrow">HUMAN AUTHORIZATION</span><p>{decisionState.message || "Coordinator action is required before simulated execution."}</p>{plan.status === "PENDING_APPROVAL" && <input className="decision-reason" value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} placeholder="Reason for rejection or modification (optional)" />}</div><div className="decision-buttons"><button className="button-approve" disabled={decisionState.loading || plan.status !== "PENDING_APPROVAL"} onClick={() => void handleDecision("approve")}>{decisionState.loading ? "Sending…" : <><Check size={14} />Approve</>}</button><button className="button-modify" disabled={decisionState.loading || plan.status !== "PENDING_APPROVAL"} onClick={() => void handleDecision("modify")}>Modify</button><button className="button-reject" disabled={decisionState.loading || plan.status !== "PENDING_APPROVAL"} onClick={() => void handleDecision("reject")}>Reject</button></div></div>{decisionState.message && <div className={`decision-feedback ${decisionState.error ? "feedback-error" : "feedback-success"}`}>{decisionState.message}</div>}</>}</section>
        </div>
        <div className="secondary-grid"><section className="panel table-panel" id="resources"><PanelHeading eyebrow="FIELD OPERATIONS" title="Resource status" action="View all resources" /><div className="data-table"><div className="table-row table-head"><span>Resource</span><span>Type</span><span>Status</span><span>Assignment</span><span>Location</span></div>{resourceRows(model.resources)}</div></section><section className="panel facilities-panel" id="facilities"><PanelHeading eyebrow="CARE CAPACITY" title="Facilities" action="View all" /><div className="facility-list">{facilityRows(model.facilities)}</div></section></div>
        <div className="bottom-grid"><section className="panel activity-panel" id="activity"><PanelHeading eyebrow="PROCESSING ACTIVITY" title="Agent activity" /><div className="agent-list">{agentRows(model.agents)}</div><div className="ai-note"><CircleDot size={13} />AI analyzes and recommends. Human coordinators authorize execution.</div></section><section className="panel timeline-panel" id="timeline"><PanelHeading eyebrow="AUDIT TRAIL" title="Situation timeline" action="View full history" /><div className="timeline-list">{timelineRows(model.timeline)}</div></section></div>
      </main>
      <footer className="app-footer"><span>REACT Emergency Coordination · Deterministic demo environment</span><span>State version {model.stateVersion} <span className="footer-divider">|</span> {model.incident.id}</span></footer>
    </div>
  </div>;
}

export default function Home() {
  const [scenario, setScenario] = useState<DemoScenario>("initial");
  const model = useMemo(() => createDashboardViewModel(getDemoState(scenario)), [scenario]);
  return <Dashboard model={model} scenario={scenario} onScenarioChange={setScenario} />;
}
