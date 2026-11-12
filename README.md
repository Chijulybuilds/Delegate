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
| **Landing page** | Milk/light-grey studio look in Inter Tight. One persistent motion carries the whole page: a photographed hand presenting a Delegate-branded coffee cup rises in the hero, then travels with the scroll. In *How it works* the cup itself changes colour, keeping the photo's lighting, and its printed ticket steps through Open → In progress → Executed → Audited ✓. It comes back blue for the final call to action. Respects `prefers-reduced-motion`. |
| **Workspace app** (`/app`) | Six simple pages:<br>**Today**: the board, plus four "what needs me" numbers that double as filters.<br>**Activity**: the live feed.<br>**Insights**: Velocity Pulse and Standup-in-a-Box.<br>**Playbooks**: recurring checklists.<br>**Team**.<br>**Settings**: tabs, with staff only seeing what they can act on.<br>Plus task numbers (`DLG-12`), proof of work (link, note, file, Google Drive), a chat thread per task, Blocker Ping, and a notification bell. |
| **Billing** | **Stripe** (per-seat, cards worldwide, auto seat sync, customer portal) and **Paystack** (₦ cards, bank transfer, USSD). 14-day Team trial, Starter/Team/Enterprise entitlements, webhook-driven subscriptions. |
| **Channels** | **Slack** (OAuth install, channel notifications, `/delegate`, message → task shortcut), **Microsoft Teams** (Adaptive Cards via Workflows, `@Delegate` commands via outgoing webhook) and **WhatsApp** (templates, phone linking, quick replies and a one-tap **Start**). One command language everywhere: `new … @tunde tomorrow !high`, `list`, `start/done/block DLG-12`. |
| **Automations** | Escalation ladder: blocked work alerts managers after 4 h and the owner after 24 h. Overdue alerts, recurring playbooks, and an 8 AM morning brief per time zone, all run by one idempotent cron tick. |
| **Automatic proof** | **GitHub**: a merged PR or a `fixes DLG-12` commit turns the task green with verified proof. **Google Drive**: a picked Doc/Sheet is checked with Google (edited by the assignee, after the task started). |
| **Platform console** (`/admin`) | Reached only by typing the URL, with its own credentials and token. Platform KPIs, workspaces (plan, billing status and seats, suspend or reactivate), users (suspend or restore) and the global ledger. |
| **API** (Node + TypeScript + Express 5) | The task state machine is enforced on the server, managers can't audit their own work, tenant isolation, an append-only ledger, signature-verified webhooks with replay protection, secrets encrypted at rest (AES-256-GCM), and optional AI proof verification (Claude). |
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

In demo mode, payments, Slack, WhatsApp and GitHub are **simulated**, so you can click through checkout, the WhatsApp simulator and playbooks without any accounts.

| Next step | Guide |
|---|---|
| Real Google sign-in and database: Supabase + Google Cloud | **[docs/SETUP.md](docs/SETUP.md)** |
| Stripe, Paystack, Slack, Teams, WhatsApp, GitHub, Resend, Anthropic | **[docs/INTEGRATIONS.md](docs/INTEGRATIONS.md)** |
| Go live on **Vercel** (or a Hostinger VPS), the scheduler, the go-live checklist | **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Web (Vite, :3000, hot reload) + API (:4000, watch mode). Vite proxies `/api`. |
| `npm run build` | Builds the API (tsup) and the web app (Vite). |
| `npm start` | Production server on :3000 serving the API **and** the built app (Hostinger/VPS). On Vercel the same API runs as `api/index.mjs`. |
| `npm test` | API integration tests (Vitest + Supertest). |
| `npm run test:e2e` | Builds, then runs the Playwright end-to-end suite against production (desktop + mobile). |
| `npm run typecheck` | TypeScript across shared, API and web. |
| `npm run admin:hash -- "<password>"` | bcrypt hash for `ADMIN_PASSWORD_HASH`. |

## Architecture

```
apps/
  web/        React 19 · Vite 7 · Tailwind CSS 4 · Motion · TanStack Query · React Router
    src/landing/   LandingPage, CupStage (scroll engine), PhotoCup (photo + live cup colour), BoardPreview
    src/app/       AppShell, Board, TaskDrawer, Activity, Insights, Playbooks, Team, Settings (tabs)
    src/admin/     AdminRoot: separate login + console
  api/        Node · Express 5 · TypeScript · Zod · jose · supabase-js · stripe
    src/routes/    public · workspace · saas (billing, integrations, playbooks) · hooks (webhooks) · admin · cron
    src/services/  workspace (state machine) · billing · notify · channels · commands · integrations
                   automation (escalations, playbooks, digest) · drive · metrics · admin · ai · mail
    src/store/     Store interface → MemoryStore (demo/tests) | SupabaseStore (production)
    src/vercel.ts  Serverless entry (bundled to dist/vercel.js)
api/index.mjs Vercel function: re-exports the bundled Express app
packages/
  shared/     The domain contract: statuses, transitions, permissions, plans, API types
supabase/
  migrations/ Schema, RLS, ledger immutability, storage, realtime, SaaS tables
  cron.sql    pg_cron job that calls /api/cron/tick every 10 minutes
e2e/          Playwright specs (landing, workspace loop, SaaS layer, admin, mobile)
scripts/
  hero-photo/ process.py: turns the source photo into the hero assets (see below)
```

## The hero photo

`scripts/hero-photo/process.py` turns `scripts/hero-photo/source.jpg` (a hand-holding-a-cup mockup photo) into the assets in `apps/web/src/landing/assets/`. It:

- cuts the hand and cup out of the studio background, with clean edges
- re-tones the hand to a deep brown skin tone, keeping the photo's own light and shadow
- removes the mockup's original printing and rebuilds the cup as a clean, lit cylinder
- exports a cup mask and a lighting map

In the browser, `PhotoCup` then fills the cup with the current state colour, prints the Delegate design on it, and lays the photo's lighting back on top. The fingers stay in front of the print.

To use a sharper or different photo of the same shot, replace `source.jpg` (higher resolution looks better) and run:

```bash
python3 scripts/hero-photo/process.py
```

It needs Python 3.9+ with `numpy` and `pillow`.

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

- ✅ 42 API tests and 31 Playwright end-to-end tests pass against the production build
- ✅ Both Supabase migrations checked on PostgreSQL 16: they re-run cleanly, users only see their own workspace, browsers can't write, and the activity log can't be edited or deleted
- ✅ Vercel entry verified locally: health, cron auth, and webhook signatures with `NODEJS_HELPERS=0`; a loud failure without it
- ⏳ Live providers need your keys: follow SETUP.md → INTEGRATIONS.md → DEPLOYMENT.md
