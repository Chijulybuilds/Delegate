# Setup guide

This takes you from a fresh clone to a real product: Google sign-in, a Supabase database, payments, chat apps and automations. You can stop after step 1. The whole app, including billing, Slack, WhatsApp and playbooks, runs on `localhost:3000` in **demo mode**, with every provider simulated, before you create a single account.

| Guide | What it covers |
|---|---|
| **This file** | Local run, Supabase, Google Cloud (sign-in + Drive), admin console, tests |
| [INTEGRATIONS.md](INTEGRATIONS.md) | Stripe, Paystack, Slack, Microsoft Teams, WhatsApp, GitHub, Resend, Anthropic |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Vercel (recommended), the automation scheduler, the go-live checklist, Hostinger |

## Accounts you will need

| Service | Needed for | Required? | Cost to start |
|---|---|---|---|
| Supabase | Database, Google sign-in, file storage | **Yes** | Free tier |
| Google Cloud | "Continue with Google", Drive proof | **Yes** (sign-in) | Free |
| Vercel | Hosting the app + API | **Yes** (or Hostinger) | Free (Hobby) |
| Stripe | Card payments worldwide | One of Stripe / Paystack | Per transaction |
| Paystack | ₦ cards, bank transfer, USSD | One of Stripe / Paystack | Per transaction |
| Slack | Slack notifications + `/delegate` | Optional | Free |
| Microsoft Teams | Teams notifications + `@Delegate` | Optional | Free (uses your Microsoft 365) |
| Meta (WhatsApp) | WhatsApp tasks, reminders, quick actions | Optional | Per message (Meta pricing) |
| GitHub | Auto-proof from merged PRs | Optional | Free |
| Resend | Morning brief by email | Optional | Free tier |
| Anthropic | AI proof checks | Optional | Pay as you go |

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
| Customer sign-in | `http://localhost:3000/login`: pick a demo persona (Ada = owner, Kemi = manager, Tunde = staff) or start a new workspace |
| Workspace app | `http://localhost:3000/app` |
| Platform admin console | `http://localhost:3000/admin`: dev credentials `admin@delegate.local` / `delegate-admin` (dev only, refused in production) |

Try these in demo mode:

- **Settings → Billing:** start a new workspace (it gets a 14-day Team trial), click **Upgrade**, then complete the simulated checkout.
- **Settings → Integrations:**
  - Click **Add to Slack**. It connects a simulated Slack workspace.
  - Switch WhatsApp on and use the **simulator**: `list`, `new Restock paper @Tunde tomorrow !high`, `start DLG-20`.
  - **Recent deliveries** shows every message that would have gone out.
- **Playbooks:** create a recurring checklist and press **Run now**.
- **Settings → Automations:** press **Run checks now** to fire escalations and overdue alerts.

`npm run dev` runs Vite on **:3000** (hot reload) and the API on **:4000**. Vite proxies `/api` to the API, so the browser only ever talks to `localhost:3000`. The production build is one Node process, exactly as deployed:

```bash
npm run build
```

```bash
npm start
```

Demo data lives in memory and resets when the API restarts.

---

## 2. Supabase (database, sign-in, storage)

