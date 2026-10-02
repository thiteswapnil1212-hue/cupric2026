import {
  Activity,
  AlertTriangle,
  Bell,
  Check,
  ChevronRight,
  CircleDot,
  Clock3,
  Crosshair,
  Hospital,
  MapPin,
  Menu,
  MoreHorizontal,
  Route,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";

const resources = [
  { name: "Rescue Team Alpha", type: "Rescue team", status: "Available", assignment: "Unassigned", location: "Sector 4", tone: "green" },
  { name: "Ambulance 07", type: "Ambulance", status: "Dispatched", assignment: "Plan #001", location: "Route R1", tone: "blue" },
  { name: "Fire Unit 12", type: "Fire unit", status: "On scene", assignment: "Building Fire", location: "Urban sector", tone: "amber" },
  { name: "Medical Team 03", type: "Medical team", status: "Unavailable", assignment: "Maintenance", location: "Base 2", tone: "red" },
];

const timeline = [
  ["12:46", "Revised plan generated", "Plan #002 is awaiting coordinator approval.", "green"],
  ["12:45", "Automatic reassessment triggered", "Route R1 dependency affected the active plan.", "amber"],
  ["12:44", "Route R1 blocked", "Flooding reported on the primary access route.", "red"],
  ["12:42", "Human coordinator approved plan", "Plan #001 authorized for simulated execution.", "blue"],
  ["12:41", "Response plan generated", "Plan #001 created from current assessments.", "gray"],
  ["12:40", "Risk assessment completed", "Incident severity confirmed as critical.", "gray"],
];

function StatusDot({ tone = "green" }: { tone?: string }) {
  return <span className={`status-dot status-${tone}`} aria-hidden="true" />;
}

function PanelHeading({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: string }) {
  return (
    <div className="panel-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2>{title}</h2>
      </div>
      {action && <button className="text-button">{action}<ChevronRight size={14} /></button>}
    </div>
  );
}

export default function Home() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Crosshair size={18} /></div>
          <div>
            <span className="brand-name">REACT</span>
            <span className="brand-caption">Emergency coordination</span>
          </div>
        </div>
        <div className="nav-section-label">Operations</div>
        <nav className="primary-nav" aria-label="Primary navigation">
          <a className="nav-item nav-active" href="#overview"><Activity size={16} />Overview</a>
          <a className="nav-item" href="#map"><MapPin size={16} />Live map</a>
          <a className="nav-item" href="#resources"><Users size={16} />Resources</a>
          <a className="nav-item" href="#facilities"><Hospital size={16} />Facilities</a>
          <a className="nav-item" href="#plans"><Route size={16} />Response plans</a>
        </nav>
        <div className="nav-section-label nav-section-lower">System</div>
        <nav className="primary-nav">
          <a className="nav-item" href="#timeline"><Clock3 size={16} />Situation timeline</a>
          <a className="nav-item" href="#activity"><Bell size={16} />Activity log <span className="nav-count">3</span></a>
        </nav>
        <div className="sidebar-footer">
          <div className="system-health"><StatusDot /><span>All systems operational</span></div>
          <span className="build-label">Environment · Simulation</span>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div className="mobile-menu"><Menu size={18} /></div>
          <div className="incident-context">
            <span className="context-label">CURRENT INCIDENT</span>
            <strong>Urban Building Fire</strong>
            <span className="incident-id">INC-2026-001</span>
          </div>
          <div className="topbar-meta">
            <div className="topbar-state"><StatusDot /><span>System status</span><strong>Operational</strong></div>
            <div className="topbar-divider" />
            <div className="topbar-updated">Last updated <strong>12:46:18 PM</strong></div>
            <button className="icon-button" aria-label="Notifications"><Bell size={17} /><span className="notification-mark" /></button>
            <button className="user-control"><span className="avatar">JM</span><span className="user-name">Jordan Miller</span><ChevronRight size={14} /></button>
          </div>
        </header>

        <main className="dashboard" id="overview">
          <div className="page-header">
            <div>
              <p className="eyebrow">OPERATIONS OVERVIEW</p>
              <h1>Emergency coordination</h1>
            </div>
            <div className="header-actions"><span className="live-indicator"><StatusDot />Live monitoring</span><button className="outline-button"><MoreHorizontal size={15} />More actions</button></div>
          </div>

          <section className="summary-strip" aria-label="Emergency summary">
            <div className="summary-cell summary-incident"><span className="summary-label">Incident</span><strong>Urban Building Fire</strong><small>Central district · Building 14</small></div>
            <div className="summary-cell"><span className="summary-label">Status</span><strong className="value-critical"><StatusDot tone="red" />Active emergency</strong></div>
            <div className="summary-cell"><span className="summary-label">Severity</span><strong className="value-critical">Critical</strong><small>Immediate response</small></div>
            <div className="summary-cell"><span className="summary-label">Affected</span><strong>35 people</strong><small>+8 since detection</small></div>
            <div className="summary-cell"><span className="summary-label">State version</span><strong>v12</strong><small>Updated 12:46 PM</small></div>
          </section>

          <div className="reassessment-alert">
            <div className="alert-icon"><AlertTriangle size={17} /></div>
            <div className="alert-copy"><strong>Plan reassessment required</strong><span>Route R1 is blocked and affects the active response plan.</span></div>
            <div className="alert-detail"><span>Affected dependency</span><strong>Route R1</strong></div>
            <div className="alert-detail"><span>Next action</span><strong>Awaiting human approval</strong></div>
            <button className="alert-dismiss" aria-label="Dismiss alert"><X size={16} /></button>
          </div>

          <div className="primary-grid">
            <section className="panel map-panel" id="map">
              <PanelHeading eyebrow="SITUATIONAL AWARENESS" title="Live operational map" action="Expand map" />
              <div className="map-canvas">
                <div className="map-grid-lines" />
                <div className="map-road road-a" /><div className="map-road road-b" /><div className="map-road road-c" />
                <div className="map-route route-active"><span>R2</span></div>
                <div className="map-route route-blocked"><span>R1 · BLOCKED</span></div>
                <div className="map-marker marker-incident"><AlertTriangle size={12} /><span>Incident</span></div>
                <div className="map-marker marker-rescue"><Users size={12} /><span>Rescue team</span></div>
                <div className="map-marker marker-hospital"><Hospital size={12} /><span>Hospital A</span></div>
                <div className="map-marker marker-shelter"><ShieldCheck size={12} /><span>Shelter</span></div>
                <div className="map-legend"><span><i className="legend-line active-line" />Active route</span><span><i className="legend-line blocked-line" />Blocked route</span></div>
                <div className="map-scale">500 m</div>
              </div>
              <div className="map-footer"><span><StatusDot tone="red" />1 blocked route</span><span><StatusDot />4 resources active</span><span><StatusDot tone="blue" />2 facilities available</span><button className="text-button">View map details <ChevronRight size={14} /></button></div>
            </section>

            <section className="panel plan-panel" id="plans">
              <PanelHeading eyebrow="ACTIVE RESPONSE PLAN" title="Plan #001" action="Plan history" />
              <div className="plan-meta"><span>Generated 12:41 PM</span><span className="meta-separator">•</span><span>State version 12</span><span className="plan-status status-badge badge-approved"><StatusDot />Approved</span></div>
              <div className="plan-callout"><div className="callout-icon"><AlertTriangle size={15} /></div><div><strong>Dependency affected</strong><span>Route R1 is no longer usable. A revised plan is ready for review.</span></div></div>
              <div className="plan-actions">
                <div className="plan-action"><span className="action-index">01</span><span>Dispatch Rescue Team Alpha</span><StatusDot /></div>
                <div className="plan-action"><span className="action-index">02</span><span>Route ambulance via R1</span><span className="action-warning">Blocked</span></div>
                <div className="plan-action"><span className="action-index">03</span><span>Allocate 12 patients to Hospital A</span><StatusDot /></div>
                <div className="plan-action"><span className="action-index">04</span><span>Allocate remaining patients to Hospital B</span><StatusDot /></div>
              </div>
              <div className="plan-divider" />
              <div className="plan-origin"><span className="ai-tag">AI RECOMMENDATION</span><span>Generated by the Response Planning Agent</span></div>
              <div className="human-decision"><div><span className="eyebrow">HUMAN DECISION</span><p>Revised Plan #002 awaiting coordinator approval.</p></div><div className="decision-buttons"><button className="button-approve"><Check size={14} />Approve</button><button className="button-modify">Modify</button><button className="button-reject">Reject</button></div></div>
            </section>
          </div>

          <div className="secondary-grid">
            <section className="panel table-panel" id="resources">
              <PanelHeading eyebrow="FIELD OPERATIONS" title="Resource status" action="View all resources" />
              <div className="data-table">
                <div className="table-row table-head"><span>Resource</span><span>Type</span><span>Status</span><span>Assignment</span><span>Location</span></div>
                {resources.map((resource) => <div className="table-row" key={resource.name}><span className="resource-name">{resource.name}</span><span>{resource.type}</span><span><span className={`status-badge badge-${resource.tone}`}><StatusDot tone={resource.tone} />{resource.status}</span></span><span>{resource.assignment}</span><span>{resource.location}</span></div>)}
              </div>
            </section>
            <section className="panel facilities-panel" id="facilities">
              <PanelHeading eyebrow="CARE CAPACITY" title="Facilities" action="View all" />
              <div className="facility-list">
                <div className="facility-row"><div className="facility-icon"><Hospital size={17} /></div><div className="facility-info"><strong>Hospital A</strong><span>18 / 20 beds available</span></div><span className="status-badge badge-green"><StatusDot />Operational</span></div>
                <div className="facility-row"><div className="facility-icon"><Hospital size={17} /></div><div className="facility-info"><strong>Hospital B</strong><span>4 / 10 beds available</span></div><span className="status-badge badge-amber"><StatusDot tone="amber" />Limited</span></div>
                <div className="facility-row"><div className="facility-icon"><ShieldCheck size={17} /></div><div className="facility-info"><strong>North Shelter</strong><span>64 / 100 places available</span></div><span className="status-badge badge-green"><StatusDot />Operational</span></div>
              </div>
            </section>
          </div>

          <div className="bottom-grid">
            <section className="panel activity-panel" id="activity">
              <PanelHeading eyebrow="PROCESSING ACTIVITY" title="Agent activity" />
              <div className="agent-list">
                <div className="agent-row"><div className="agent-check"><Check size={13} /></div><div><strong>Risk Assessment</strong><span>Completed · 12:40:21</span></div><span className="agent-state">Complete</span></div>
                <div className="agent-row"><div className="agent-check"><Check size={13} /></div><div><strong>Resource &amp; Routing</strong><span>Completed · 12:40:24</span></div><span className="agent-state">Complete</span></div>
                <div className="agent-row agent-row-current"><div className="agent-check"><Activity size={13} /></div><div><strong>Response Planning</strong><span>Reassessment complete · 12:46:12</span></div><span className="agent-state state-review">Review</span></div>
              </div>
              <div className="ai-note"><CircleDot size={13} />AI analyzes and recommends. Human coordinators authorize execution.</div>
            </section>
            <section className="panel timeline-panel" id="timeline">
              <PanelHeading eyebrow="AUDIT TRAIL" title="Situation timeline" action="View full history" />
              <div className="timeline-list">{timeline.map(([time, title, detail, tone]) => <div className="timeline-item" key={`${time}-${title}`}><time>{time}</time><span className={`timeline-marker marker-${tone}`} /><div><strong>{title}</strong><span>{detail}</span></div></div>)}</div>
            </section>
          </div>
        </main>
        <footer className="app-footer"><span>REACT Emergency Coordination · Simulation environment</span><span>Data refresh interval 15 sec <span className="footer-divider">|</span> v0.9.0</span></footer>
      </div>
    </div>
  );
}
