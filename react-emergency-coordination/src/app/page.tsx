"use client";

import { useMemo, useState } from "react";
import {
  Activity, AlertTriangle, Bell, Check, CircleDot, Clock3, Crosshair,
  Hospital, MapPin, Route, Users, X,
} from "lucide-react";
import {
  createDashboardViewModel,
  responsePlanSourceLabel,
  type DashboardAgent,
  type DashboardFacility,
  type DashboardResource,
  type DashboardRoute,
  type DashboardTimelineItem,
  type DashboardViewModel,
  type StatusTone,
} from "../components/react/data/view-model";
import { createDemoController } from "../lib/demo/controller";
import { autoAiDemoAgents } from "../lib/demo/auto-ai-client";
import type { DemoOperationResult, DemoSnapshot } from "../lib/demo/schema";

function StatusDot({ tone = "green" }: { tone?: StatusTone }) {
  return <span className={`status-dot status-${tone}`} aria-hidden="true" />;
}

function PanelHeading({ eyebrow, title }: { eyebrow?: string; title: string }) {
  return <div className="panel-heading"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h2>{title}</h2></div></div>;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}

function resourceRows(resources: DashboardResource[]) {
  return resources.map((resource) => <div className="table-row" key={resource.id}><span className="resource-name">{resource.name}</span><span>{resource.typeLabel}</span><span><span className={`status-badge badge-${resource.tone}`}><StatusDot tone={resource.tone} />{resource.statusLabel}</span></span><span>{resource.assignment}</span><span>{resource.location}</span></div>);
}

function facilityRows(facilities: DashboardFacility[]) {
  return facilities.map((facility) => <div className="facility-row" key={facility.id}><div className="facility-icon"><Hospital size={17} /></div><div className="facility-info"><strong>{facility.name}</strong><span>{facility.availableCapacity} / {facility.totalCapacity} beds available</span></div><span className={`status-badge badge-${facility.tone}`}><StatusDot tone={facility.tone} />{facility.statusLabel}</span></div>);
}

function agentRows(agents: DashboardAgent[]) {
  return agents.map((agent) => (
    <div className={`agent-row${agent.status === "STANDBY" ? " agent-standby" : ""}`} key={agent.id}>
      <div className="agent-check">
        {agent.status === "COMPLETED" ? <Check size={13} /> : agent.status === "STANDBY" ? <CircleDot size={13} /> : <Activity size={13} />}
      </div>
      <div>
        <strong>{agent.label}</strong>
        <span>{agent.purpose}</span>
        <span>{agent.statusLabel} · {agent.timeLabel} · {agent.durationLabel}</span>
        <span>{agent.resultSummary}</span>
      </div>
      <span className={`agent-state ${agent.tone === "amber" ? "state-review" : ""} ${agent.status === "STANDBY" ? "state-standby" : ""}`}>{agent.statusLabel}</span>
    </div>
  ));
}

function timelineRows(items: DashboardTimelineItem[], idle: boolean) {
  if (items.length === 0 && idle) return <p className="timeline-empty">No situation events yet</p>;
  return items.map((item) => <div className="timeline-item" key={item.id}><time>{item.timeLabel}</time><span className={`timeline-marker marker-${item.tone}`} /><div><strong>{item.title}</strong><span>{item.detail}</span></div></div>);
}

function PlanHistory({ plans }: { plans: DemoSnapshot["planHistory"] }) {
  if (plans.length === 0) return null;
  return <details className="plan-history">
    <summary>Plan history ({plans.length})</summary>
    <ol>{[...plans].reverse().map((historyPlan) => <li key={`${historyPlan.id}-${historyPlan.updatedAt}`}>
      <strong>{historyPlan.id}</strong>
      <span className={`status-badge badge-${historyPlan.status === "COMPLETED" || historyPlan.status === "APPROVED" ? "green" : historyPlan.status === "PENDING_APPROVAL" ? "amber" : historyPlan.status === "REJECTED" ? "red" : "gray"}`}>{historyPlan.status.replaceAll("_", " ")}</span>
      <time>{formatTime(historyPlan.updatedAt)}</time>
    </li>)}</ol>
  </details>;
}

function mapRouteClass(route: DashboardRoute): string {
  return route.status === "OPEN" ? "route-active" : "route-blocked";
}

