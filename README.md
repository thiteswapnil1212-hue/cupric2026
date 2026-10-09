# CuriousPARC 2026 — Adaptive Emergency Response Intelligence

Built for **CuriousPARC 2026** (national hackathon): a command-center decision-support prototype where AI agents draft emergency response plans, a human approves them, and the system **replans live** when the situation changes.

**Live demo:** https://cupriouspark.vercel.app/

## The demo flow

Urban high-rise fire scenario (INC-2026-001) → agents generate an initial response plan → simulated event ("Block Road A") → agents replan in real time → old plan vs new plan, side by side, with an activity timeline.

## How it works

- **3 AI agents + orchestrator** — Risk Assessment, Resource & Routing, Response Planning
- **Human-in-the-loop approval** — nothing executes without coordinator sign-off
- **Dynamic replanning** — road blocks, hospital overload and similar events trigger fresh plans
- **Gemini-powered** with a deterministic fallback so the demo runs without an API key
- **Maps & charts** — Leaflet incident maps, Recharts resource views
- **Supabase persistence** (optional) — plan submit/approve/reject/modify/status flows; the deterministic demo runs fully in-memory without it

## Tech stack

Next.js 16 · React 19 · TypeScript · Tailwind CSS v4 · Gemini (`@google/genai`) · Supabase · Leaflet / react-leaflet · Recharts · Zod

## Project structure

```
react-emergency-coordination/   # the application (this is the deploy root)
├── src/
├── supabase/                   # migrations 0001–0005
├── scripts/
└── .env.example
```

## Getting started

```bash
cd react-emergency-coordination
npm install
npm run dev      # http://localhost:3000
```

For live agent calls, set `GEMINI_API_KEY` (server-only) in `.env.local` — the demo works without it via the deterministic fallback. For persistence, set `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` and apply the migrations in `supabase/` in order. Do not expose the database APIs publicly until row-level security and coordinator auth are configured.

## Judging note

Framed as a **command-center decision-support prototype**: strongest fit for command centers and disaster-management authorities (human approval is the key card); field-team features (mobile, push alerts, field report-back) are out of scope for the prototype.
