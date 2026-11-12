# Integrations

Every integration is **off until you add its keys**, and each one can be tried first in demo mode without any account (see [SETUP.md](SETUP.md#1-run-it-locally-2-minutes-no-accounts-needed)). In the steps below, `YOUR-DOMAIN` is your production domain, e.g. `delegate-app.vercel.app` or `app.yourcompany.com`. Webhooks need a public HTTPS URL, so set each provider up **after your first deploy** ([DEPLOYMENT.md](DEPLOYMENT.md)), then redeploy whenever you add env vars.

All inbound webhooks live under `https://YOUR-DOMAIN/api/hooks/…`, and every one is **signature-verified**. Forged requests are rejected, and provider retries are de-duplicated.

| Integration | Env vars | Webhook / URL to register |
|---|---|---|
| [Stripe](#stripe) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_TEAM`, `TEAM_PRICE_USD` | `/api/hooks/stripe` |
| [Paystack](#paystack) | `PAYSTACK_SECRET_KEY`, `PAYSTACK_PLAN_TEAM`, `TEAM_PRICE_NGN` | `/api/hooks/paystack` |
| [Slack](#slack) | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET` | `/api/integrations/slack/callback`, `/api/hooks/slack/commands`, `/api/hooks/slack/interactivity` |
| [Microsoft Teams](#microsoft-teams) | none (set up per workspace, in the app) | `/api/hooks/teams/<id>` (shown in the app) |
| [WhatsApp](#whatsapp-meta-cloud-api) | `WHATSAPP_*` | `/api/hooks/whatsapp` |
| [GitHub](#github-auto-proof) | none (set up per workspace, in the app) | `/api/hooks/github/<id>` (shown in the app) |
| [Google Drive](SETUP.md#3b-google-drive-proof-optional-recommended) | `GOOGLE_CLIENT_ID`, `GOOGLE_API_KEY`, `GOOGLE_PROJECT_NUMBER` | none |
| [Resend](#resend-email) | `RESEND_API_KEY`, `MAIL_FROM` | none |
| [Anthropic](#anthropic-ai-proof-checks) | `ANTHROPIC_API_KEY` | none |

## How plans work

| | **Starter** (free) | **Team** (paid, per member / month) |
|---|---|---|
| Members | up to 5 | unlimited |
| Playbooks | 1 | unlimited |
| Velocity history | 7 days | 30 days |
| WhatsApp, escalations, GitHub auto-proof, AI checks, standup email | no | yes |
| Slack, Teams, Drive proof, notifications | yes | yes |

- **Trial:** every new workspace gets a **14-day Team trial**, no card needed. After it ends, the workspace falls back to Starter limits. Nothing is deleted; Team features simply pause.
- **Billing source of truth:** the provider's webhooks, never the browser redirect. A payment counts only when Stripe or Paystack confirms it server-to-server.
- **Manual plans:** you can set a plan by hand in `/admin` (e.g. an enterprise customer paying by invoice).

---

## Stripe

Cards and wallets worldwide, with automatic per-seat billing: when a teammate joins, Stripe updates the quantity, with proration.

1. Sign up at [dashboard.stripe.com](https://dashboard.stripe.com). Keep **Test mode** on while you set up.
2. **Product catalog → + Add product**:
   - Name: `Delegate Team`
   - Pricing: **Recurring**, **Monthly**, **Per unit**, amount `8.00 USD` (or your price).
   - Save, open the price, and copy its ID (`price_…`) → `STRIPE_PRICE_TEAM`.
   - Set `TEAM_PRICE_USD` to the same number. It is only displayed on the Billing page.
3. **Developers → API keys**: copy the **Secret key** (`sk_test_…`) → `STRIPE_SECRET_KEY`.
4. **Developers → Webhooks → + Add endpoint**:
   - Endpoint URL: `https://YOUR-DOMAIN/api/hooks/stripe`
   - Events to send:
     - `checkout.session.completed`
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.payment_failed`
   - Save, then reveal the **Signing secret** (`whsec_…`) → `STRIPE_WEBHOOK_SECRET`.
5. **Settings → Billing → Customer portal → Activate**:
   - Allow: update payment method, view invoice history, cancel subscription.
   - Turn **off** "customers can change quantity", because seats follow the member count automatically.
   - This powers the **Manage subscription** button.
6. Redeploy. In the app, as the workspace **owner**, go to **Settings → Billing → Upgrade — pay by card** and pay with the test card `4242 4242 4242 4242` (any future date, any CVC). The plan flips to **Active** within seconds.
7. **Going live:** switch Stripe to **Live mode**, repeat steps 2–5 (live products, keys and webhooks are separate), and replace the three env vars with the live values.

## Paystack

₦ cards, bank transfer and USSD for customers in Nigeria, Ghana, Kenya and South Africa.

1. Sign up at [dashboard.paystack.com](https://dashboard.paystack.com) and complete business verification (needed for live mode).
2. **Products → Plans → Create plan**:
   - Name: `Delegate Team`
   - Interval: **Monthly**
   - Amount: the price **per seat**, e.g. `12000` NGN
   - Copy the **Plan code** (`PLN_…`) → `PAYSTACK_PLAN_TEAM`.
   - Set `TEAM_PRICE_NGN` to the same amount (display only).
3. **Settings → API Keys & Webhooks** (test section):
   - **Secret key** (`sk_test_…`) → `PAYSTACK_SECRET_KEY`. Paystack signs webhooks with this same key (HMAC-SHA512), so there is no separate webhook secret.
   - **Webhook URL**: `https://YOUR-DOMAIN/api/hooks/paystack` → **Save**.
   - **Callback URL**: leave empty. Delegate sends its own per checkout (`/app/settings?tab=billing&checkout=paystack`).
4. Redeploy and click **Pay with Paystack**. Test card: `4084 0840 8408 4081`, any future expiry, CVV `408`, PIN `0000`, OTP `123456`.
5. **Going live:** do the same in the **Live** section (it has its own key and webhook field) and replace the env vars.

> **Seats (known limitation):** Paystack charges *plan amount × member count at checkout*, and every renewal repeats that same amount, because Paystack subscriptions cannot change quantity. Teammates who join later still get in, but they are not billed until the owner re-subscribes. Stripe syncs seats automatically. For a large Paystack customer, you can also set the plan by hand in `/admin` and invoice them.

---

## Slack

Notifications go to a channel you choose. Tasks are created with `/delegate` or from any message (**⋯ → Create Delegate task**). People can also move their own tasks from Slack.

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App → From scratch**, name it `Delegate`, and pick your own workspace for development.
2. **Basic Information → App Credentials**: copy **Client ID**, **Client Secret** and **Signing Secret** → `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`. Under **Display Information**, add the icon and description.
3. **OAuth & Permissions**:
   - **Redirect URLs → Add**: `https://YOUR-DOMAIN/api/integrations/slack/callback` → **Save URLs**.
   - **Bot Token Scopes**: add `commands`, `chat:write`, `users:read`, `users:read.email` and `incoming-webhook`.
4. **Slash Commands → Create New Command**:
   - Command: `/delegate`
   - Request URL: `https://YOUR-DOMAIN/api/hooks/slack/commands`
   - Short description: `Create and update Delegate tasks`
   - Usage hint: `new Fix the invoice @tunde tomorrow !high · list · done DLG-12 <link>`
5. **Interactivity & Shortcuts**:
   - Turn **On**, with Request URL `https://YOUR-DOMAIN/api/hooks/slack/interactivity`.
   - **Create New Shortcut → On messages**: name `Create Delegate task`, Callback ID **`delegate_create_task`** (exactly this) → **Save Changes**.
6. **Manage Distribution → Activate Public Distribution**. This lets *your customers'* Slack workspaces install the app. No App Directory listing is needed.
7. Redeploy. In Delegate, as a manager: **Settings → Integrations → Add to Slack**. Slack asks which channel to post to, then redirects back with **Connected**. Press **Send test**.

How people are matched: a Slack user is matched to a Delegate teammate **by email address**, which is why `users:read.email` is needed. Slack users who are not in the workspace get a polite refusal.

Commands (the same language works in Slack, Teams and WhatsApp):

| Type | It does |
|---|---|
| `new Send Q4 invoice to Acme @tunde tomorrow !high` | Creates a task for Tunde, due tomorrow 18:00, high priority |
| `list` | Your open tasks |
| `start DLG-12` | Open → In motion |
| `done DLG-12 https://link-to-proof` | Submits with proof (a link or a short note) |
| `block DLG-12 waiting for the signed PO` | Marks it blocked with a reason |
| `unblock DLG-12` | Back in motion |
| `approve DLG-12` | Managers: audit it |

Due hints: `today`, `eod`, `tomorrow`, a weekday (`friday`), or `due:2026-12-01`. Priority: `!urgent`, `!high`, `!medium`, `!low`.

## Microsoft Teams

There are two independent pieces, both set up by a manager **inside Delegate** (no Azure account needed):

**A. Notifications (Adaptive Cards in a channel)**

1. In Teams, open the channel → **⋯ → Workflows**.
2. Pick the template **"Send webhook alerts to a channel"** (older name: *"Post to a channel when a webhook request is received"*) → **Next** → choose the team and channel → **Add workflow**.
3. Copy the URL it shows (it contains `logic.azure.com` or `powerplatform.com`).
4. In Delegate: **Settings → Integrations → Microsoft Teams → Workflows webhook URL** → paste → **Save** → **Send test**.

**B. `@Delegate` commands (message-to-ticket)**

1. After saving step A, the Teams card shows an **Outgoing webhook callback URL**. Copy it.
2. In Teams: the team's **⋯ → Manage team → Apps → Create an outgoing webhook** (bottom-right):
   - Name `Delegate`
   - Callback URL = the one you copied
   - Description `Delegate tasks`
3. **Create**. Teams shows a **security token** once. Copy it.
4. In Delegate, paste it into **Outgoing webhook security token** → **Save**.
5. In any channel of that team, type `@Delegate new Renew the SSL cert @Leo friday`.

If **Create an outgoing webhook** is missing, your Teams admin must allow custom apps (Teams admin center → *Teams apps → Setup policies / Org-wide app settings*). Teams matches people by their Microsoft 365 email, which must equal their Delegate (Google) email.

## WhatsApp (Meta Cloud API)

New tasks, blocker pings, escalations and the morning brief arrive on WhatsApp. People reply `start DLG-12`, `done DLG-12 <link>`, `block DLG-12 …` or `new …`. The task-assigned message has a one-tap **Start** button.

This is the longest setup (Meta reviews templates and verifies businesses), so start it early.

1. **Meta app:** go to [developers.facebook.com](https://developers.facebook.com) → **My Apps → Create app** → use case **"Connect with customers through WhatsApp"** (or type *Business* → add the **WhatsApp** product). Connect your **Business portfolio**, creating one at [business.facebook.com](https://business.facebook.com) if needed.
2. **Phone number:** go to **WhatsApp → API Setup**. Meta gives you a test number for development. For production, use **Add phone number**: a number not already used on the WhatsApp app, with a display name that matches your business.
   - **Phone number ID** → `WHATSAPP_PHONE_NUMBER_ID`
   - The number itself, digits only with country code (e.g. `2348012345678`) → `WHATSAPP_BUSINESS_NUMBER`
3. **Permanent token:** the token on the API Setup page expires in 24 hours. Create a permanent one:
   1. Go to **business.facebook.com → Settings → Users → System users → Add**, name it `delegate-server`, role **Admin**.
   2. Click **Assign assets**: your **app** (Full control) and your **WhatsApp account** (Full control).
   3. Click **Generate new token**: choose the app, expiry **Never**, permissions `whatsapp_business_messaging` and `whatsapp_business_management`. Copy it → `WHATSAPP_TOKEN`.
4. **App secret:** go to **App settings → Basic → App secret → Show** → `WHATSAPP_APP_SECRET`. It verifies that webhooks really come from Meta.
5. **Verify token:** invent a random string (e.g. `openssl rand -hex 16`) → `WHATSAPP_VERIFY_TOKEN`.
6. **Deploy with these env vars first.** Meta checks the webhook during setup.
7. **Webhook:** go to **WhatsApp → Configuration → Webhook → Edit**:
   - Callback URL: `https://YOUR-DOMAIN/api/hooks/whatsapp`
   - Verify token: the same value as `WHATSAPP_VERIFY_TOKEN`
   - Click **Verify and save**, then **Webhook fields → messages → Subscribe**.
8. **Message templates:** WhatsApp only lets businesses start a conversation with a pre-approved template. Go to [business.facebook.com/wa/manage/message-templates](https://business.facebook.com/wa/manage/message-templates) → **Create template**:
   - Category **Utility**, language **English**. If you pick *English (US)*, set `WHATSAPP_TEMPLATE_LANG=en_US`.
   - Use **exactly these names**, and keep the variables in this order. You may change the wording around them. Meta asks for sample values; use anything realistic.

   | Name | Body | Buttons |
   |---|---|---|
   | `delegate_task_assigned` | `New task {{1}}: {{2}}. Assigned by {{3}}, due {{4}}. Tap Start to begin, or reply DONE plus the task number and a link to your proof.` | **Quick reply**: `Start` (required: Delegate fills in its payload) |
   | `delegate_blocker` | `Heads up: {{1}} is blocked on {{2}} "{{3}}" and is waiting on you. Reason: {{4}}. Open Delegate to help unblock it.` | none |
   | `delegate_escalation` | `Escalation: {{1}} "{{2}}" has been stuck for {{3}} hours (assigned to {{4}}). Please step in today.` | none |
   | `delegate_daily_digest` | `Good morning {{1}}! You have {{2}} open tasks today: {{3}}. Reply LIST to see them all.` | none |

   Approval usually takes minutes to a few hours. Until a template is approved, its messages show as `failed` in **Recent deliveries**, with Meta's reason.
9. **Business verification:** **business.facebook.com → Security Center → Start verification**. Without it, Meta limits how many people you can message per day.
10. **In Delegate:**
    - A manager goes to **Settings → Integrations → WhatsApp → Switch on** (Team plan).
    - Each person goes to **Settings → Account → Link WhatsApp** → **Open WhatsApp**. This sends `LINK ABC123` to your business number, which links their phone (no app to install).

Costs: Meta charges per template message (utility pricing, by country). Replies to a person's message within 24 hours are free. Delegate only uses templates for the four notifications above, and answers everything else as free-form replies.

## GitHub (auto-proof)

When a pull request mentioning `DLG-12` is **merged**, task DLG-12 turns green (*Executed*) with the PR attached as **verified** proof. A commit that says `fixes DLG-12`, `closes DLG-12` or `resolves DLG-12` does the same. A plain mention only attaches the link.

1. In Delegate, as a manager: **Settings → Integrations → GitHub → Create webhook**. Copy the **Payload URL** and **Secret**. The secret is shown only once; **Rotate secret** makes a new one.
2. In GitHub, go to the repo (or the organisation, to cover every repo) → **Settings → Webhooks → Add webhook**:
   - Payload URL: the one from Delegate (`https://YOUR-DOMAIN/api/hooks/github/<id>`)
   - Content type: **application/json** (required)
   - Secret: the one from Delegate
   - Events: **Let me select individual events** → tick **Pull requests** and **Pushes**
   - **Add webhook**. GitHub sends a `ping`, and the card in Delegate shows the repo name.
3. Tell the team: put the task number in the PR title, e.g. `DLG-12 Fix invoice rounding`.

## Resend (email)

Managers get the 8 AM morning brief by email (Team plan). The brief always shows on **Insights → Standup**, with or without email.

1. Go to [resend.com](https://resend.com) → **Domains → Add domain** → add the DNS records it shows at your DNS provider → wait for **Verified**.
2. **API Keys → Create** (sending access) → `RESEND_API_KEY`.
3. `MAIL_FROM="Delegate <brief@yourdomain.com>"`, using the verified domain.

## Anthropic (AI proof checks)

When proof is submitted, Claude compares it with the task brief and adds an advisory verdict (*looks complete*, *needs a look*, *doesn't match*). Managers still make the final call, and a failed AI call never blocks a submission.

1. Go to [console.anthropic.com](https://console.anthropic.com) → **API Keys → Create key** → `ANTHROPIC_API_KEY`. Add credit under **Billing**.
2. Optional: `AI_MODEL` (default `claude-opus-5-5`).