function ExplainabilityPanel({ model, snapshot }: { model: DashboardViewModel; snapshot: DemoSnapshot }) {
  const idle = snapshot.stage === "IDLE";
  const risk = idle ? null : model.riskAssessment;
  const routing = idle ? null : model.resourceRoutingAssessment;
  const planning = idle ? null : model.responsePlanningResult;
  const validation = idle ? null : model.validation;
  return <section className="panel explainability-panel" id="explainability">
    <PanelHeading eyebrow="DECISION TRACE" title="Agent findings and explainability" />
    <div className="explainability-grid">
      <div className="explainability-column"><span className="eyebrow">RISK ASSESSMENT</span>{risk ? <><div className="fact-row"><span>Severity</span><strong>{risk.severity}</strong></div><div className="fact-row"><span>Priority</span><strong>{risk.priority}</strong></div><div className="fact-row"><span>Affected population</span><strong>{risk.affectedPopulation}</strong></div><div className="fact-block"><span>Key hazards</span><strong>{risk.hazardFactors.join(" · ")}</strong></div><div className="fact-block"><span>Risk factors</span><strong>{risk.riskFactors.join(" · ")}</strong></div></> : <p className="awaiting-data">{idle ? "Awaiting demo start" : "DATA UNAVAILABLE"}</p>}</div>
      <div className="explainability-column"><span className="eyebrow">RESOURCE &amp; ROUTING</span>{routing ? <><div className="fact-block"><span>Resources</span><strong>{model.resources.filter((resource) => resource.status === "AVAILABLE").length} available of {model.resources.length}</strong></div><div className="fact-block"><span>Facilities</span><strong>{routing.facilities.map((facility) => `${facility.facilityId}: ${facility.availableCapacity}/${facility.totalCapacity}`).join(" · ")}</strong></div><div className="fact-block"><span>Routes</span><strong>{routing.routes.map((route) => `${route.routeId} ${route.status}`).join(" · ")}</strong></div>{model.reassessment.required && <div className="fact-block"><span>Affected plan dependency</span><strong>{model.reassessment.routeId}</strong></div>}</> : <p className="awaiting-data">{idle ? "Awaiting demo start" : "DATA UNAVAILABLE"}</p>}</div>
      <div className="explainability-column"><span className="eyebrow">RESPONSE PLANNING</span>{planning ? <><div className="fact-block"><span>Primary plan</span><strong>{planning.plan.id}</strong></div><div className="fact-block"><span>Priority actions</span><strong>{planning.actions.map((action) => action.description).join(" · ")}</strong></div><div className="fact-block"><span>Rationale</span><strong>{planning.reasoning}</strong></div></> : <p className="awaiting-data">{idle ? "Awaiting demo start" : "DATA UNAVAILABLE"}</p>}</div>
      <div className="explainability-column"><span className="eyebrow">SYSTEM VALIDATION</span>{validation ? <><div className="validation-state"><StatusDot tone={validation.valid ? "green" : "red"} /><strong>{validation.valid ? "VALID" : "INVALID"}</strong></div>{validation.valid ? <div className="fact-block"><span>Checks</span><strong>Resources available · No duplicate assignments · Facility capacity sufficient · Route operational · State version current · Dependencies consistent</strong></div> : <div className="fact-block"><span>Errors</span><strong>{validation.errors.map((error) => error.message).join(" · ")}</strong></div>}</> : <p className="awaiting-data">{idle ? "Awaiting demo start" : "VALIDATION NOT AVAILABLE"}</p>}</div>
    </div>
    <div className="explainability-footer"><div><span className="eyebrow">HUMAN DECISION</span><strong>{idle ? "Not recorded" : model.humanDecision ? `${model.humanDecision.decision} by ${model.humanDecision.coordinatorId}` : model.approvalAvailable ? "PENDING APPROVAL" : "Not recorded"}</strong></div><div><span className="eyebrow">EXECUTION STATE</span><strong>{idle ? "No active plan" : model.activePlan?.status ?? "No active plan"}</strong></div>{!idle && model.previousPlan && <div><span className="eyebrow">REPLANNING</span><strong>{model.previousPlan.id} → {model.activePlan?.id} · {model.reassessment.routeId} affected</strong></div>}</div>
  </section>;
}

