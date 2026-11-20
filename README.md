# REACT — Adaptive Emergency Response Intelligence

Built for **CuriousPARC 2026** (national hackathon): a command-center decision-support prototype where AI agents draft emergency response plans, a human approves them, and the system **replans live** when the situation changes.

**Live demo:** https://cupriouspark.vercel.app/ — yes, "cupriouspark" is the real URL spelling.

> **Repo layout, honestly:** this repository is a thin wrapper. It contains only this README and one folder, `react-emergency-coordination/`, which is the entire application and the deploy root. All commands below run inside that folder.

## The demo scenario

Urban high-rise fire, incident **INC-2026-001** — Central district, Building 14, severity CRITICAL, 35 people affected (as shown on the live demo). The command center sees rescue teams and ambulances on a schematic map, hospital bed capacity, and three AI agents standing by until the demo starts.

The demo flow:

1. Agents generate an initial response plan for the fire.
2. A simulated event ("Block Road A") changes the situation.
3. Agents replan in real time — old plan vs new plan, side by side, with an activity timeline.
4. Nothing executes without a human coordinator approving it.

All incident, resource and hospital data in the demo is fictional fixture data, not a real emergency.

## Sequence — from incident to approved plan

```mermaid
sequenceDiagram
    autonumber
    participant C as Coordinator
    participant UI as Command-center UI<br/>(Next.js page)
    participant O as Orchestrator<br/>(pipeline.ts)
    participant R as Risk Assessment agent
    participant RR as Resource & Routing agent
    participant P as Response Planning agent
    participant G as Gemini<br/>(or deterministic fallback)
    participant H as Human approval
    participant S as Supabase<br/>(optional)

    C->>UI: Start demo (INC-2026-001)
    UI->>O: Run agent pipeline
    O->>R: Assess severity, hazards, population impact
    O->>RR: Check resources, facilities, route feasibility
    O->>P: Build response recommendation
    R->>G: Structured JSON request (Zod schema)
    RR->>G: Structured JSON request (Zod schema)
    P->>G: Structured JSON request (Zod schema)
    G-->>P: Draft plan (or fallback output, no API key needed)
    P->>H: Plan submitted for review
    H->>H: Approve / reject / modify
    H->>S: Persist decision + plan lifecycle (if configured)
    H-->>UI: Approved plan shown; timeline updated
    Note over UI,O: Simulated event: "Block Road A"
    UI->>O: Change detected → replan
    O->>P: New plan; previous plan marked SUPERSEDED
    P->>H: New plan submitted for review
    H-->>UI: Old vs new plan, side by side
```

## How it works

- **3 AI agents + orchestrator** — Risk Assessment (`src/lib/agents/risk-assessment`), Resource & Routing (`src/lib/agents/resource-routing`), Response Planning (`src/lib/agents/response-planning`), run by the pipeline in `src/lib/orchestrator/` (`pipeline.ts`, `orchestrator.ts`, `schema.ts`, `persistence.ts`).
- **Human-in-the-loop approval** — plans go through submit → approve / reject / modify → status → execute, in `src/lib/human-approval/`. The live demo states it plainly: *"AI analyzes and recommends. Human coordinators authorize execution."*
- **Dynamic replanning** — `src/lib/replanning/` + `src/lib/change-detection/`; road blocks, hospital overload and similar events trigger fresh plans. A superseded plan is recorded as `SUPERSEDED`.
- **Gemini-powered, with a deterministic fallback** — `src/lib/ai/gemini.ts` (server-only) lists three models — `gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-2.5-flash` — with a 25s default timeout (30s max) and structured JSON validated by Zod schemas. The deterministic fallback (`src/lib/agents/deterministic-fallback.ts`) means the demo runs fully without an API key.
- **What-if simulation** — `src/lib/what-if/` + `/api/demo/what-if`: explore a changed situation without affecting the active emergency (visible on the live demo as "What-if simulation").
- **Maps & charts** — Leaflet operational map (schematic, 500 m scale) and Recharts resource/capacity views.
- **Supabase persistence (optional)** — plan submit/approve/reject/modify/status flows; the deterministic demo runs fully in-memory without it. Migrations `0001`–`0005` in `supabase/migrations/` plus `seed.sql`.

## Data flow

```mermaid
flowchart LR
    Coord([Coordinator]) --> UI["Next.js command-center UI<br/>src/app/page.tsx"]
    UI --> API["API routes<br/>/api/demo/ai-workflow<br/>/api/demo/what-if<br/>/api/emergency/plans"]
    API --> Orch["Orchestrator pipeline<br/>src/lib/orchestrator/"]
    Orch --> Risk["Risk Assessment agent"]
    Orch --> Res["Resource & Routing agent"]
    Orch --> Plan["Response Planning agent"]
    Risk --> Gemini["Gemini<br/>3-model list · Zod JSON"]
    Res --> Gemini
    Plan --> Gemini
    Gemini --> Fallback["Deterministic fallback<br/>no API key needed"]
    Plan --> Approval["Human approval<br/>approve / reject / modify"]
    Approval --> Store["State<br/>in-memory demo · Supabase optional"]
    Event["Simulated event<br/>e.g. Block Road A"] --> Detect["Change detection"]
    Detect --> Orch
    Orch --> Replan["Live replanning<br/>old plan SUPERSEDED"]
    UI --> Map["Leaflet map · Recharts<br/>timeline · decision trace"]
```

