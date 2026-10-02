This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Supabase persistence

The dashboard's deterministic demo remains in-memory and can run without Supabase. Server-side emergency-state loading and the plan submit/approve/reject/modify/status and execute APIs use the existing Supabase services when configured. To enable those paths:

1. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local`. Do not put a service-role key in browser-visible configuration.
2. Apply migrations `0001_initial_react_schema.sql` through `0005_response_plan_relation_completeness.sql` in order, using the Supabase CLI or SQL editor.
3. Seed or create incident, resource, facility, route, agent-run, and response-plan data using the existing schemas.

`GEMINI_API_KEY` is server-only and is needed only for live Gemini agent calls; it is not needed for the deterministic demo or Supabase persistence. The current migrations do not configure row-level security policies or coordinator authentication; do not expose the database APIs publicly until access policies appropriate to the deployment are configured. No live Supabase connection has been verified by this repository change.

The current schema has two history limitations: `state_changes` has no incident foreign key, so incident history queries can only load rows recorded against the incident itself; replanning records a previous plan as `SUPERSEDED` but has no dedicated supersedes-plan relationship column.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