function Dashboard({ model, snapshot, busy, onStart, onApprove, onModify, onReject, onExecute, onBlock, onReset }: { model: DashboardViewModel; snapshot: DemoSnapshot; busy: boolean; onStart: () => void; onApprove: () => void; onModify: (reason?: string) => void; onReject: (reason: string) => void; onExecute: () => void; onBlock: () => void; onReset: () => void }) {
  const [rejectReason, setRejectReason] = useState("");
  const [dismissedAlertRoute, setDismissedAlertRoute] = useState<string | null>(null);
  const plan = model.activePlan;
  const planSource = plan?.source ?? "UNKNOWN";
  const planSourceLabel = responsePlanSourceLabel(planSource);
  const planSourceSummary =
    planSource === "DETERMINISTIC_FALLBACK"
      ? "Gemini unavailable; plan generated using deterministic emergency constraints."
      : planSource === "UNKNOWN"
        ? "Source metadata unavailable; this plan is not represented as AI-generated."
        : plan?.summary ?? "";
  const approvalAvailable = (snapshot.stage === "AWAITING_APPROVAL" || snapshot.stage === "AWAITING_REVISED_APPROVAL") && plan?.status === "PENDING_APPROVAL";
  const executionAvailable = snapshot.stage === "AWAITING_EXECUTION" && plan?.status === "APPROVED";
  const alertVisible = model.reassessment.required && model.reassessment.routeId !== dismissedAlertRoute;
  const routeCount = model.routes.filter((route) => route.status !== "OPEN").length;
  const activeResources = model.resources.filter((resource) => resource.status !== "UNAVAILABLE" && resource.status !== "OUT_OF_SERVICE").length;
  const availableFacilities = model.facilities.filter((facility) => facility.status === "OPERATIONAL" || facility.status === "LIMITED").length;

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
      <header className="topbar"><div className="incident-context"><span className="context-label">CURRENT INCIDENT</span><strong>{model.incident.title}</strong><span className="incident-id">{model.incident.id}</span></div><div className="topbar-meta"><div className="topbar-state"><StatusDot /><span>System status</span><strong>Operational</strong></div><div className="topbar-divider" /><div className="topbar-updated">Last updated <strong>{formatTime(model.updatedAt)}</strong></div><div className="user-control"><span className="avatar" aria-hidden="true">JM</span><span className="user-name">Jordan Miller</span></div></div></header>
      <main className="dashboard" id="overview">
        <div className="page-header"><div><p className="eyebrow">OPERATIONS OVERVIEW</p><h1>Emergency coordination</h1></div><div className="header-actions"><span className="live-indicator" role="status" aria-live="polite"><StatusDot />{snapshot.progress.label}</span>        <div className="demo-switch">{snapshot.stage === "IDLE" ? <button className="demo-active" onClick={onStart} disabled={busy}>Start demo</button> : <button onClick={() => { setDismissedAlertRoute(null); onReset(); }} disabled={busy}>Reset demo</button>}{snapshot.stage === "COMPLETED" && snapshot.currentPlan?.id === "PLAN-001" && <button onClick={onBlock} disabled={busy}>Simulate R1 blockage</button>}</div></div></div>
        <section className="summary-strip" aria-label="Emergency summary"><div className="summary-cell summary-incident"><span className="summary-label">Incident</span><strong>{model.incident.title}</strong><small>{model.incident.location.address}</small></div><div className="summary-cell"><span className="summary-label">Status</span><strong className="value-critical"><StatusDot tone="red" />{model.incident.status} emergency</strong></div><div className="summary-cell"><span className="summary-label">Severity</span><strong className="value-critical">{model.incident.severity}</strong><small>Immediate response</small></div><div className="summary-cell"><span className="summary-label">Affected</span><strong>{model.incident.affectedPopulation} people</strong><small>Current incident estimate</small></div><div className="summary-cell"><span className="summary-label">State version</span><strong>v{model.stateVersion}</strong><small>Updated {formatTime(model.updatedAt)}</small></div></section>
        {snapshot.error && <div className="operational-failure" role="alert"><strong>{snapshot.error.code}</strong><span>{snapshot.error.message}</span><small>Stage: {snapshot.error.stage} · Reset required</small></div>}
        {alertVisible && <div className="reassessment-alert" role="alert"><div className="alert-icon"><AlertTriangle size={17} /></div><div className="alert-copy"><strong>Plan reassessment required</strong><span>{model.reassessment.routeId} is blocked and affects the active response plan.</span></div><div className="alert-detail"><span>Affected dependency</span><strong>{model.reassessment.routeId}</strong></div><div className="alert-detail"><span>Revised plan</span><strong>{model.reassessment.revisedPlanId}</strong></div><button className="alert-dismiss" aria-label="Dismiss reassessment notice" onClick={() => setDismissedAlertRoute(model.reassessment.routeId)}><X size={16} /></button></div>}
        <div className="primary-grid">
          <section className="panel map-panel" id="map"><PanelHeading eyebrow="SITUATIONAL AWARENESS" title="Operational map" /><div className="map-canvas" role="img" aria-label={`Schematic, not-to-scale incident map. ${model.routes.map((route) => `${route.id} ${route.statusLabel}`).join(", ")}. ${model.resources.slice(0, 2).map((resource) => resource.name).join(", ")}. ${model.facilities.map((facility) => facility.name).join(", ")}.`}><div className="map-grid-lines" /><div className="map-road road-a" /><div className="map-road road-b" /><div className="map-road road-c" />{model.routes.map((route, index) => <div className={`map-route ${mapRouteClass(route)} map-route-${index}`} key={route.id}><span>{route.id}{route.status !== "OPEN" ? ` · ${route.status}` : ""}</span></div>)}<div className="map-marker marker-incident"><AlertTriangle size={12} /><span>Incident</span></div>{model.resources.slice(0, 2).map((resource, index) => <div className={`map-marker marker-resource-${index}`} key={resource.id}><Users size={12} /><span>{resource.name}</span></div>)}{model.facilities.map((facility, index) => <div className={`map-marker marker-facility-${index}`} key={facility.id}><Hospital size={12} /><span>{facility.name}</span></div>)}<div className="map-legend"><span><i className="legend-line active-line" />Open route</span><span><i className="legend-line blocked-line" />Blocked route</span></div><div className="map-scale">500 m · schematic</div></div><div className="map-footer"><span><StatusDot tone="red" />{routeCount} blocked routes</span><span><StatusDot />{activeResources} resources active</span><span><StatusDot tone="blue" />{availableFacilities} facilities available</span></div></section>
          <section className="panel plan-panel" id="plans">
            <PanelHeading eyebrow="ACTIVE RESPONSE PLAN" title={plan?.id ?? "No active plan"} />
            {snapshot.planHistory.length > 0 && <PlanHistory plans={snapshot.planHistory} />}
            {plan ? (
              <>
                <div className="plan-meta">
                  <span>Incident {plan.incidentId}</span>
                  <span className="meta-separator">•</span>
                  <span>Generated {formatTime(plan.generatedAt)}</span>
                  <span className="meta-separator">•</span>
                  <span>State version {plan.stateVersion}</span>
                  <span className="meta-separator">•</span>
                  <span>Routes {plan.dependencies.routeIds.join(", ")}</span>
                  <span className={`plan-status status-badge badge-${plan.status === "PENDING_APPROVAL" ? "amber" : plan.status === "APPROVED" ? "green" : plan.status === "COMPLETED" ? "blue" : plan.status === "REJECTED" ? "red" : "gray"}`}>
                    <StatusDot tone={plan.status === "PENDING_APPROVAL" ? "amber" : plan.status === "REJECTED" ? "red" : "green"} />
                    {plan.status.replaceAll("_", " ")}
                  </span>
                </div>
                <div className="plan-callout">
                  <div className="callout-icon"><AlertTriangle size={15} /></div>
                  <div>
                    <strong>{model.reassessment.required ? "Dependency affected" : planSource === "UNKNOWN" ? "Plan source unavailable" : planSource === "DETERMINISTIC_FALLBACK" ? "Deterministic fallback" : "AI recommendation ready"}</strong>
                    <span>{model.reassessment.required ? `${model.reassessment.routeId} is no longer usable. Review the revised plan.` : planSourceSummary}</span>
                  </div>
                </div>
                <div className="plan-actions">
                  {model.actions.map((action) => (
                    <div className="plan-action" key={action.id}>
                      <span className="action-index">{action.sequenceLabel}</span>
                      <span>{action.description}</span>
                      {action.routeIds.some((routeId: string) => model.routes.find((route) => route.id === routeId)?.status !== "OPEN")
                        ? <span className="action-warning">Blocked</span>
                        : <StatusDot />}
                    </div>
                  ))}
                </div>
                <div className="plan-divider" />
                <div className="plan-origin">
                  <span className="ai-tag">{planSourceLabel}</span>
                  {planSource === "GEMINI" && snapshot.responsePlanningResult?.generation?.selectedModel && <span>{snapshot.responsePlanningResult.generation.selectedModel}</span>}
                  <span>{plan.rationale}</span>
                </div>
                <div className="human-decision">
                  <div>
                    <span className="eyebrow">{approvalAvailable ? "HUMAN AUTHORIZATION" : model.humanDecision?.decision === "APPROVE" ? "HUMAN APPROVED" : "WORKFLOW STATUS"}</span>
                    <p>{snapshot.progress.label}</p>
                    {approvalAvailable && <input className="decision-reason" value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} placeholder="Reason for rejection or modification (optional)" aria-label="Reason for rejection or modification" />}
                  </div>
                  <div className="decision-buttons">
                    {approvalAvailable && <>
                      <button className="button-approve" disabled={busy} onClick={onApprove}>{busy ? "Approving…" : <><Check size={14} />Approve plan</>}</button>
                      <button className="button-modify" disabled={busy} onClick={() => onModify(rejectReason || "Coordinator requested a plan modification.")}>Modify</button>
                      <button className="button-reject" disabled={busy} onClick={() => onReject(rejectReason || "Coordinator rejected the deterministic demo plan.")}>Reject</button>
                    </>}
                    {(executionAvailable || snapshot.stage === "EXECUTING" || snapshot.stage === "EXECUTING_REVISED_PLAN") && <button className="button-approve" disabled={busy || !executionAvailable} onClick={onExecute}>{busy || snapshot.stage.startsWith("EXECUTING") ? "Executing…" : "Execute plan"}</button>}
                  </div>
                </div>
              </>
            ) : (
          <div className="plan-empty">
            <strong>No active plan yet</strong>
            <span>Start the demo to run the agent cycle and generate the first response plan.</span>
            <div className="decision-buttons">
              {snapshot.stage === "IDLE" ? (
                <button className="button-approve" onClick={onStart} disabled={busy}>Start demo</button>
              ) : (
                <button className="button-modify" onClick={onReset} disabled={busy}>Reset demo</button>
              )}
            </div>
          </div>
        )}</section>
        </div>
        <div className="secondary-grid"><section className="panel table-panel" id="resources"><PanelHeading eyebrow="FIELD OPERATIONS" title="Resource status" /><div className="data-table"><div className="table-row table-head"><span>Resource</span><span>Type</span><span>Status</span><span>Assignment</span><span>Location</span></div>{resourceRows(model.resources)}</div></section><section className="panel facilities-panel" id="facilities"><PanelHeading eyebrow="CARE CAPACITY" title="Facilities" /><div className="facility-list">{facilityRows(model.facilities)}</div></section></div>
        <div className="bottom-grid"><section className="panel activity-panel" id="activity"><PanelHeading eyebrow="PROCESSING ACTIVITY" title="Agent activity" /><div className="agent-list">{agentRows(model.agents)}</div><div className="ai-note"><CircleDot size={13} />AI analyzes and recommends. Human coordinators authorize execution.</div></section><section className="panel timeline-panel" id="timeline"><PanelHeading eyebrow="AUDIT TRAIL" title="Situation timeline" /><div className="timeline-list">{timelineRows(model.timeline, snapshot.stage === "IDLE")}</div></section></div>
        <ExplainabilityPanel model={model} snapshot={snapshot} />
      </main>
      <footer className="app-footer"><span>REACT Emergency Coordination · Deterministic demo environment</span><span>State version {model.stateVersion} <span className="footer-divider">|</span> {model.incident.id}</span></footer>
    </div>
  </div>;
}

