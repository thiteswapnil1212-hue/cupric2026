"use client";

import { useMemo, useState } from "react";
import {
  Activity, AlertTriangle, Bell, Check, CircleDot, Clock3, Crosshair,
  Hospital, MapPin, Route, Users, X,
} from "lucide-react";
import { WHAT_IF_SCENARIOS, type WhatIfScenario } from "../domain/what-if/schema";
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
import {
  WhatIfSimulationResultSchema,
  type WhatIfSimulationResult,
} from "../lib/what-if/schema";

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
  return facilities.map((facility) => {
    const capacityLimit = Math.max(facility.totalCapacity, 1);
    const occupiedCapacity = Math.min(
      capacityLimit,
      Math.max(0, facility.totalCapacity - facility.availableCapacity),
    );
    return (
      <div className={`facility-row facility-tone-${facility.tone}`} key={facility.id}>
        <div className="facility-icon"><Hospital size={17} /></div>
        <div className="facility-info">
          <strong>{facility.name}</strong>
          <span>{facility.availableCapacity} / {facility.totalCapacity} beds available</span>
          <progress
            className="facility-capacity"
            max={capacityLimit}
            value={occupiedCapacity}
            aria-label={`${facility.name} occupied capacity`}
          />
        </div>
        <span className={`status-badge badge-${facility.tone}`}>
          <StatusDot tone={facility.tone} />{facility.statusLabel}
        </span>
      </div>
    );
  });
}

