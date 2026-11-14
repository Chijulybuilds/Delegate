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
2. Open **SQL Editor → New query** and run the three migrations **in order**. Paste each file and press **Run**:
   1. [`supabase/migrations/20261112000000_init.sql`](../supabase/migrations/20261112000000_init.sql): workspaces, tasks, the append-only ledger, Row Level Security, the `proofs` storage bucket, and Realtime.
   2. [`supabase/migrations/20261113000000_saas.sql`](../supabase/migrations/20261113000000_saas.sql): task numbers (`DLG-12`), subscriptions, integrations, notifications, playbooks, escalation fields and the webhook de-duplication table.
   3. [`supabase/migrations/20261114000000_accounts.sql`](../supabase/migrations/20261114000000_accounts.sql): **Leave workspace / Delete account** (erases a deleted person's name from the history) and a security fix that stops browsers from calling the workspace-delete function.

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

People can sign up and log in with an email and password as well as with Google. To prove the address is really theirs, a new account gets a **6-digit code** by email and types it in (no link to click). Supabase sends two emails: the *sign-up code* and *reset your password*.

1. **Authentication → Sign In / Providers → Email**:
   - Leave **Enable Email provider** on.
   - Keep **Confirm email** on: that's what sends the code, so nobody can sign up with someone else's address.
   - **Email OTP Length**: `6` (if you pick another length, set `EMAIL_OTP_LENGTH` in Vercel to the same number).
   - **Email OTP Expiration**: `3600` seconds (one hour; the app tells people this).
   - **Minimum password length**: `8`, the same as the app.
2. **Authentication → URL Configuration → Redirect URLs**: next to the `/auth/callback` entries, add:
   - `http://localhost:3000/auth/reset`
   - `https://YOUR-DOMAIN/auth/reset`
3. **Email templates.** Go to **Authentication → Emails → Templates**.
   - **Confirm signup**: this turns the link into a code. Set **Subject** to `Your Delegate code`, and replace the **Body** with:
     ```html
     <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#111">
       <p style="font-size:20px;font-weight:600;margin:0 0 8px">Confirm your email</p>
       <p style="font-size:15px;line-height:1.5;color:#555;margin:0 0 24px">Type this code into Delegate to finish creating your account:</p>
       <p style="font-size:34px;font-weight:600;letter-spacing:8px;margin:0 0 24px;font-family:Menlo,Consolas,monospace">{{ .Token }}</p>
       <p style="font-size:13px;line-height:1.5;color:#888;margin:0">The code expires in one hour. If you didn't try to sign up for Delegate, ignore this email.</p>
     </div>
     ```
   - **Reset Password**: keeps a link, so it opens on any device. Subject `Reset your Delegate password`; in the body, use this link:
     ```html
     <a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery">Choose a new password</a>
     ```
4. **Custom SMTP: sender name "Delegate" (required before real users sign up).** Until you do this, every email arrives from **Supabase Auth**, and Supabase's built-in sender only allows **2 emails an hour**. That's why pressing *Resend* seems to do nothing. With custom SMTP, emails come from **Delegate**, from your own address. Pick one:
   - **Resend (best, needs a domain you own):**
     1. In [Resend](https://resend.com), go to **Domains → Add domain**, add the DNS records it shows, and wait for **Verified**.
     2. Under **API Keys → Create**, choose *Sending access*.
     3. In Supabase → **Authentication → Emails → SMTP Settings**, turn on **Enable custom SMTP**:

        | Field | Value |
        |---|---|
        | Sender email | `no-reply@yourdomain.com` |
        | Sender name | `Delegate` |
        | Host | `smtp.resend.com` |
        | Port | `465` |
        | Username | `resend` |
        | Password | your Resend API key |
   - **Gmail (no domain needed, fine for an MVP, up to ~500 emails a day):**
     1. On the Google account that will send the emails, turn on **2-Step Verification**, then create an **App password** at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords).
     2. In Supabase → **SMTP Settings**: Sender email = that Gmail address, Sender name = `Delegate`, Host = `smtp.gmail.com`, Port = `465`, Username = the Gmail address, Password = the 16-letter app password.
   - Then, under **Authentication → Rate Limits**, raise *emails sent per hour* (e.g. to 100).

Flow:
- **Sign up:** name, email, password → **Enter your code** (6 boxes; paste works, and phones offer the code from Mail) → signed in → onboarding. *Send a new code* unlocks after 60 seconds, the minimum Supabase allows.
- **Log in:** email + password. An address that was never confirmed gets a code the same way. **Forgot password?** → email link → `/auth/reset` → new password → the board.
- If the *Confirm signup* template still contains a link instead of `{{ .Token }}`, the link keeps working; switch the template so people get a code.

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
7. Under **Audience**: while the app is in *Testing*, only the test users you add can sign in. Click **Publish app** before launch. With only the scopes above, publishing does not need a Google review.
8. **Show "Delegate" instead of `xxxx.supabase.co` on Google's sign-in screen (brand verification, free, takes a few days):**
   1. Prove you own the site. Go to [Google Search Console](https://search.google.com/search-console) → **Add property** → **URL prefix** → `https://YOUR-DOMAIN/` → choose the **HTML tag** method. Copy only the `content="…"` value, add it in Vercel as `GOOGLE_SITE_VERIFICATION`, redeploy, then click **Verify**. (On your own domain, the DNS method works too.)
   2. In **Google Auth Platform → Branding**, fill in:
      - **App name:** Delegate
      - **App logo:** a 120×120 PNG
      - **Support email**
      - **Home page:** `https://YOUR-DOMAIN/`
      - **Privacy policy:** `https://YOUR-DOMAIN/privacy`
      - **Terms of service:** `https://YOUR-DOMAIN/terms`
      - **Authorized domains:** `YOUR-DOMAIN` and `YOUR-REF.supabase.co`
      - Save.
   3. Click **Verify branding** and submit. Google may ask you to prove ownership of every authorized domain. If it won't accept the `supabase.co` domain, a Supabase custom domain (Project Settings → Custom Domains, paid) replaces it with your own.
   4. Set `VITE_COMPANY_NAME` and `VITE_SUPPORT_EMAIL` in Vercel first, so the legal pages show your real name and a contact inbox.

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
| *…missing the latest migration* | In Supabase → SQL Editor, run the file the message names (`20261113000000_saas.sql` and/or `20261114000000_accounts.sql`, oldest first). Refresh the page; no restart needed. |
| *Security update needed* | In Supabase → SQL Editor, run `supabase/migrations/20261114000000_accounts.sql`. Refresh the page. |
| *…the database is empty* | Run every file in `supabase/migrations`, oldest first. |
| *…is required in production* | Your `.env` says `NODE_ENV=production`. Locally, use `NODE_ENV=development`. On Vercel, add the named variable and redeploy. |
| *The server didn't accept your Google session* | `SUPABASE_URL` / keys on the server belong to a different Supabase project than the one you signed in to. |
| Clicking **Continue with Google** shows `{"message":"No API key found in request"}` | That page is Supabase, not Google. Either `SUPABASE_URL` has an extra path (it must be exactly `https://YOUR-REF.supabase.co`; the app now trims it, so redeploy), or Supabase → Authentication → URL Configuration → **Site URL** points at a `supabase.co` address. It must be your app: `http://localhost:3000` or `https://YOUR-APP.vercel.app`. |
| The sign-up code or reset email never arrives, or the email says it's from *Supabase Auth* | Set up custom SMTP with sender name `Delegate` (step 2, *Email and password sign-in*). Supabase's built-in sender only mails your own team's addresses, 2 emails an hour. |
| *Error sending confirmation email* (the app now says *We couldn't send the email just now*) | Supabase's mail server login failed. Open Supabase → **Logs → Auth** and find the red *error sending* line for the exact reason. Usually: Gmail needs an **App password** (not your normal password) and the Sender email must be that same Gmail address; Resend needs a **Verified** domain, Sender email on that domain, Username `resend`, Password = the `re_…` API key. Check for spaces before/after any value. |
| The email has a link, not a code | Change the **Confirm signup** template so it shows `{{ .Token }}` (step 2, *Email templates*). |
| *That code is wrong or has expired* with the right code | **Email OTP Length** in Supabase must match `EMAIL_OTP_LENGTH` (default 6). Codes expire after **Email OTP Expiration** (default one hour), and only the newest code works. |
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
