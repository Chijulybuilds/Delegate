# Delegate

**The high-tempo execution engine for lean teams.** Assign work at 8 AM, watch every ticket move from red to green in real time, and audit it with proof. No chasing, no status meetings.

```
 Open (Red) ──start──▶ In progress (Amber) ──submit + proof──▶ Executed (Green) ──audit──▶ Audited (Blue ✓)
     │                       ▲     │                                  │
     └──flag──▶ Blocked ─────┘     └──flag──▶ Blocked                 └──request changes──▶ In progress
```

## What's inside

| Area | Highlights |
|---|---|
| **Landing page** | Milk/light-grey studio look in Inter Tight. One persistent motion carries the whole page: a suited hand presenting a Delegate coffee cup rises in the hero, then travels with the scroll. In *How it works* its sleeve and order ticket step through Open → In progress → Executed → Audited ✓. It comes back blue for the final call to action. Respects `prefers-reduced-motion`. |
| **Workspace app** (`/app`) | Live board with four lanes, department and person filters, and quick actions; task drawer with proof of work (link, note, file), a chat thread per task and the activity history; **Heartbeat** feed; **Velocity Pulse** (red → green time, on-time rate, leaderboard); **Standup-in-a-Box**; **Blocker Ping** banner; team, roles and invite codes. |
| **Platform console** (`/admin`) | Reached only by typing the URL, with its own credentials and token. Platform KPIs, workspaces (plan, suspend or reactivate), users (suspend or restore) and the global ledger. |
| **API** (Node + TypeScript + Express 5) | The task state machine is enforced on the server, managers can't audit their own work, tenant isolation, an append-only ledger, optional AI proof verification (Claude), a standup cron and Resend email. |
| **Supabase** | Postgres schema with RLS (users can read only their own workspace, the browser can never write), a ledger that rejects edits and deletes, a private proof-file bucket, Realtime, and an automatic profile on Google sign-in. |

## Quick start

```bash
npm install
```

```bash
npm run dev
```

Then open **http://localhost:3000**. It runs immediately in **demo mode** with a seeded workspace. Sign in as any persona, or open `/admin` with `admin@delegate.local` / `delegate-admin` (dev only).

To run the production build locally:

```bash
npm run build
```

```bash
npm start
```

That serves http://localhost:3000 as a single Node process, the same way it runs in production.

When you're ready for real Google sign-in and a real database, follow **[docs/SETUP.md](docs/SETUP.md)** (Supabase plus the Google Cloud OAuth client). To go live, see **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** (Hostinger VPS, Render or Railway; or Vercel with an API host).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Web (Vite, :3000, hot reload) + API (:4000, watch mode). Vite proxies `/api`. |
| `npm run build` | Builds the API (tsup) and the web app (Vite). |
| `npm start` | Production server on :3000 serving the API **and** the built app. |
| `npm test` | API integration tests (Vitest + Supertest). |
| `npm run test:e2e` | Builds, then runs the Playwright end-to-end suite against production (desktop + mobile). |
| `npm run typecheck` | TypeScript across shared, API and web. |
| `npm run admin:hash -- "<password>"` | bcrypt hash for `ADMIN_PASSWORD_HASH`. |

## Architecture

```
apps/
  web/        React 19 · Vite 7 · Tailwind CSS 4 · Motion · TanStack Query · React Router
    src/landing/   LandingPage, CupStage (scroll engine), HandCup (SVG), BoardPreview
    src/app/       AppShell, Board, TaskDrawer, Heartbeat, Velocity, Standup, Team, Settings
    src/admin/     AdminRoot: separate login + console
  api/        Node · Express 5 · TypeScript · Zod · jose · supabase-js
    src/routes/    public (config, auth, onboarding) · workspace · admin · cron
    src/services/  workspace (state machine) · metrics (velocity, standup) · admin · ai · mail
    src/store/     Store interface → MemoryStore (demo/tests) | SupabaseStore (production)
packages/
  shared/     The domain contract: statuses, transitions, permissions, API types
supabase/
  migrations/ Schema, RLS, ledger immutability, storage bucket, realtime
e2e/          Playwright specs (landing, workspace loop, admin, mobile)
```

**Auth model.** Customers sign in with Google through Supabase Auth. The browser sends the Supabase access token to the API, which verifies it (JWKS, the legacy shared secret, or a call to Supabase as a fallback), loads the profile and membership, and enforces roles. Platform operators use `/admin` with separate credentials and a separately signed token. Neither kind of token works on the other side.

**Why a Store abstraction?** The same services run on an in-memory store (instant local demo, fast deterministic tests) and on Supabase in production. Business rules live in one place: `apps/api/src/services`.

**Permissions** (shared by the UI and the API):

| Action | Who |
|---|---|
| Assign tasks to others, edit, reassign | Owner, Manager |
| Create a task for yourself | Everyone |
| Start · Flag blocker · Unblock | Assignee or a manager |
| Submit proof (→ Green) | Assignee only, at least one proof |
| Approve (→ Blue) · Request changes | Owner or manager, but not on their own work (the owner is exempt) |
| Change roles | Owner |

## Status

- ✅ 17 API tests and 23 Playwright end-to-end tests pass against the production build
- ✅ Supabase migration checked on PostgreSQL 16: it re-runs cleanly, users only see their own workspace, browsers can't write, and the activity log can't be edited or deleted
- ⏳ Live Supabase and Google OAuth need your project keys (see SETUP.md)
