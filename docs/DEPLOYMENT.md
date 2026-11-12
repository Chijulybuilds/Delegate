# Deployment

Delegate builds to **one Node process** that serves the React app and the API from the same origin. That is the simplest and most robust production setup: no CORS, one domain and one certificate.

Before any deploy, finish [SETUP.md](SETUP.md) steps 2–4 (Supabase, Google, `.env`).

Production `.env` checklist:

```dotenv
NODE_ENV=production
PORT=3000
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
ADMIN_EMAIL=...
ADMIN_PASSWORD_HASH=...
ADMIN_JWT_SECRET=...
PUBLIC_APP_URL=https://YOUR-DOMAIN
```

After deploying, add `https://YOUR-DOMAIN` in **Supabase → Authentication → URL Configuration** (Site URL + `https://YOUR-DOMAIN/auth/callback`) and in **Google Cloud → OAuth client → Authorized JavaScript origins**.

---

## Option A: Hostinger VPS (or any Linux server)

```bash
git clone https://github.com/Chijulybuilds/Delegate.git && cd Delegate
```

```bash
npm ci && npm run build
```

Create `.env` with the checklist above, then run it under PM2 so it restarts on crash and reboot:

```bash
npm install -g pm2 && pm2 start ecosystem.config.cjs && pm2 save && pm2 startup
```

Put nginx in front for HTTPS (`certbot --nginx` issues the certificate):

```nginx
server {
  server_name YOUR-DOMAIN;
  client_max_body_size 12m;            # proof-of-work uploads (10 MB limit in the API)
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

To update: `git pull && npm ci && npm run build && pm2 restart delegate`.

The same commands work on Render, Railway or Fly.io: build command `npm ci && npm run build`, start command `npm start`, and the env vars above.

---

## Option B: Vercel for the web app, API on a Node host

Vercel serves the static React build; the API runs on a Node host from Option A (e.g. `api.YOUR-DOMAIN`).

1. Import the repo in Vercel with the **Root Directory left at the repo root**. [`vercel.json`](../vercel.json) already sets the build (`npm run build -w @delegate/web`), the output (`apps/web/dist`) and the single-page-app rewrites.
2. Choose one way for the browser to reach the API:
   - **Same-origin proxy (recommended).** Add this rewrite *before* the catch-all in `vercel.json`. No CORS settings are needed.

     ```json
     { "source": "/api/:path*", "destination": "https://api.YOUR-DOMAIN/api/:path*" }
     ```
   - **Direct calls.** Set `VITE_API_URL=https://api.YOUR-DOMAIN` in Vercel, and `CORS_ORIGINS=https://YOUR-DOMAIN` on the API host.
3. The API host needs the full production `.env`. The Vercel project needs no secrets at all.

---

## Operations notes

- **Health check:** `GET /api/health` returns `{ ok, store, authMode, version }`.
- **Security headers:** Helmet sets CSP, HSTS and frame-ancestors `none`. The CSP automatically allows your Supabase origin for auth and Realtime.
- **Rate limits** are kept in memory per process: 600 requests per minute per IP on the API, 10 per 15 minutes on admin login. If you run several instances behind a load balancer, move them to a shared store such as Redis.
- **Live updates:** with Supabase, boards update instantly through Realtime on `task_events`. Five-second polling stays on as a fallback.
- **Backups:** turn on Point-in-Time Recovery in Supabase for production.
