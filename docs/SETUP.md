# Setup guide

This walks you from a fresh clone to Google sign-in on a real Supabase database. You can stop after step 1: the app runs fully on `localhost:3000` in **demo mode** with a seeded workspace, before you configure anything.

---

## 1. Run it locally (2 minutes, no accounts needed)

Requirements: **Node.js 20.19+** (22 LTS recommended) and npm 10.

```bash
npm install
```

```bash
npm run dev
```

Open **http://localhost:3000**.

| What | Where |
|---|---|
| Landing page | `http://localhost:3000/` |
| Customer sign-in | `http://localhost:3000/login`: pick a demo persona (owner, manager or staff) or start a fresh workspace |
| Workspace app | `http://localhost:3000/app` |
| Platform admin console | `http://localhost:3000/admin`: dev credentials `admin@delegate.local` / `delegate-admin` (dev only, refused in production) |

`npm run dev` runs two processes: Vite on **:3000** (hot reload) and the API on **:4000**. Vite proxies `/api` to the API, so the browser only ever talks to `localhost:3000`.

To run the **production build** exactly as it will be deployed (one Node process serving both the app and the API):

```bash
npm run build
```

```bash
npm start
```

That also serves **http://localhost:3000**.

Demo data lives in memory and resets when the API restarts.

---

## 2. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → **New project**. Pick the region closest to your users.
2. Open **SQL Editor → New query**, paste the contents of [`supabase/migrations/20261112000000_init.sql`](../supabase/migrations/20261112000000_init.sql) and **Run**.
   *(With the Supabase CLI instead: `supabase link --project-ref <ref>` then `supabase db push`.)*

   This creates:
   - tables: `profiles`, `organizations`, `departments`, `memberships`, `tasks`, `task_proofs`, `task_comments`, `task_events`
   - a trigger that creates a `profiles` row for every new Google sign-in
   - **Row Level Security** on every table: signed-in users can *read* only their own workspace; nobody can write from the browser (the API does all writes with the service key)
   - an **append-only ledger**: `task_events` rejects UPDATE, DELETE and TRUNCATE, even from the service role. The only exception is `public.purge_organization(id)`, for deliberate tenant deletion.
   - a private Storage bucket `proofs` (10 MB per file) for proof-of-work files
   - Realtime on `task_events`, so boards update instantly
3. Open **Project Settings → API Keys** (or **API** on older projects) and copy:
   - **Project URL** → `SUPABASE_URL`
   - **Publishable / anon key** → `SUPABASE_ANON_KEY` (safe for the browser)
   - **Secret / service_role key** → `SUPABASE_SERVICE_ROLE_KEY` (**server only**: never commit it or put it in a `VITE_` variable)
4. Session tokens: new projects sign them with asymmetric keys, and the API verifies these automatically through the project's JWKS. On a legacy project that uses the shared JWT secret, you can also set `SUPABASE_JWT_SECRET`, which lets the API verify tokens locally without a network call. This is optional.
5. Open **Authentication → URL Configuration**:
   - **Site URL**: `http://localhost:3000` for now (change it to your production URL when you deploy)
   - **Redirect URLs**: add `http://localhost:3000/auth/callback` and, later, `https://YOUR-DOMAIN/auth/callback`

---

## 3. Create the Google OAuth client (Google Cloud Console)

1. Open [console.cloud.google.com](https://console.cloud.google.com) → create a project, e.g. **Delegate**.
2. Go to **APIs & Services → OAuth consent screen** (shown as **Google Auth Platform** in newer consoles):
   - **Branding**: app name *Delegate*, support email, logo. Under **Authorized domains** add your production domain and `YOUR-PROJECT-REF.supabase.co`.
   - **Audience**: *External*. While it is in *Testing*, only the test users you list can sign in. **Publish** the app before launch.
   - **Data access**: the scopes `openid`, `.../auth/userinfo.email` and `.../auth/userinfo.profile` are all Delegate needs.
3. **Clients → Create client → Web application**:
   - **Authorized JavaScript origins**: `http://localhost:3000` and `https://YOUR-DOMAIN`
   - **Authorized redirect URIs**: the callback URL shown in Supabase under **Authentication → Sign In / Providers → Google**. It looks like `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`.
4. Copy the **Client ID** and **Client secret** into **Supabase → Authentication → Sign In / Providers → Google**, enable it and save.

Flow: the browser goes to Google, then to Supabase (`/auth/v1/callback`), then back to `/auth/callback` in Delegate. Delegate's API then verifies the Supabase session token on every request.

---

## 4. Point the app at Supabase

```bash
cp .env.example .env
```

Fill in at least:

```dotenv
SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

ADMIN_EMAIL=you@yourcompany.com
ADMIN_PASSWORD_HASH=...      # generate below
ADMIN_JWT_SECRET=...         # long random string
```

Generate the admin password hash and a signing secret:

```bash
npm run admin:hash -- "a-long-unique-admin-password"
```

```bash
openssl rand -hex 32
```

Restart `npm run dev`. The sign-in page now shows a working **Continue with Google** button, and the demo personas disappear. Data is stored in Supabase.

---

## 5. The admin console (`/admin`)

- It is **not linked from anywhere**: not the landing page, not sign-in, not the app. Operators reach it by typing `/admin`.
- It uses **separate credentials** (`ADMIN_EMAIL` + bcrypt `ADMIN_PASSWORD_HASH`) and a **separate signing secret** (`ADMIN_JWT_SECRET`, 8-hour tokens, kept in `sessionStorage`). A customer's Google session can never open it, and an admin token can never act inside a customer workspace. The E2E tests check both directions.
- Logins are rate limited to 10 attempts per 15 minutes per IP, and the page carries `noindex`.
- In production the server refuses to start admin with a plain-text password: it must be the hash.

---

## 6. Optional integrations

| Feature | Env | Notes |
|---|---|---|
| **AI proof verification** | `ANTHROPIC_API_KEY` (and optionally `AI_MODEL`, default `claude-opus-5-5`) | When a task is submitted, Claude compares the proof with the brief and attaches an advisory verdict (looks complete, needs a look, doesn't match). Managers still make the final call. If the AI call fails, the submission still goes through. |
| **8:00 AM Standup-in-a-Box email** | `RESEND_API_KEY`, `MAIL_FROM`, `CRON_SECRET` | Schedule `POST /api/cron/standup` with header `x-cron-secret: <CRON_SECRET>` (crontab, Vercel Cron or any scheduler). The brief is always visible on the **Standup** page, even without email. |

Example crontab (server time zone):

```cron
0 8 * * 1-5 curl -fsS -X POST -H "x-cron-secret: YOUR_CRON_SECRET" https://YOUR-DOMAIN/api/cron/standup
```

---

## 7. Tests

```bash
npm test
```

runs the API suite: the state machine, permissions, tenant isolation, admin separation and cron.

```bash
npx playwright install chromium
```

is needed once per machine before the end-to-end tests.

```bash
npm run test:e2e
```

builds production, starts it on `:3100` with a fresh demo workspace, and runs the browser tests: the landing page and its cup animation, the full Red → Amber → Green → Blue loop, blockers, chat, filters, onboarding, invite codes and the admin console, on desktop and mobile.