State is modelled as a versioned emergency state (`src/domain/` — incident, resource, facility, route, response-plan, plan-action, agent-run, human-decision, state-change, emergency-state, what-if), so every replan leaves an audit trail in the situation timeline.

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16.3.8 (App Router, pinned) · React 19.2.8 · TypeScript 5 |
| Styling | Tailwind CSS v4 · shadcn/ui (`components.json`) · Base UI React 1.8.0 · lucide-react 1.49.0 |
| AI | `@google/genai` 2.25.0 (Gemini, server-only) · Zod 4.6.5 for structured output |
| Maps & charts | Leaflet 1.9.4 · react-leaflet 5.0.0 · Recharts 3.10.1 |
| Data | Supabase JS 2.117.2 (optional persistence) · 5 SQL migrations |
| Scripts | `dev` · `build` · `start` · `lint` (no test script) |

## Project structure

```text
cupric2026/                          # wrapper repo — README + app folder only
└── react-emergency-coordination/    # the application (deploy root)
    ├── src/
    │   ├── app/                     # page.tsx, layout.tsx, globals.css, api/
    │   │   └── api/                 # demo/ai-workflow, demo/what-if, emergency/plans
    │   ├── components/
    │   │   ├── react/               # command-center components (data/)
    │   │   └── ui/                  # shadcn/ui primitives
    │   ├── domain/                  # incident, resource, facility, route, response-plan,
    │   │                            # plan-action, agent-run, human-decision, state-change,
    │   │                            # emergency-state, what-if
    │   └── lib/
    │       ├── agents/              # risk-assessment, resource-routing, response-planning,
    │       │                        # auto-ai-workflow, deterministic-fallback
    │       ├── ai/                  # gemini.ts, gemini-contract.ts
    │       ├── orchestrator/        # pipeline, orchestrator, schema, persistence, errors
    │       ├── human-approval/  replanning/  change-detection/  simulation/
    │       ├── emergency-engine/  emergency-state/  demo/  what-if/  config/
    │       └── supabase/            # Supabase client/services
    ├── supabase/
    │   ├── migrations/              # 0001_initial_react_schema → 0005_response_plan_relation_completeness
    │   └── seed.sql
    ├── scripts/                     # 16 demo/reliability fixture files (*-fixture.ts/.mjs)
    ├── .env.example
    └── package.json
```

## Getting started

```bash
cd react-emergency-coordination
npm install
npm run dev      # http://localhost:3000
npm run build
npm run lint
```

### Environment variables

```bash
# Live agent calls only — the demo works without it (deterministic fallback)
GEMINI_API_KEY=<redacted>

# Persistence only — the demo runs in-memory without these
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

For persistence, apply the migrations in `supabase/migrations/` in order (`0001` → `0005`), then seed incident, resource, facility, route, agent-run and response-plan data using the existing schemas.

## Screenshots

No screenshots are checked into this repo yet — there is no `public/` or `assets/` folder. Capture them from the live demo: the command-center header (incident, severity, state version), the operational map, the agent activity panel, and a before/after replanning view.

## Honest limits

- **Prototype, not a production system.** Demo data is fictional; the map is schematic, not live geographic data.
- **No coordinator auth or row-level security.** The migrations do not configure RLS policies or coordinator authentication — do not expose the database APIs publicly until access policies appropriate to the deployment are configured (stated in `react-emergency-coordination/README.md`). No live Supabase connection has been verified by this repo.
- **Schema history gaps** (also stated in the app README): `state_changes` has no incident foreign key, so incident history queries can only load rows recorded against the incident itself; replanning marks a previous plan `SUPERSEDED` but has no dedicated supersedes-plan relationship column.
- **No test suite** — `package.json` has `lint` only; `scripts/` holds demo/reliability fixtures, not a test runner. No CI workflow in the repo.
- **Field-team features are out of scope** — no mobile app, push alerts, or field report-back; this is a command-center decision-support prototype.
- **Gemini model availability is not guaranteed here** — the client lists `gemini-3.8-flash`, `gemini-3.7-flash` and `gemini-2.5-flash`; which models answer on the live API was not verified in this repo.

## Judging note

Framed as a **command-center decision-support prototype**: strongest fit for command centers and disaster-management authorities (human approval is the key card); field-team features (mobile, push alerts, field report-back) are out of scope for the prototype.
