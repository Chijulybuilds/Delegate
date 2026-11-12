# Deployment

The recommended host is **Vercel**. It serves the React app from its CDN and runs the Express API as one serverless function, on the same domain. The repo is already configured: [`vercel.json`](../vercel.json) and [`api/index.mjs`](../api/index.mjs). Supabase holds all data, so nothing is lost between serverless instances.

Before deploying, finish [SETUP.md](SETUP.md) steps 2–4 (Supabase, Google, secrets).

```
Browser ──► Vercel CDN ── /            → apps/web/dist (React)
                       └─ /api/*       → api/index.mjs → Express API (apps/api)
                                              │
               Supabase (Postgres, Auth, Storage, Realtime, pg_cron) ◄─┘
               Stripe · Paystack · Slack · Teams · Meta · GitHub · Google → /api/hooks/*
```

---

## 1. Deploy to Vercel

1. Push the repo to GitHub, then on [vercel.com](https://vercel.com) → **Add New → Project** → import it.
2. **Configure Project**:
   - **Root Directory**: leave it as the repo root (`./`).
   - **Framework Preset**: *Other*. Build, install and output settings come from `vercel.json`; don't override them.
   - **Node.js version**: picked from `package.json` (`>=20.19`); any 22.x or newer is fine.
3. **Environment Variables**: paste the variables below for **Production** (and **Preview** if you use preview deployments). The fastest way is to paste your whole `.env` into the first field; Vercel splits it.

   **Required**

   | Name | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `NODEJS_HELPERS` | `0`: **required**, so webhook signatures can be verified |
   | `SUPABASE_URL` | from Supabase → Project Settings → API Keys |
   | `SUPABASE_ANON_KEY` | publishable / anon key |
   | `SUPABASE_SERVICE_ROLE_KEY` | secret / service_role key |
   | `APP_ENCRYPTION_KEY` | `openssl rand -hex 32` (never change it after launch) |
   | `CRON_SECRET` | `openssl rand -hex 24` |
   | `ADMIN_EMAIL` | your operator email for `/admin` |
   | `ADMIN_PASSWORD_HASH` | `npm run admin:hash -- "long-password"` |
   | `ADMIN_JWT_SECRET` | `openssl rand -hex 32` |

   **Recommended:** `PUBLIC_APP_URL` = `https://YOUR-DOMAIN`. If you leave it out, Vercel's production domain is used.

   **Optional, by feature:** the `STRIPE_*`, `PAYSTACK_*`, `SLACK_*`, `WHATSAPP_*`, `GOOGLE_*`, `RESEND_API_KEY`/`MAIL_FROM` and `ANTHROPIC_API_KEY` variables. See [INTEGRATIONS.md](INTEGRATIONS.md).
4. **Deploy**. The build runs `npm run build`, which builds the API bundle and then the web app. When it finishes, open:
   - `https://YOUR-DOMAIN/api/health` → `{"ok":true,"store":"supabase","authMode":"supabase",…}`
   - `https://YOUR-DOMAIN/`: the landing page
5. **Custom domain** (optional): go to **Settings → Domains → Add**, enter `app.yourcompany.com`, and add the DNS record Vercel shows. Then update `PUBLIC_APP_URL` and redeploy.

> Every time you add or change an env var, **redeploy** (Deployments → ⋯ → Redeploy). Running functions only pick up new values on a new deployment.

## 2. Point the providers at your domain

| Where | What to set |
|---|---|
| Supabase → Authentication → URL Configuration | **Site URL** `https://YOUR-DOMAIN`; **Redirect URLs** add `https://YOUR-DOMAIN/auth/callback` |
| Google Cloud → Clients → *Delegate web* | **Authorized JavaScript origins** add `https://YOUR-DOMAIN` |
| Google Cloud → Branding | **Authorized domains** add your domain |
| Google Cloud → Credentials → API key (Drive) | **Websites** add `https://YOUR-DOMAIN/*` |
| Stripe → Webhooks | `https://YOUR-DOMAIN/api/hooks/stripe` |
| Paystack → API Keys & Webhooks | `https://YOUR-DOMAIN/api/hooks/paystack` |
| Slack app | Redirect URL, slash command and interactivity URLs on your domain |
| Meta → WhatsApp → Configuration | `https://YOUR-DOMAIN/api/hooks/whatsapp` |

Step-by-step for each: [INTEGRATIONS.md](INTEGRATIONS.md).

## 3. Turn on the automation scheduler

Escalations, overdue alerts, recurring playbooks and the 8 AM morning brief run whenever something calls `/api/cron/tick`. The tick is idempotent, so extra calls never send anything twice.

- **Vercel Cron (built in):** `vercel.json` registers a **daily** call (07:05 UTC). That is the most the free Hobby plan allows. On its own, it is only a safety net.
- **Supabase pg_cron (recommended, free):**
  1. Open [`supabase/cron.sql`](../supabase/cron.sql) and replace `YOUR-DOMAIN` and `YOUR_CRON_SECRET` (it appears in two places).
  2. Paste it into **Supabase → SQL Editor** → **Run**.
  3. Supabase now calls the tick every 10 minutes. To check it, after 10 minutes run `select status_code from net._http_response order by created desc limit 3;` and look for `200`.
- **Vercel Pro instead:** change the cron schedule in `vercel.json` to `*/10 * * * *` and skip pg_cron.

Run it by hand any time:

```bash
curl -fsS -H "Authorization: Bearer YOUR_CRON_SECRET" https://YOUR-DOMAIN/api/cron/tick
```

## 4. Go-live checklist

**Core**
- [ ] Both Supabase migrations ran; `/api/health` says `"store":"supabase"`.
- [ ] Google sign-in works on the production domain. The Google app is **published** (not *Testing*).
- [ ] `/admin` logs in with your hashed password. The dev credentials are refused.
- [ ] `NODEJS_HELPERS=0`, `APP_ENCRYPTION_KEY` and `CRON_SECRET` are set; `supabase/cron.sql` is installed.

**Billing**
- [ ] Stripe and/or Paystack are in **live** mode, with live keys, live price/plan IDs and live webhooks.
- [ ] Test purchase on production (then refund): the plan flips to **Active**, and `/admin` shows it under **Billing**.
- [ ] Stripe Customer Portal is activated. Business details, terms and privacy URLs are filled in on both providers.

**Channels**
- [ ] Slack public distribution is activated. **Send test** arrives in the channel.
- [ ] WhatsApp: permanent token, the 4 templates are **Approved**, business verification is done, and a real phone is linked via **Settings → Account**.

**Data and security**
- [ ] Supabase: **Point-in-Time Recovery** on (Pro plan), or at least daily backups.
- [ ] Supabase: rotate the database password you shared during setup. Keep the service-role key only in Vercel.

## 5. What runs where (limits to know)

| Concern | Vercel behaviour | Handled by |
|---|---|---|
| Request body size | 4.5 MB per request | Proof files upload **directly to Supabase Storage** through signed URLs; the API only receives the file reference |
| Function time | `maxDuration` 60 s (`vercel.json`) | Webhooks reply in well under a second; AI checks give up after ~30 s and the submission still goes through |
| Background jobs | No always-on process | `/api/cron/tick` via pg_cron (above) |
| Webhook signatures | Vercel pre-parses bodies unless told not to | `NODEJS_HELPERS=0`. Without it, webhooks fail loudly with `raw_body_unavailable` and providers retry |
| Rate limits | In-memory per function instance | Fine at launch scale. For heavy traffic, add Vercel WAF rules or a shared store (Upstash Redis) |
| Demo mode on Vercel | In-memory data is not shared between instances | Always configure Supabase in production |

Health check: `GET /api/health` → `{ ok, store, authMode, version }`. Logs: Vercel → Project → **Logs** (filter by `/api`).

---

## Alternative: Hostinger VPS (or any Linux server)

One long-running Node process serves the app and API. The in-process scheduler runs the automations, so there's no cron setup.

```bash
git clone https://github.com/Chijulybuilds/Delegate.git && cd Delegate
```

```bash
npm ci && npm run build
```

Create `.env` with the variables from section 1, **minus** `NODEJS_HELPERS`, plus:

```dotenv
PORT=3000
PUBLIC_APP_URL=https://YOUR-DOMAIN
INTERNAL_SCHEDULER=true
```

Run it under PM2, so it restarts on crash and reboot:

```bash
npm install -g pm2 && pm2 start ecosystem.config.cjs && pm2 save && pm2 startup
```

Put nginx in front for HTTPS (`certbot --nginx` issues the certificate):

```nginx
server {
  server_name YOUR-DOMAIN;
  client_max_body_size 12m;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

To update:

```bash
git pull && npm ci && npm run build && pm2 restart delegate
```

The same works on Render, Railway or Fly.io: build `npm ci && npm run build`, start `npm start`, plus `INTERNAL_SCHEDULER=true`.