1. Go to [supabase.com](https://supabase.com) → **New project**. Pick the region closest to your users (e.g. *West EU (Ireland)* or *Frankfurt* for Nigeria). Save the database password somewhere safe.
2. Open **SQL Editor → New query** and run the two migrations **in order**. Paste each file and press **Run**:
   1. [`supabase/migrations/20261112000000_init.sql`](../supabase/migrations/20261112000000_init.sql): workspaces, tasks, the append-only ledger, Row Level Security, the `proofs` storage bucket, and Realtime.
   2. [`supabase/migrations/20261113000000_saas.sql`](../supabase/migrations/20261113000000_saas.sql): task numbers (`DLG-12`), subscriptions, integrations, notifications, playbooks, escalation fields and the webhook de-duplication table.

   *(With the Supabase CLI instead: `supabase link --project-ref <ref>` then `supabase db push`.)*
3. Open **Project Settings → API Keys** and copy:
   - **Project URL** → `SUPABASE_URL`
   - **Publishable key** (or legacy *anon*) → `SUPABASE_ANON_KEY`
   - **Secret key** (or legacy *service_role*) → `SUPABASE_SERVICE_ROLE_KEY`. This one is **server only**: never commit it or put it in a `VITE_` variable.
4. Open **Authentication → URL Configuration**:
   - **Site URL**: `http://localhost:3000` for now, then your production URL at launch.
   - **Redirect URLs**: add `http://localhost:3000/auth/callback` now, and `https://YOUR-DOMAIN/auth/callback` when you deploy.
5. Open **Authentication → Sign In / Providers → Google**. Leave this page open: step 3 gives you the Client ID and secret to paste here, and this page shows the **Callback URL** you need in Google.
6. **Storage**: nothing to do. The migration created the private `proofs` bucket (10 MB per file). Proof files go straight from the browser to Storage through signed upload URLs, so the API never handles large uploads.
7. **Database → Extensions**: enable **pg_cron** and **pg_net**. The automation scheduler uses them after you deploy (see [DEPLOYMENT.md](DEPLOYMENT.md#3-turn-on-the-automation-scheduler)).

### Email and password sign-in

People can sign up and log in with an email and password as well as with Google. Supabase sends the two emails involved: *confirm your address* and *reset your password*.

1. **Authentication → Sign In / Providers → Email**:
   - Leave **Enable Email provider** on.
   - Keep **Confirm email** on, so nobody can sign up with someone else's address.
   - Set **Minimum password length** to `8`, the same as the app.
2. **Authentication → URL Configuration → Redirect URLs**: next to the `/auth/callback` entries, add:
   - `http://localhost:3000/auth/reset`
   - `https://YOUR-DOMAIN/auth/reset`
3. **Custom SMTP (required before real users sign up).** Supabase's built-in sender only delivers to your own team's addresses, and only a few emails an hour. Send through [Resend](https://resend.com) (free tier):
   1. In Resend, go to **Domains → Add domain**, add the DNS records it shows, and wait for **Verified**.
   2. Under **API Keys → Create**, choose *Sending access*.
   3. In Supabase → **Authentication → Emails → SMTP Settings**, turn on **Enable custom SMTP** and fill in:

      | Field | Value |
      |---|---|
      | Host | `smtp.resend.com` |
      | Port | `465` |
      | Username | `resend` |
      | Password | your Resend API key |
      | Sender email | e.g. `no-reply@yourdomain.com` |
      | Sender name | `Delegate` |
   4. Under **Authentication → Rate Limits**, raise *emails sent per hour* (e.g. to 100).
4. **Email templates (recommended).** With these, the links work on any device, not only in the browser where someone signed up. Go to **Authentication → Emails → Templates**:
   - **Confirm signup**, link:
     ```html
     <a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email">Confirm your email</a>
     ```
   - **Reset Password**, link:
     ```html
     <a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery">Choose a new password</a>
     ```

   Keep your own wording around the links. With the default templates the links still work, but only when opened in the same browser.

Flow:
- **Sign up:** email + password → *Check your inbox* → the link confirms the address, signs the person in and opens onboarding.
- **Log in:** email + password, with **Forgot password?** → email → `/auth/reset` → new password → the board.

> Token verification: new projects sign sessions with asymmetric keys, which the API verifies automatically through the project's JWKS. Legacy projects that use a shared JWT secret can also set `SUPABASE_JWT_SECRET` (optional).

---

## 3. Google Cloud Console (sign-in + Drive proof)

Use **one** Google Cloud project for both.

### 3a. "Continue with Google" (required)

1. Open [console.cloud.google.com](https://console.cloud.google.com) → project picker → **New project** → name it *Delegate* → **Create**.
2. Go to **APIs & Services → OAuth consent screen**. Newer consoles call it **Google Auth Platform**. Click **Get started**:
   - **App information**: app name *Delegate*, your support email.
   - **Audience**: *External*.
   - **Contact information**: your email → **Create**.
3. Under **Branding**:
   - Upload a logo (optional).
   - Add your home page, privacy policy and terms URLs (required before publishing).
   - **Authorized domains**: add your production domain (e.g. `yourdomain.com` or `your-app.vercel.app`) and `supabase.co`.
4. Under **Data access → Add or remove scopes**, tick:
   - `openid`
   - `.../auth/userinfo.email`
   - `.../auth/userinfo.profile`
   - `.../auth/drive.file` (only if you will use Drive proof; it is a *non-sensitive* scope, so no Google security review is needed)

   Then **Update** → **Save**.
5. Under **Clients → Create client**, choose **Web application**, name it *Delegate web*, then add:
   - **Authorized JavaScript origins**: `http://localhost:3000` and `https://YOUR-DOMAIN`
   - **Authorized redirect URIs**: the **Callback URL** from Supabase (step 2.5). It looks like `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`.

   Press **Create**, then copy the **Client ID** and **Client secret**.
6. Paste them into **Supabase → Authentication → Sign In / Providers → Google**, enable it and save.
7. Under **Audience**: while the app is in *Testing*, only the test users you add can sign in. Click **Publish app** before launch. With only the scopes above, publishing does not need a Google review. Brand verification takes a few days if Google asks for it.

Flow: browser → Google → Supabase (`/auth/v1/callback`) → Delegate (`/auth/callback`). The API verifies the Supabase token on every request.

### 3b. Google Drive proof (optional, recommended)

Assignees can attach a Google Doc, Sheet or Slides file as proof. Delegate checks with Google that the assignee actually edited it after the task started, and shows a **Verified** badge.

1. Go to **APIs & Services → Library** and enable **Google Drive API** and **Google Picker API**.
2. Go to **APIs & Services → Credentials → Create credentials → API key** and copy the key. Then click **Edit API key**:
   - **Application restrictions → Websites**: add `http://localhost:3000/*` and `https://YOUR-DOMAIN/*`.
   - **API restrictions → Restrict key**: tick **Google Picker API** and **Google Drive API** → **Save**.
3. Find the **Project number** on the Cloud **Dashboard** (or ⋮ → Project settings). It is a number, not the project ID.
4. Set:

   ```dotenv
   GOOGLE_CLIENT_ID=<the Web client ID from 3a — the same client works>
   GOOGLE_API_KEY=<the restricted API key>
   GOOGLE_PROJECT_NUMBER=<project number>
   ```

When it is on, **Submit proof** shows **Pick from Google Drive**. The file is checked on the server: it must have been modified after the task started, by the assignee (or a workspace owner).

---

## 4. Environment file and admin console

```bash
cp .env.example .env
```

Minimum for a real (non-demo) setup:

```dotenv
SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

APP_ENCRYPTION_KEY=...       # openssl rand -hex 32  (never change it after launch)
CRON_SECRET=...              # openssl rand -hex 24

ADMIN_EMAIL=you@yourcompany.com
ADMIN_PASSWORD_HASH=...      # npm run admin:hash -- "a-long-unique-admin-password"
ADMIN_JWT_SECRET=...         # openssl rand -hex 32
```

```bash
openssl rand -hex 32
```

```bash
npm run admin:hash -- "a-long-unique-admin-password"
```

Restart `npm run dev`. The sign-in page now shows **Continue with Google**, the demo personas disappear, and data lives in Supabase. Payments and chat apps are no longer simulated. Each one switches on as you add its keys ([INTEGRATIONS.md](INTEGRATIONS.md)).

**The admin console (`/admin`):**

- **Hidden:** it is linked from nowhere (not the landing page, not sign-in, not the app). Operators type `/admin`.
- **Separate credentials:** it uses its own login and signing secret, with 8-hour tokens. A customer's Google session can never open it, and an admin token can never act inside a workspace.
- **Hardened:** logins are rate limited to 10 per 15 minutes per IP, the page is `noindex`, and production refuses a plain-text password.
- **What you can do there:** see every workspace's plan, billing status and seats, and grant a plan manually (e.g. an enterprise invoice customer).

---

## 5. If sign-in doesn't work

Delegate tells you why on the sign-in page itself, in a red box. The usual causes:

| What the red box says | Fix |
|---|---|
| *…the package "…" isn't installed* | You pulled new code. Run `npm install`, then `npm run dev` again. (`npm run dev` also checks this before starting.) |
| *The Delegate API isn't responding* | The API part of `npm run dev` stopped. Look in that terminal for a red `[api]` line. After pulling new code, `npm install` is usually the fix. |
| *…missing the latest migration* | In Supabase → SQL Editor, run `supabase/migrations/20261113000000_saas.sql`. Refresh the page; no restart needed. |
| *…the database is empty* | Run both files in `supabase/migrations`, oldest first. |
| *…is required in production* | Your `.env` says `NODE_ENV=production`. Locally, use `NODE_ENV=development`. On Vercel, add the named variable and redeploy. |
| *The server didn't accept your Google session* | `SUPABASE_URL` / keys on the server belong to a different Supabase project than the one you signed in to. |
| Clicking **Continue with Google** shows `{"message":"No API key found in request"}` | That page is Supabase, not Google. Either `SUPABASE_URL` has an extra path (it must be exactly `https://YOUR-REF.supabase.co`; the app now trims it, so redeploy), or Supabase → Authentication → URL Configuration → **Site URL** points at a `supabase.co` address. It must be your app: `http://localhost:3000` or `https://YOUR-APP.vercel.app`. |
| The confirmation or reset email never arrives | Set up custom SMTP (step 2, *Email and password sign-in*). Supabase's built-in sender only mails your own team's addresses, a few per hour. |
| An email link says it expired or was opened in a different browser | Update the two email templates (same section) so links work on any device. If it was a sign-up confirmation, the address is confirmed anyway, so just log in. |
| Google sends you back to the home page | Add `http://localhost:3000/auth/callback` (and your live domain's) under Supabase → Authentication → URL Configuration → Redirect URLs. Delegate finishes the sign-in anyway, but Supabase should allow the callback. |

`GET /api/health` shows the same information: `{"ok":false,"setupIssue":"…"}` when something needs fixing.

---

## 6. Tests

```bash
npm test
```

runs the API suite (45 tests):
- the state machine, permissions, tenant isolation and admin separation
- billing: trial, Starter limits, Stripe and Paystack webhook signatures and replays
- Slack, Teams, WhatsApp and GitHub webhooks, including forged-signature rejection
- escalations, playbooks, the morning brief, the cron endpoint and Drive verification

```bash
npx playwright install chromium
```

(once per machine), then

```bash
npm run test:e2e
```

That builds production, starts it on `:3100` with a fresh demo workspace and simulated providers, and runs 42 browser tests on desktop and mobile:
- landing page (the phone signs in by itself and walks a ticket through all four states), the full accountability loop, blockers, chat, filters, onboarding and the admin console
- every way sign-in can fail shows its reason and fix
- light/dark theme from the avatar menu, and the dropdowns' mouse, keyboard and search behaviour
- trial → checkout → Team, the WhatsApp simulator, Slack connect + test message, GitHub webhook setup
- playbooks, the notification bell, glance filters and automations