export default function Home() {
 const [controller] = useState(() => createDemoController(autoAiDemoAgents));
 const [snapshot, setSnapshot] = useState<DemoSnapshot>(() => controller.getSnapshot());
 const [busy, setBusy] = useState(false);
 const model = useMemo(() => createDashboardViewModel(snapshot), [snapshot]);
 async function run(operation: () => Promise<DemoOperationResult> | DemoOperationResult): Promise<boolean> {
   setBusy(true);
   try {
     const result = await operation();
     setSnapshot(result.snapshot);
     return result.success;
   } catch (error) {
     setSnapshot(controller.captureUnexpectedFailure(error).snapshot);
     return false;
   } finally {
     setBusy(false);
   }
 }
 async function execute() {
   const started = await run(() => controller.beginExecution());
   if (!started) return;
   await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
   await run(() => controller.completeExecution());
 }
 return <Dashboard
   model={model}
   snapshot={snapshot}
   busy={busy}
   onStart={() => void run(() => controller.startDemo())}
   onApprove={() => void run(() => controller.approveCurrentPlan())}
   onModify={(reason) => void run(() => controller.modifyCurrentPlan(reason || "Coordinator requested a plan modification."))}
   onReject={(reason) => void run(() => controller.rejectCurrentPlan(reason || "Coordinator rejected the deterministic demo plan."))}
   onExecute={() => void execute()}
   onBlock={() => void run(() => controller.simulateRouteBlockage())}
   onReset={() => void run(() => controller.resetDemo())}
 />;
}