function agentRows(agents: DashboardAgent[]) {
  return agents.map((agent) => (
    <div className={`agent-row agent-status-${agent.status.toLowerCase()}${agent.status === "STANDBY" ? " agent-standby" : ""}`} key={agent.id}>
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
  return [...items].reverse().map((item) => <div className={`timeline-item timeline-tone-${item.tone}`} key={item.id}><time>{item.timeLabel}</time><span className={`timeline-marker marker-${item.tone}`} /><div><strong>{item.title}</strong><span>{item.detail}</span></div></div>);
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

function mapRouteClass(
  route: DashboardRoute,
  plan: DashboardViewModel["activePlan"],
  previousPlan: DashboardViewModel["previousPlan"],
  hypotheticalPlan?: DashboardViewModel["activePlan"],
): string {
  const routeIsInActivePlan = plan?.dependencies.routeIds.includes(route.id) ?? false;
  const routeAffectsPreviousPlan =
    route.status !== "OPEN" &&
    (previousPlan?.dependencies.routeIds.includes(route.id) ?? false);
  const statusClass = route.status === "OPEN" ? "route-active" : "route-blocked";
  return [
    statusClass,
    routeIsInActivePlan && route.status === "OPEN" ? "route-in-use" : "",
    routeAffectsPreviousPlan ? "route-affected" : "",
    hypotheticalPlan?.dependencies.routeIds.includes(route.id) &&
    !plan?.dependencies.routeIds.includes(route.id)
      ? "route-what-if-alternative"
      : "",
  ].filter(Boolean).join(" ");
}

type WhatIfStatus = "IDLE" | "SIMULATING" | "COMPLETE" | "ERROR";

function scenarioIcon(type: WhatIfScenario["type"]) {
  if (type === "ROUTE_BLOCKED") return <Route size={17} aria-hidden="true" />;
  if (type === "FACILITY_UNAVAILABLE") return <Hospital size={17} aria-hidden="true" />;
  if (type === "RESOURCE_UNAVAILABLE") return <Users size={17} aria-hidden="true" />;
  return <Activity size={17} aria-hidden="true" />;
}

function dependencyNames(
  state: WhatIfSimulationResult["currentState"],
  actions: ReadonlyArray<WhatIfSimulationResult["currentActions"][number]>,
  dependency: "resourceIds" | "facilityIds" | "routeIds",
): string {
  const ids = [...new Set(actions.flatMap((action) => action[dependency]))];
  if (ids.length === 0) return "No recorded assignment";
  return ids
    .map((id) => {
      if (dependency === "resourceIds") {
        return state.resources.find((item) => item.id === id)?.name ?? id;
      }
      if (dependency === "facilityIds") {
        return state.facilities.find((item) => item.id === id)?.name ?? id;
      }
      return state.routes.find((item) => item.id === id)?.id ?? id;
    })
    .join(", ");
}

function WhatIfPanel({
  selectedScenario,
  status,
  result,
  history,
  error,
  onSelect,
  onRun,
  onClose,
  onRetry,
}: {
  selectedScenario: WhatIfScenario | null;
  status: WhatIfStatus;
  result: WhatIfSimulationResult | null;
  history: readonly WhatIfSimulationResult[];
  error: string | null;
  onSelect: (scenario: WhatIfScenario) => void;
  onRun: () => void;
  onClose: () => void;
  onRetry: () => void;
}) {
  const hypotheticalPlan = result?.workflowResult.responsePlanningResult.plan ?? null;
  const hypotheticalActions =
    result?.workflowResult.responsePlanningResult.actions ?? [];
  return (
    <section className="panel what-if-panel" id="what-if" aria-labelledby="what-if-title">
      <div className="what-if-heading">
        <div>
          <p className="eyebrow">WHAT-IF SIMULATION</p>
          <h2 id="what-if-title">Explore a changed situation</h2>
          <p>
            Explore how REACT would respond if conditions change — without affecting the active emergency.
          </p>
        </div>
        {result && (
          <span className="what-if-safety-badge">
            <CircleDot size={12} aria-hidden="true" /> SIMULATED · NOT EXECUTED
          </span>
        )}
      </div>

      <div className="what-if-scenarios" role="group" aria-label="Choose a hypothetical scenario">
        {WHAT_IF_SCENARIOS.map((scenario) => (
          <button
            className={`what-if-scenario${selectedScenario?.id === scenario.id ? " what-if-scenario-selected" : ""}`}
            key={scenario.id}
            type="button"
            aria-pressed={selectedScenario?.id === scenario.id}
            disabled={status === "SIMULATING"}
            onClick={() => onSelect(scenario)}
          >
            <span className="what-if-scenario-icon">{scenarioIcon(scenario.type)}</span>
            <strong>{scenario.label}</strong>
            <span>{scenario.description}</span>
            <small>AFFECTED · {scenario.affectedElement}</small>
          </button>
        ))}
      </div>

      <div className="what-if-actions">
        {status === "SIMULATING" ? (
          <p className="what-if-progress" role="status" aria-live="polite">
            <Activity size={15} aria-hidden="true" />
            Running REACT analysis against an isolated copy. No agent stage or duration is estimated.
          </p>
        ) : status === "ERROR" ? (
          <div className="what-if-error" role="alert">
            <div>
              <strong>WHAT-IF SIMULATION FAILED</strong>
              <span>{error ?? "The simulation could not produce a validated result."}</span>
              <small>The active emergency response was not changed.</small>
            </div>
            <button type="button" className="outline-button" onClick={onRetry} disabled={!selectedScenario}>
              TRY AGAIN
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="what-if-run"
            onClick={status === "COMPLETE" ? onClose : onRun}
            disabled={status !== "COMPLETE" && selectedScenario === null}
          >
            {status === "COMPLETE" ? "CLOSE SIMULATION" : "RUN SIMULATION"}
          </button>
        )}
      </div>

      {result && hypotheticalPlan && (
        <div className="what-if-result" aria-live="polite">
          <div className="what-if-result-heading">
            <div>
              <p className="eyebrow">WHAT-IF RESULT · {result.simulationId}</p>
              <h3>{result.scenario.label}</h3>
            </div>
            <span className="what-if-not-executed">HYPOTHETICAL — NOT EXECUTED</span>
          </div>
          <div className="what-if-comparison">
            <article className="what-if-plan-card what-if-real">
              <span className="what-if-card-label">REAL / ACTIVE RESPONSE</span>
              <h4>{result.currentPlan?.id ?? "NO ACTIVE PLAN"}</h4>
              <p>{result.currentPlan?.status.replaceAll("_", " ") ?? "No persisted active plan"}</p>
              <dl>
                <div><dt>Route</dt><dd>{dependencyNames(result.currentState, result.currentActions, "routeIds")}</dd></div>
                <div><dt>Facility</dt><dd>{dependencyNames(result.currentState, result.currentActions, "facilityIds")}</dd></div>
                <div><dt>Resources</dt><dd>{dependencyNames(result.currentState, result.currentActions, "resourceIds")}</dd></div>
                <div><dt>Plan source</dt><dd>{result.currentPlan ? responsePlanSourceLabel(result.currentPlan.source) : "Not available"}</dd></div>
                <div><dt>Validation</dt><dd>{result.currentPlanValidationValid === null ? "Not available" : result.currentPlanValidationValid ? "VALID" : "INVALID"}</dd></div>
              </dl>
            </article>
            <article className="what-if-plan-card what-if-simulated">
              <span className="what-if-card-label">WHAT-IF / SIMULATED</span>
              <h4>{hypotheticalPlan.id}</h4>
              <p>HYPOTHETICAL · NOT EXECUTED</p>
              <dl>
                <div><dt>Route</dt><dd>{dependencyNames(result.hypotheticalState, hypotheticalActions, "routeIds")}</dd></div>
                <div><dt>Facility</dt><dd>{dependencyNames(result.hypotheticalState, hypotheticalActions, "facilityIds")}</dd></div>
                <div><dt>Resources</dt><dd>{dependencyNames(result.hypotheticalState, hypotheticalActions, "resourceIds")}</dd></div>
                <div><dt>Plan source</dt><dd>{responsePlanSourceLabel(hypotheticalPlan.source)}</dd></div>
                <div><dt>Validation</dt><dd>{result.workflowResult.responsePlanningResult.validation.valid ? "VALID" : "INVALID"}</dd></div>
              </dl>
            </article>
          </div>

          {result.changes.length > 0 && (
            <div className="what-if-impact">
              <p className="eyebrow">IMPACT OF CHANGE</p>
              <ul>
                {result.changes.map((change) => (
                  <li key={`${change.entityType}-${change.entityId}-${change.field}`}>
                    <span>{change.field.replaceAll(/([A-Z])/g, " $1")} · {change.entityId}</span>
                    <strong>{change.previousValue} → {change.hypotheticalValue}</strong>
                  </li>
                ))}
                <li>
                  <span>Response plan</span>
                  <strong>{result.currentPlan?.id ?? "No active plan"} → {hypotheticalPlan.id}</strong>
                </li>
              </ul>
            </div>
          )}
        </div>
      )}

      {history.length > 0 && (
        <details className="what-if-history">
          <summary>WHAT-IF HISTORY · {history.length}</summary>
          <ol>
            {history.map((item) => (
              <li key={item.simulationId}>
                <strong>{item.simulationId}</strong>
                <span>{item.scenario.label}</span>
                <span>{item.workflowResult.responsePlanningResult.plan.id} · {item.workflowResult.responsePlanningResult.validation.valid ? "Valid" : "Invalid"}</span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
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

function Dashboard({ model, snapshot, busy, onStart, onApprove, onModify, onReject, onExecute, onBlock, onReset, whatIfSelectedScenario, whatIfStatus, whatIfResult, whatIfHistory, whatIfError, onWhatIfSelect, onWhatIfRun, onWhatIfClose, onWhatIfRetry }: {
  model: DashboardViewModel;
  snapshot: DemoSnapshot;
  busy: boolean;
  onStart: () => void;
  onApprove: () => void;
  onModify: (reason?: string) => void;
  onReject: (reason: string) => void;
  onExecute: () => void;
  onBlock: () => void;
  onReset: () => void;
  whatIfSelectedScenario: WhatIfScenario | null;
  whatIfStatus: WhatIfStatus;
  whatIfResult: WhatIfSimulationResult | null;
  whatIfHistory: readonly WhatIfSimulationResult[];
  whatIfError: string | null;
  onWhatIfSelect: (scenario: WhatIfScenario) => void;
  onWhatIfRun: () => void;
  onWhatIfClose: () => void;
  onWhatIfRetry: () => void;
}) {
  const [rejectReason, setRejectReason] = useState("");
  const [dismissedAlertRoute, setDismissedAlertRoute] = useState<string | null>(null);
  const plan = model.activePlan;
  const whatIfPlan =
    whatIfStatus === "COMPLETE"
      ? whatIfResult?.workflowResult.responsePlanningResult.plan ?? null
      : null;
  const mapModel =
    whatIfStatus === "COMPLETE" && whatIfResult !== null
      ? createDashboardViewModel({
          ...snapshot,
          state: whatIfResult.hypotheticalState,
        })
      : model;
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
  const planRouteDependencies = plan?.dependencies.routeIds.map((routeId) => ({
    id: routeId,
    route: model.routes.find((route) => route.id === routeId),
  })) ?? [];
  const commandStatus =
    snapshot.stage === "REASSESSING"
      ? "REASSESSING"
      : snapshot.stage === "EXECUTING" || snapshot.stage === "EXECUTING_REVISED_PLAN"
        ? "EXECUTING"
        : snapshot.stage === "AWAITING_EXECUTION"
          ? "READY TO EXECUTE"
          : snapshot.stage === "AWAITING_APPROVAL" || snapshot.stage === "AWAITING_REVISED_APPROVAL"
          ? "AWAITING HUMAN APPROVAL"
          : snapshot.stage === "COMPLETED"
            ? "MONITORING"
            : snapshot.stage === "IDLE"
              ? "READY"
              : snapshot.progress.label.toUpperCase();
  const commandStatusTone = snapshot.error
    ? "red"
    : commandStatus === "REASSESSING" || commandStatus === "AWAITING HUMAN APPROVAL"
      ? "amber"
      : commandStatus === "EXECUTING"
        ? "blue"
        : "green";

  return <div className="app-shell" data-stage={snapshot.stage}>
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
      <header className="topbar"><div className="incident-context"><span className="context-label">CURRENT INCIDENT</span><strong>{model.incident.title}</strong><span className="incident-id">{model.incident.id}</span></div><div className="topbar-meta"><div className="topbar-state" data-tone={commandStatusTone} role="status" aria-live="polite"><StatusDot tone={commandStatusTone} /><span>System status</span><strong key={commandStatus}>{commandStatus}</strong></div><div className="topbar-divider" /><div className="topbar-updated">Last updated <strong>{formatTime(model.updatedAt)}</strong></div><div className="user-control"><span className="avatar" aria-hidden="true">JM</span><span className="user-name">Jordan Miller</span></div></div></header>
      <main className="dashboard" id="overview">
        <div className="page-header"><div><p className="eyebrow">OPERATIONS OVERVIEW</p><h1>Emergency coordination</h1></div><div className="header-actions"><span className="live-indicator" role="status" aria-live="polite"><StatusDot />{snapshot.progress.label}</span>        <div className="demo-switch">{snapshot.stage === "IDLE" ? <button className="demo-active" onClick={onStart} disabled={busy}>Start demo</button> : <button onClick={() => { setDismissedAlertRoute(null); onReset(); }} disabled={busy}>Reset demo</button>}{snapshot.stage === "COMPLETED" && snapshot.currentPlan?.id === "PLAN-001" && <button onClick={onBlock} disabled={busy}>Simulate R1 blockage</button>}</div></div></div>
        <section className="summary-strip" aria-label="Emergency summary"><div className="summary-cell summary-incident"><span className="summary-label">Incident</span><strong>{model.incident.title}</strong><small>{model.incident.location.address}</small></div><div className="summary-cell"><span className="summary-label">Status</span><strong className="value-critical"><StatusDot tone="red" />{model.incident.status} emergency</strong></div><div className="summary-cell"><span className="summary-label">Severity</span><strong className="value-critical">{model.incident.severity}</strong><small>Immediate response</small></div><div className="summary-cell"><span className="summary-label">Affected</span><strong>{model.incident.affectedPopulation} people</strong><small>Current incident estimate</small></div><div className="summary-cell"><span className="summary-label">State version</span><strong>v{model.stateVersion}</strong><small>Updated {formatTime(model.updatedAt)}</small></div></section>
        {snapshot.error && <div className="operational-failure" role="alert"><strong>{snapshot.error.code}</strong><span>{snapshot.error.message}</span><small>Stage: {snapshot.error.stage} · Reset required</small></div>}
        <WhatIfPanel
          selectedScenario={whatIfSelectedScenario}
          status={whatIfStatus}
          result={whatIfResult}
          history={whatIfHistory}
          error={whatIfError}
          onSelect={onWhatIfSelect}
          onRun={onWhatIfRun}
          onClose={onWhatIfClose}
          onRetry={onWhatIfRetry}
        />
        {alertVisible && <div className="reassessment-alert" role="alert"><div className="alert-icon"><AlertTriangle size={17} /></div><div className="alert-copy"><strong>Plan reassessment required</strong><span>{model.reassessment.routeId} is blocked and affects the active response plan.</span></div><div className="alert-detail"><span>Affected dependency</span><strong>{model.reassessment.routeId}</strong></div><div className="alert-detail"><span>Revised plan</span><strong>{model.reassessment.revisedPlanId}</strong></div><button className="alert-dismiss" aria-label="Dismiss reassessment notice" onClick={() => setDismissedAlertRoute(model.reassessment.routeId)}><X size={16} /></button></div>}
        <div className="primary-grid">
          <section className={`panel map-panel${mapModel.reassessment.required ? " map-reassessment" : ""}${whatIfPlan ? " map-what-if" : ""}`} id="map">
            <PanelHeading eyebrow={whatIfPlan ? "WHAT-IF SIMULATION · PRESENTATION OVERLAY" : "SITUATIONAL AWARENESS"} title={whatIfPlan ? "Hypothetical operational map" : "Operational map"} />
            <div className="map-canvas" role="img" aria-label={`${whatIfPlan ? "What-If simulated overlay. " : ""}Schematic, not-to-scale incident map. ${mapModel.routes.map((route) => `${route.id} ${route.statusLabel}`).join(", ")}. ${mapModel.resources.slice(0, 2).map((resource) => resource.name).join(", ")}. ${mapModel.facilities.map((facility) => facility.name).join(", ")}.`}>
              <div className="map-grid-lines" /><div className="map-road road-a" /><div className="map-road road-b" /><div className="map-road road-c" />
              {mapModel.routes.map((route, index) => <div className={`map-route ${mapRouteClass(route, mapModel.activePlan, mapModel.previousPlan, whatIfPlan)} map-route-${index}`} key={route.id}><span>{route.id}{route.status !== "OPEN" ? ` · ${route.status}` : ""}</span></div>)}
              <div className={`map-marker marker-incident${mapModel.incident.status === "ACTIVE" ? " marker-incident-active" : ""}`}><AlertTriangle size={12} /><span>Incident</span></div>
              {mapModel.resources.slice(0, 2).map((resource, index) => <div className={`map-marker marker-resource-${index}`} data-resource-status={resource.status} key={resource.id}><Users size={12} /><span>{resource.name}</span></div>)}
              {mapModel.facilities.map((facility, index) => <div className={`map-marker marker-facility-${index}`} data-facility-status={facility.status} key={facility.id}><Hospital size={12} /><span>{facility.name}</span></div>)}
              <div className="map-legend"><span><i className="legend-line active-line" />Open route</span><span><i className="legend-line blocked-line" />Blocked route</span>{whatIfPlan && <span><i className="legend-line what-if-line" />What-If plan route</span>}</div>
              <div className="map-scale">500 m · schematic</div>
            </div>
            {whatIfPlan && <div className="map-what-if-label">WHAT-IF SIMULATION · NOT THE ACTIVE EMERGENCY MAP</div>}
            <div className="map-footer"><span><StatusDot tone="red" />{mapModel.routes.filter((route) => route.status !== "OPEN").length} blocked routes</span><span><StatusDot />{mapModel.resources.filter((resource) => resource.status !== "UNAVAILABLE" && resource.status !== "OUT_OF_SERVICE").length} resources active</span><span><StatusDot tone="blue" />{mapModel.facilities.filter((facility) => facility.status === "OPERATIONAL" || facility.status === "LIMITED").length} facilities available</span></div>
          </section>
          <section className={`panel plan-panel${approvalAvailable ? " plan-awaiting-approval" : executionAvailable ? " plan-ready-to-execute" : snapshot.stage.startsWith("EXECUTING") ? " plan-executing" : ""}`} id="plans">
            <PanelHeading eyebrow="ACTIVE RESPONSE PLAN" title={plan?.id ?? "NO ACTIVE RESPONSE PLAN"} />
            {model.previousPlan && <div className="previous-plan-state"><span>PREVIOUS PLAN</span><strong>{model.previousPlan.id}</strong><span>{model.previousPlan.status.replaceAll("_", " ")}</span></div>}
            {snapshot.planHistory.length > 0 && <PlanHistory plans={snapshot.planHistory} />}
            <div className="plan-content" key={plan?.id ?? "empty"}>
            {plan ? (
              <>
                <div className="plan-meta">
                  <span>Incident {plan.incidentId}</span>
                  <span className="meta-separator">•</span>
                  <span>Generated {formatTime(plan.generatedAt)}</span>
                  <span className="meta-separator">•</span>
                  <span>State version {plan.stateVersion}</span>
                  <span className="meta-separator">•</span>
                  <span className="plan-route-dependencies" aria-label="Plan route dependencies">
                    <span className="plan-route-label">ROUTE DEPENDENCY</span>
                    {planRouteDependencies.map(({ id, route }) => (
                      <span className={`plan-route-chip${route && route.status !== "OPEN" ? " plan-route-chip-affected" : ""}`} key={id}>
                        <Route size={11} aria-hidden="true" />
                        {id} · {route?.statusLabel ?? "STATUS UNAVAILABLE"}
                      </span>
                    ))}
                  </span>
                  <span className={`plan-status status-badge badge-${plan.status === "PENDING_APPROVAL" ? "amber" : plan.status === "APPROVED" ? "green" : plan.status === "COMPLETED" ? "blue" : plan.status === "REJECTED" ? "red" : "gray"}`}>
                    <StatusDot tone={plan.status === "PENDING_APPROVAL" ? "amber" : plan.status === "REJECTED" ? "red" : "green"} />
                    {plan.status.replaceAll("_", " ")}
                  </span>
                </div>
                <div className={`plan-callout${model.reassessment.required ? " plan-callout-affected" : ""}`}>
                  <div className="callout-icon"><AlertTriangle size={15} /></div>
                  <div>
                    <strong>{model.reassessment.required ? "Dependency affected" : planSource === "UNKNOWN" ? "Plan source unavailable" : planSource === "DETERMINISTIC_FALLBACK" ? "Deterministic fallback" : "AI recommendation ready"}</strong>
                    <span>{model.reassessment.required ? `${model.reassessment.routeId} is no longer usable. Review the revised plan.` : planSourceSummary}</span>
                  </div>
                </div>
                <div className="plan-actions">
                  {model.actions.map((action) => (
                    <div className={`plan-action${action.routeIds.some((routeId: string) => model.routes.find((route) => route.id === routeId)?.status !== "OPEN") ? " plan-action-affected" : ""}`} key={action.id}>
                      <span className="action-index">{action.sequenceLabel}</span>
                      <span>{action.description}</span>
                      {action.routeIds.some((routeId: string) => model.routes.find((route) => route.id === routeId)?.status !== "OPEN")
                        ? <span className="action-warning">Blocked</span>
                        : <StatusDot />}
                    </div>
                  ))}
                </div>
                <div className="plan-divider" />
                <div className={`plan-origin plan-source-${planSource.toLowerCase()}`}>
                  <span className="ai-tag">{planSourceLabel}</span>
                  {planSource === "GEMINI" && snapshot.responsePlanningResult?.generation?.selectedModel && <span>{snapshot.responsePlanningResult.generation.selectedModel}</span>}
                  <span>{plan.rationale}</span>
                </div>
                <div className={`human-decision${approvalAvailable ? " human-decision-pending" : model.humanDecision ? ` human-decision-${model.humanDecision.decision.toLowerCase()}` : ""}`}>
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
              <span>Awaiting emergency assessment</span>
            <div className="decision-buttons">
              {snapshot.stage === "IDLE" ? (
                <button className="button-approve" onClick={onStart} disabled={busy}>Start demo</button>
              ) : (
                <button className="button-modify" onClick={onReset} disabled={busy}>Reset demo</button>
              )}
            </div>
          </div>
        )}</div></section>
        </div>
        <div className="secondary-grid"><section className="panel table-panel" id="resources"><PanelHeading eyebrow="FIELD OPERATIONS" title="Resource status" /><div className="data-table"><div className="table-row table-head"><span>Resource</span><span>Type</span><span>Status</span><span>Assignment</span><span>Location</span></div>{resourceRows(model.resources)}</div></section><section className="panel facilities-panel" id="facilities"><PanelHeading eyebrow="CARE CAPACITY" title="Facilities" /><div className="facility-list">{facilityRows(model.facilities)}</div></section></div>
        <div className="bottom-grid"><section className="panel activity-panel" id="activity"><PanelHeading eyebrow="PROCESSING ACTIVITY" title="Agent activity" /><div className="agent-list">{agentRows(model.agents)}</div><div className="ai-note"><CircleDot size={13} />AI analyzes and recommends. Human coordinators authorize execution.</div></section><section className="panel timeline-panel" id="timeline"><PanelHeading eyebrow="AUDIT TRAIL" title="Situation timeline" /><div className="timeline-list" role="log" aria-label="Situation timeline" aria-live="polite" aria-relevant="additions text">{timelineRows(model.timeline, snapshot.stage === "IDLE")}</div></section></div>
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
 const [whatIfSelectedScenario, setWhatIfSelectedScenario] = useState<WhatIfScenario | null>(null);
 const [whatIfStatus, setWhatIfStatus] = useState<WhatIfStatus>("IDLE");
 const [whatIfResult, setWhatIfResult] = useState<WhatIfSimulationResult | null>(null);
 const [whatIfHistory, setWhatIfHistory] = useState<WhatIfSimulationResult[]>([]);
 const [whatIfError, setWhatIfError] = useState<string | null>(null);
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
 function selectWhatIfScenario(scenario: WhatIfScenario) {
   setWhatIfSelectedScenario(scenario);
   setWhatIfStatus("IDLE");
   setWhatIfResult(null);
   setWhatIfError(null);
 }
 async function runWhatIf() {
   if (whatIfSelectedScenario === null || whatIfStatus === "SIMULATING") return;
   setWhatIfStatus("SIMULATING");
   setWhatIfResult(null);
   setWhatIfError(null);
   try {
     const response = await fetch("/api/demo/what-if", {
       method: "POST",
       headers: { "Content-Type": "application/json" },
       body: JSON.stringify({
         incidentId: model.incident.id,
         scenario: whatIfSelectedScenario,
       }),
     });
     const body = await response.json() as unknown;
     if (!response.ok) {
       const message =
         typeof body === "object" &&
         body !== null &&
         "message" in body &&
         typeof body.message === "string"
           ? body.message
           : "The simulation could not complete safely.";
       throw new Error(message);
     }
     const parsed = WhatIfSimulationResultSchema.safeParse(body);
     if (!parsed.success) {
       throw new Error("The simulation returned an invalid result.");
     }
     setWhatIfResult(parsed.data);
     setWhatIfHistory((current) => [parsed.data, ...current].slice(0, 3));
     setWhatIfStatus("COMPLETE");
   } catch (error) {
     setWhatIfError(
       error instanceof Error
         ? error.message
         : "The simulation could not complete safely.",
     );
     setWhatIfStatus("ERROR");
   }
 }
 function closeWhatIf() {
   setWhatIfResult(null);
   setWhatIfStatus("IDLE");
   setWhatIfError(null);
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
   whatIfSelectedScenario={whatIfSelectedScenario}
   whatIfStatus={whatIfStatus}
   whatIfResult={whatIfResult}
   whatIfHistory={whatIfHistory}
   whatIfError={whatIfError}
   onWhatIfSelect={selectWhatIfScenario}
   onWhatIfRun={() => void runWhatIf()}
   onWhatIfClose={closeWhatIf}
   onWhatIfRetry={() => void runWhatIf()}
 />;
}
