import { createHmac, randomBytes } from 'node:crypto';
import Stripe from 'stripe';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Task } from '@delegate/shared';
import { createApp } from '../src/app.js';
import { loadConfig, type Env } from '../src/config.js';
import { Secrets } from '../src/lib/crypto.js';
import { extractTaskHints, parseCommand } from '../src/services/commands.js';
import { MemoryStore } from '../src/store/memory.js';
import { DEMO_ORG_INVITE, seedDemo } from '../src/store/seed.js';

/* ----------------------------------------------------------------------------- harness */

type Call = { url: string; method: string; body: string; headers: Record<string, string> };
type Route = { match: (url: string, method: string) => boolean; respond: (call: Call) => unknown; status?: number };

function fakeHttp(routes: Route[] = []) {
  const calls: Call[] = [];
  const http = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? init.body : init?.body instanceof URLSearchParams ? init.body.toString() : '';
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const call = { url, method, body, headers };
    calls.push(call);
    const route = routes.find((r) => r.match(url, method));
    const out = route ? route.respond(call) : { ok: true };
    return new Response(typeof out === 'string' ? out : JSON.stringify(out), { status: route?.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { http, calls };
}

const BASE: Partial<Record<keyof Env, string>> = { NODE_ENV: 'test', SUPABASE_URL: '', ADMIN_EMAIL: '', CRON_SECRET: 'cron-secret', PUBLIC_APP_URL: 'https://app.delegate.test' };

let store: MemoryStore;
beforeEach(async () => {
  store = new MemoryStore();
  await seedDemo(store);
});

function build(overrides: Partial<Record<keyof Env, string>> = {}, routes: Route[] = []) {
  const config = loadConfig({ ...BASE, ...overrides });
  const fake = fakeHttp(routes);
  const app = createApp({ config, store, http: fake.http });
  return { app, config, calls: fake.calls, secrets: new Secrets(config.encryptionKey) };
}

async function token(app: ReturnType<typeof createApp>, personaId: string) {
  const res = await request(app).post('/api/auth/demo').send({ personaId }).expect(200);
  return res.body.token as string;
}
async function newUserToken(app: ReturnType<typeof createApp>, email: string, fullName: string) {
  return (await request(app).post('/api/auth/demo').send({ email, fullName }).expect(200)).body.token as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const orgId = () => [...store.orgs.values()][0]!.id;
const taskBy = (title: string) => [...store.tasks.values()].find((t) => t.title === title)!;

async function createTask(app: ReturnType<typeof createApp>, t: string, body: Record<string, unknown>) {
  return (await request(app).post('/api/tasks').set(auth(t)).send(body).expect(201)).body.task as Task;
}

/* ----------------------------------------------------------------------------- units */

describe('command language', () => {
  it('parses verbs, refs and free text', () => {
    expect(parseCommand('start DLG-12', 'whatsapp')).toEqual({ verb: 'start', ref: 12, rest: '' });
    expect(parseCommand('done 7 https://x.dev/pr/1 shipped', 'slack')).toMatchObject({ verb: 'done', ref: 7, rest: 'https://x.dev/pr/1 shipped' });
    expect(parseCommand('Fix the checkout bug', 'slack')).toMatchObject({ verb: 'create', rest: 'Fix the checkout bug' });
    expect(parseCommand('hi there', 'whatsapp').verb).toBe('unknown'); // never guess tasks on WhatsApp
  });

  it('extracts due dates and priority without eating real words', () => {
    const now = new Date('2026-11-12T10:00:00Z'); // a Thursday
    const h = extractTaskHints('Clean the sun lounge tomorrow !high', 'UTC', now);
    expect(h.title).toBe('Clean the sun lounge');
    expect(h.priority).toBe('high');
    expect(h.dueAt).toBe('2026-11-13T18:00:00.000Z');
    expect(extractTaskHints('Send invoice fri', 'UTC', now).dueAt).toBe('2026-11-13T18:00:00.000Z');
    expect(extractTaskHints('Plan monday standup', 'UTC', now).dueAt).toBe('2026-11-16T18:00:00.000Z');
  });

  it('seals secrets with AES-GCM and rejects tampering', () => {
    const s = new Secrets(randomBytes(32));
    const sealed = s.seal({ botToken: 'xoxb-123' });
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(s.open<{ botToken: string }>(sealed)?.botToken).toBe('xoxb-123');
    expect(s.open(sealed.slice(0, -2) + (sealed.endsWith('A') ? 'B' : 'A'))).toBeNull();
    expect(new Secrets(randomBytes(32)).open(sealed)).toBeNull();
  });
});

/* ----------------------------------------------------------------------------- billing */

describe('billing & plans', () => {
  it('starts new workspaces on a 14-day Team trial and falls back to Starter limits after it', async () => {
    const { app } = build();
    const founder = await newUserToken(app, 'founder@acme.example', 'Founder');
    await request(app).post('/api/onboarding/workspace').set(auth(founder)).send({ name: 'Acme' }).expect(201);
    let billing = (await request(app).get('/api/billing').set(auth(founder)).expect(200)).body;
    expect(billing.subscription.status).toBe('trialing');
    expect(billing.entitlements.effectivePlan).toBe('team');
    expect(billing.entitlements.trialDaysLeft).toBe(14);

    // Expire the trial: Starter caps the team at 5 people.
    const acme = [...store.orgs.values()].find((o) => o.name === 'Acme')!;
    store.subscriptions.get(acme.id)!.trialEndsAt = new Date(Date.now() - 1000).toISOString();
    billing = (await request(app).get('/api/billing').set(auth(founder)).expect(200)).body;
    expect(billing.entitlements.effectivePlan).toBe('starter');
    for (let i = 0; i < 4; i++) {
      const t = await newUserToken(app, `p${i}@acme.example`, `Person ${i}`);
      await request(app).post('/api/onboarding/join').set(auth(t)).send({ code: acme.inviteCode }).expect(201);
    }
    const sixth = await newUserToken(app, 'p6@acme.example', 'Person Six');
    const res = await request(app).post('/api/onboarding/join').set(auth(sixth)).send({ code: acme.inviteCode }).expect(402);
    expect(res.body.error.code).toBe('upgrade_required');
  });

  it('only the owner can start checkout; the demo checkout activates Team', async () => {
    const { app } = build();
    const kemi = await token(app, 'demo-kemi');
    await request(app).post('/api/billing/checkout').set(auth(kemi)).send({ provider: 'stripe' }).expect(403);
    const ada = await token(app, 'demo-ada');
    store.subscriptions.get(orgId())!.status = 'trialing';
    const res = await request(app).post('/api/billing/checkout').set(auth(ada)).send({ provider: 'paystack' }).expect(200);
    expect(res.body.url).toContain('demo_checkout=paystack');
    const done = await request(app).post('/api/billing/demo-complete').set(auth(ada)).send({ provider: 'paystack' }).expect(200);
    expect(done.body.subscription).toMatchObject({ status: 'active', provider: 'paystack', plan: 'team', seats: 6 });
  });

  it('creates a Stripe Checkout session for the per-seat price', async () => {
    const { app, calls } = build(
      { STRIPE_SECRET_KEY: 'sk_test_123', STRIPE_WEBHOOK_SECRET: 'whsec_test', STRIPE_PRICE_TEAM: 'price_team' },
      [{ match: (u) => u.includes('/v1/checkout/sessions'), respond: () => ({ id: 'cs_test_1', object: 'checkout.session', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }) }],
    );
    const ada = await token(app, 'demo-ada');
    const res = await request(app).post('/api/billing/checkout').set(auth(ada)).send({ provider: 'stripe' }).expect(200);
    expect(res.body.url).toBe('https://checkout.stripe.com/c/pay/cs_test_1');
    const body = decodeURIComponent(calls.find((c) => c.url.includes('checkout/sessions'))!.body);
    expect(body).toContain('line_items[0][price]=price_team');
    expect(body).toContain('line_items[0][quantity]=6');
    expect(body).toContain(`client_reference_id=${orgId()}`);
    expect(body).toContain(`subscription_data[metadata][orgId]=${orgId()}`);
  });

  it('activates from a signed Stripe webhook, rejects forgeries, and tolerates replays', async () => {
    const { app } = build({ STRIPE_SECRET_KEY: 'sk_test_123', STRIPE_WEBHOOK_SECRET: 'whsec_test', STRIPE_PRICE_TEAM: 'price_team' });
    const stripe = new Stripe('sk_test_123');
    store.subscriptions.get(orgId())!.status = 'trialing';
    const event = {
      id: 'evt_1',
      object: 'event',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_1',
          object: 'subscription',
          customer: 'cus_1',
          status: 'active',
          cancel_at_period_end: false,
          metadata: { orgId: orgId() },
          items: { data: [{ id: 'si_1', quantity: 9, current_period_end: 1_900_000_000 }] },
        },
      },
    };
    const payload = JSON.stringify(event);
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_test' });
    await request(app).post('/api/hooks/stripe').set('stripe-signature', 'tampered').set('content-type', 'application/json').send(payload).expect(400);
    await request(app).post('/api/hooks/stripe').set('stripe-signature', header).set('content-type', 'application/json').send(payload).expect(200);
    await request(app).post('/api/hooks/stripe').set('stripe-signature', header).set('content-type', 'application/json').send(payload).expect(200);
    const sub = store.subscriptions.get(orgId())!;
    expect(sub).toMatchObject({ status: 'active', provider: 'stripe', seats: 9, providerSubscriptionId: 'sub_1', providerCustomerId: 'cus_1' });
    expect(sub.currentPeriodEnd).toBe(new Date(1_900_000_000 * 1000).toISOString());
    expect(store.events.filter((e) => e.type === 'billing.updated')).toHaveLength(1); // replay didn't double-log
  });

  it('activates from Paystack webhooks verified with HMAC-SHA512', async () => {
    const { app } = build({ PAYSTACK_SECRET_KEY: 'sk_test_paystack', PAYSTACK_PLAN_TEAM: 'PLN_team' });
    const sign = (body: string) => createHmac('sha512', 'sk_test_paystack').update(body).digest('hex');
    const charge = JSON.stringify({ event: 'charge.success', data: { id: 99, reference: 'ref_1', plan: { plan_code: 'PLN_team' }, customer: { customer_code: 'CUS_abc' }, metadata: { orgId: orgId(), seats: 6 } } });
    await request(app).post('/api/hooks/paystack').set('x-paystack-signature', 'nope').send(charge).expect(400);
    await request(app).post('/api/hooks/paystack').set('x-paystack-signature', sign(charge)).set('content-type', 'application/json').send(charge).expect(200);
    const created = JSON.stringify({ event: 'subscription.create', data: { subscription_code: 'SUB_xyz', status: 'active', next_payment_date: '2026-12-12T08:00:00.000Z', customer: { customer_code: 'CUS_abc' } } });
    await request(app).post('/api/hooks/paystack').set('x-paystack-signature', sign(created)).set('content-type', 'application/json').send(created).expect(200);
    expect(store.subscriptions.get(orgId())).toMatchObject({ status: 'active', provider: 'paystack', providerSubscriptionId: 'SUB_xyz', providerCustomerId: 'CUS_abc' });
  });
});

/* ----------------------------------------------------------------------------- notifications */

describe('in-app notifications', () => {
  it('tells the assignee, pings the person a blocker waits on, and asks managers to audit', async () => {
    const { app } = build();
    const ada = await token(app, 'demo-ada');
    const tunde = await token(app, 'demo-tunde');
    const kemi = await token(app, 'demo-kemi');
    const task = await createTask(app, ada, { title: 'Rotate API keys', assigneeId: 'demo-tunde' });
    let inbox = (await request(app).get('/api/notifications').set(auth(tunde)).expect(200)).body;
    expect(inbox.notifications[0]).toMatchObject({ type: 'assigned', taskId: task.id });
    expect(inbox.unread).toBeGreaterThan(0);

    await request(app).post(`/api/tasks/${task.id}/transitions`).set(auth(tunde)).send({ action: 'block', reason: 'Need vault access', waitingOnId: 'demo-kemi' }).expect(200);
    const kemiInbox = (await request(app).get('/api/notifications').set(auth(kemi)).expect(200)).body;
    expect(kemiInbox.notifications[0]).toMatchObject({ type: 'blocked_on_you' });

    await request(app).post(`/api/tasks/${task.id}/transitions`).set(auth(tunde)).send({ action: 'unblock' }).expect(200);
    await request(app).post(`/api/tasks/${task.id}/transitions`).set(auth(tunde)).send({ action: 'submit', proofs: [{ kind: 'note', note: 'Rotated all keys' }] }).expect(200);
    const adaInbox = (await request(app).get('/api/notifications').set(auth(ada)).expect(200)).body;
    expect(adaInbox.notifications.some((n: { type: string }) => n.type === 'awaiting_audit')).toBe(true);

    await request(app).post('/api/notifications/read').set(auth(tunde)).send({ ids: 'all' }).expect(200);
    inbox = (await request(app).get('/api/notifications').set(auth(tunde)).expect(200)).body;
    expect(inbox.unread).toBe(0);
  });
});

/* ----------------------------------------------------------------------------- Slack */

describe('Slack', () => {
  const SLACK = { SLACK_CLIENT_ID: 'cid', SLACK_CLIENT_SECRET: 'csecret', SLACK_SIGNING_SECRET: 'slack-signing', SIMULATE_PROVIDERS: 'false' };
  const signed = (body: string, secret = 'slack-signing') => {
    const ts = String(Math.floor(Date.now() / 1000));
    return { 'x-slack-request-timestamp': ts, 'x-slack-signature': `v0=${createHmac('sha256', secret).update(`v0:${ts}:${body}`).digest('hex')}`, 'content-type': 'application/x-www-form-urlencoded' };
  };

  async function connect(secrets: Secrets) {
    await store.saveIntegration({
      orgId: orgId(),
      provider: 'slack',
      config: { teamId: 'T123', teamName: 'Lumen', channel: '#ops' },
      secret: secrets.seal({ botToken: 'xoxb-test', webhookUrl: 'https://hooks.slack.com/services/T/B/X' }),
      events: ['assigned', 'blocked', 'submitted', 'approved', 'escalated', 'digest'],
      status: 'connected',
      lastError: null,
      createdById: 'demo-ada',
    });
  }

  it('builds an OAuth install URL with a signed state', async () => {
    const { app } = build(SLACK);
    const ada = await token(app, 'demo-ada');
    const res = await request(app).post('/api/integrations/slack/install').set(auth(ada)).expect(200);
    const url = new URL(res.body.url);
    expect(url.origin + url.pathname).toBe('https://slack.com/oauth/v2/authorize');
    expect(url.searchParams.get('scope')).toContain('commands');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.delegate.test/api/integrations/slack/callback');
    expect(url.searchParams.get('state')!.split('.')).toHaveLength(3);
  });

  it('turns /delegate into a task assigned to the mentioned teammate, and posts to the channel', async () => {
    const { app, secrets, calls } = build(SLACK, [
      {
        match: (u) => u.includes('slack.com/api/users.info'),
        respond: (c) => ({ ok: true, user: { profile: { email: new URLSearchParams(c.body).get('user') === 'U01ADA' ? 'ada@lumen.example' : 'tunde@lumen.example' } } }),
      },
    ]);
    await connect(secrets);
    const body = new URLSearchParams({ team_id: 'T123', user_id: 'U01ADA', command: '/delegate', text: 'Renew the SSL cert <@U01TUNDE|tunde> tomorrow !urgent', response_url: 'https://hooks.slack.com/commands/x' }).toString();
    await request(app).post('/api/hooks/slack/commands').set({ ...signed(body, 'wrong') }).send(body).expect(401);
    const res = await request(app).post('/api/hooks/slack/commands').set(signed(body)).send(body).expect(200);
    expect(res.body.response_type).toBe('ephemeral');
    expect(res.body.text).toMatch(/Created DLG-\d+ “Renew the SSL cert” for Tunde Bakare/);
    const task = taskBy('Renew the SSL cert');
    expect(task).toMatchObject({ assigneeId: 'demo-tunde', createdById: 'demo-ada', source: 'slack', priority: 'urgent' });
    const post = calls.find((c) => c.url === 'https://hooks.slack.com/services/T/B/X');
    expect(post).toBeTruthy();
    expect(JSON.parse(post!.body).blocks[0].text.text).toContain('assigned DLG-');
  });

  it('lets people move their own tasks from Slack', async () => {
    const { app, secrets } = build(SLACK, [{ match: (u) => u.includes('users.info'), respond: () => ({ ok: true, user: { profile: { email: 'tunde@lumen.example' } } }) }]);
    await connect(secrets);
    const t = [...store.tasks.values()].find((x) => x.assigneeId === 'demo-tunde' && x.status === 'open')!;
    const body = new URLSearchParams({ team_id: 'T123', user_id: 'U01TUNDE', text: `start DLG-${t.seq}` }).toString();
    const res = await request(app).post('/api/hooks/slack/commands').set(signed(body)).send(body).expect(200);
    expect(res.body.text).toContain('In progress');
    expect(store.tasks.get(t.id)!.status).toBe('in_progress');
  });
});

/* ----------------------------------------------------------------------------- Teams */

describe('Microsoft Teams', () => {
  it('rejects non-Microsoft webhook URLs (SSRF guard) and accepts Workflows URLs', async () => {
    const { app } = build({ SIMULATE_PROVIDERS: 'false' });
    const ada = await token(app, 'demo-ada');
    await request(app).post('/api/integrations/teams').set(auth(ada)).send({ webhookUrl: 'http://169.254.169.254/latest' }).expect(400);
    const ok = await request(app)
      .post('/api/integrations/teams')
      .set(auth(ada))
      .send({ webhookUrl: 'https://prod-01.westeurope.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke?sig=xyz' })
      .expect(200);
    expect(ok.body.outgoingUrl).toMatch(/\/api\/hooks\/teams\//);
  });

  it('handles "@Delegate new …" from an outgoing webhook and posts an Adaptive Card', async () => {
    const { app, calls } = build({ SIMULATE_PROVIDERS: 'false' });
    const ada = await token(app, 'demo-ada');
    const securityToken = randomBytes(32).toString('base64');
    const conn = (
      await request(app)
        .post('/api/integrations/teams')
        .set(auth(ada))
        .send({ webhookUrl: 'https://prod-01.westeurope.logic.azure.com/workflows/abc/triggers/manual/paths/invoke?sig=xyz', outgoingToken: securityToken })
        .expect(200)
    ).body;
    const activity = JSON.stringify({ type: 'message', text: '<at>Delegate</at> new Prepare payroll export <at>Maya Chen</at> friday', from: { name: 'Ada Okafor' } });
    const sig = (key: string) => `HMAC ${createHmac('sha256', Buffer.from(key, 'base64')).update(activity).digest('base64')}`;
    const path = new URL(conn.outgoingUrl).pathname;
    await request(app).post(path).set('authorization', sig(randomBytes(32).toString('base64'))).set('content-type', 'application/json').send(activity).expect(401);
    const res = await request(app).post(path).set('authorization', sig(securityToken)).set('content-type', 'application/json').send(activity).expect(200);
    expect(res.body.type).toBe('message');
    expect(res.body.text).toMatch(/Created DLG-\d+ “Prepare payroll export” for Maya Chen/);
    expect(taskBy('Prepare payroll export')).toMatchObject({ assigneeId: 'demo-maya', source: 'teams' });
    const card = calls.find((c) => c.url.includes('logic.azure.com'));
    expect(JSON.parse(card!.body).attachments[0].contentType).toBe('application/vnd.microsoft.card.adaptive');
  });
});

/* ----------------------------------------------------------------------------- WhatsApp */

describe('WhatsApp', () => {
  const WA = { WHATSAPP_TOKEN: 'EAAG-test', WHATSAPP_PHONE_NUMBER_ID: '1098', WHATSAPP_APP_SECRET: 'meta-secret', WHATSAPP_VERIFY_TOKEN: 'verify-me', WHATSAPP_BUSINESS_NUMBER: '+234 801 000 0000', SIMULATE_PROVIDERS: 'false' };
  const message = (from: string, text: string, id = `wamid.${Math.random()}`) =>
    JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { messaging_product: 'whatsapp', messages: [{ id, from, type: 'text', text: { body: text } }] } }] }] });
  const sign = (body: string, secret = 'meta-secret') => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

  it('verifies the webhook subscription challenge', async () => {
    const { app } = build(WA);
    await request(app).get('/api/hooks/whatsapp').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': '42' }).expect(403);
    const res = await request(app).get('/api/hooks/whatsapp').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': '42' }).expect(200);
    expect(res.text).toBe('42');
  });

  it('links a phone with a one-time code, then runs list/start/done from WhatsApp', async () => {
    const { app, calls } = build(WA);
    const ada = await token(app, 'demo-ada');
    const tunde = await token(app, 'demo-tunde');
    await request(app).post('/api/integrations/whatsapp').set(auth(ada)).send({ enabled: true }).expect(200);
    const link = (await request(app).post('/api/integrations/whatsapp/link-code').set(auth(tunde)).expect(200)).body;
    expect(link.link).toBe(`https://wa.me/2348010000000?text=LINK%20${link.code}`);

    const phone = '2348031234567';
    const linkMsg = message(phone, `LINK ${link.code}`);
    await request(app).post('/api/hooks/whatsapp').set('x-hub-signature-256', sign(linkMsg, 'wrong')).set('content-type', 'application/json').send(linkMsg).expect(401);
    await request(app).post('/api/hooks/whatsapp').set('x-hub-signature-256', sign(linkMsg)).set('content-type', 'application/json').send(linkMsg).expect(200);
    expect(store.profiles.get('demo-tunde')!.phone).toBe(phone);

    const t = [...store.tasks.values()].find((x) => x.assigneeId === 'demo-tunde' && x.status === 'open')!;
    for (const text of ['list', `start DLG-${t.seq}`, `done DLG-${t.seq} https://github.com/lumen/pr/9 patched`]) {
      const body = message(phone, text);
      await request(app).post('/api/hooks/whatsapp').set('x-hub-signature-256', sign(body)).set('content-type', 'application/json').send(body).expect(200);
    }
    expect(store.tasks.get(t.id)!.status).toBe('done');
    const replies = calls.filter((c) => c.url === 'https://graph.facebook.com/v21.0/1098/messages').map((c) => JSON.parse(c.body));
    expect(replies.some((r) => r.type === 'text' && r.text.body.includes('Your tasks'))).toBe(true);
    expect(replies.some((r) => r.type === 'text' && r.text.body.includes('→ Executed'))).toBe(true);
    expect(calls.every((c) => !c.url.includes('graph.facebook.com') || c.headers.authorization === 'Bearer EAAG-test')).toBe(true);

    // Meta retries deliveries: the same message id is processed once.
    const dup = message(phone, 'list', 'wamid.same');
    await request(app).post('/api/hooks/whatsapp').set('x-hub-signature-256', sign(dup)).set('content-type', 'application/json').send(dup).expect(200);
    const before = calls.length;
    await request(app).post('/api/hooks/whatsapp').set('x-hub-signature-256', sign(dup)).set('content-type', 'application/json').send(dup).expect(200);
    expect(calls.length).toBe(before);
  });

  it('sends the approved template when a task is assigned to a linked teammate', async () => {
    const { app, calls } = build(WA);
    const ada = await token(app, 'demo-ada');
    await request(app).post('/api/integrations/whatsapp').set(auth(ada)).send({ enabled: true }).expect(200);
    await store.setProfilePhone('demo-maya', '2348039990000');
    await createTask(app, ada, { title: 'Count the warehouse stock', assigneeId: 'demo-maya' });
    const sent = calls.map((c) => (c.url.includes('graph.facebook.com') ? JSON.parse(c.body) : null)).find((b) => b?.type === 'template');
    expect(sent).toMatchObject({ to: '2348039990000', template: { name: 'delegate_task_assigned', language: { code: 'en' } } });
    expect(sent.template.components[0].parameters[1].text).toBe('Count the warehouse stock');
    // Due time is shown in the workspace's time zone, not UTC.
    expect(sent.template.components[0].parameters[3].text).toMatch(/^(no due date|\w{3} \d{1,2} \w{3}, \d{2}:\d{2})$/);

    // One-tap quick action: the template's "Start" button carries "start DLG-n" back to us.
    const task = [...store.tasks.values()].find((t) => t.title === 'Count the warehouse stock')!;
    expect(sent.template.components[1]).toEqual({ type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: `start DLG-${task.seq}` }] });
    const tap = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: { messages: [{ id: 'wamid.tap', from: '2348039990000', type: 'button', button: { text: 'Start', payload: `start DLG-${task.seq}` } }] } }] }],
    });
    await request(app).post('/api/hooks/whatsapp').set('x-hub-signature-256', sign(tap)).set('content-type', 'application/json').send(tap).expect(200);
    expect(store.tasks.get(task.id)!.status).toBe('in_progress');
  });
});

/* ----------------------------------------------------------------------------- GitHub */

describe('GitHub auto-proof', () => {
  it('a merged PR mentioning DLG-n executes the task with verified proof; forged deliveries are rejected', async () => {
    const { app } = build();
    const ada = await token(app, 'demo-ada');
    const conn = (await request(app).post('/api/integrations/github').set(auth(ada)).expect(200)).body;
    const path = new URL(conn.webhookUrl).pathname;
    const task = await createTask(app, ada, { title: 'Add rate limiting', assigneeId: 'demo-leo' });
    const payload = JSON.stringify({
      action: 'closed',
      repository: { full_name: 'lumen/api' },
      pull_request: { number: 57, title: `DLG-${task.seq}: add rate limiting`, body: '', html_url: 'https://github.com/lumen/api/pull/57', merged: true, merged_by: { login: 'leo' }, base: { ref: 'main' }, head: { ref: 'feat/limits' } },
    });
    const sig = (secret: string) => `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
    const headers = { 'x-github-event': 'pull_request', 'x-github-delivery': 'd-1', 'content-type': 'application/json' };
    await request(app).post(path).set({ ...headers, 'x-hub-signature-256': sig('wrong') }).send(payload).expect(401);
    const res = await request(app).post(path).set({ ...headers, 'x-hub-signature-256': sig(conn.secret) }).send(payload).expect(200);
    expect(res.body.results).toEqual([`DLG-${task.seq}:submitted`]);
    const t = store.tasks.get(task.id)!;
    expect(t.status).toBe('done');
    const proof = [...store.proofs.values()].find((p) => p.taskId === task.id)!;
    expect(proof).toMatchObject({ source: 'github', verified: true, url: 'https://github.com/lumen/api/pull/57', authorId: 'demo-leo' });
    const ledger = store.events.filter((e) => e.taskId === task.id).map((e) => [e.type, e.actorId, e.meta.source]);
    expect(ledger).toContainEqual(['task.submitted', null, 'github']);

    // Same delivery again → ignored.
    const again = await request(app).post(path).set({ ...headers, 'x-hub-signature-256': sig(conn.secret) }).send(payload).expect(200);
    expect(again.body.duplicate).toBe(true);
  });

  it('a push with "fixes DLG-n" submits; a plain mention only attaches proof', async () => {
    const { app } = build();
    const ada = await token(app, 'demo-ada');
    const conn = (await request(app).post('/api/integrations/github').set(auth(ada)).expect(200)).body;
    const a = await createTask(app, ada, { title: 'Fix login redirect', assigneeId: 'demo-tunde' });
    const b = await createTask(app, ada, { title: 'Refactor auth module', assigneeId: 'demo-tunde' });
    const payload = JSON.stringify({
      repository: { full_name: 'lumen/web' },
      commits: [
        { id: 'abc1234def', message: `Fixes DLG-${a.seq}: redirect loop`, url: 'https://github.com/lumen/web/commit/abc1234', author: { name: 'Tunde' } },
        { id: 'fff9999aaa', message: `WIP on DLG-${b.seq}`, url: 'https://github.com/lumen/web/commit/fff9999', author: { name: 'Tunde' } },
      ],
    });
    await request(app)
      .post(new URL(conn.webhookUrl).pathname)
      .set({ 'x-github-event': 'push', 'x-github-delivery': 'd-2', 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${createHmac('sha256', conn.secret).update(payload).digest('hex')}` })
      .send(payload)
      .expect(200);
    expect(store.tasks.get(a.id)!.status).toBe('done');
    expect(store.tasks.get(b.id)!.status).toBe('open');
    expect([...store.proofs.values()].some((p) => p.taskId === b.id && p.source === 'github')).toBe(true);
  });
});

/* ----------------------------------------------------------------------------- automations */

describe('automations', () => {
  it('escalates a blocker to managers after 4h and to the owner after 24h — once each', async () => {
    const { app } = build();
    const ada = await token(app, 'demo-ada');
    const leo = await token(app, 'demo-leo');
    const task = await createTask(app, ada, { title: 'Ship status page', assigneeId: 'demo-leo' });
    await request(app).post(`/api/tasks/${task.id}/transitions`).set(auth(leo)).send({ action: 'block', reason: 'Waiting on DNS access' }).expect(200);
    const blockedAt = new Date(store.tasks.get(task.id)!.blockedAt!).getTime();
    const tick = (h: number) => app.services.automation.tick(new Date(blockedAt + h * 3_600_000));

    await tick(1);
    expect(store.tasks.get(task.id)!.escalationLevel).toBe(0);
    await tick(5);
    expect(store.tasks.get(task.id)!.escalationLevel).toBe(1);
    const kemiEsc = store.notifications.filter((n) => n.userId === 'demo-kemi' && n.type === 'escalated' && n.taskId === task.id);
    expect(kemiEsc).toHaveLength(1);
    await tick(6);
    expect(store.notifications.filter((n) => n.userId === 'demo-kemi' && n.type === 'escalated' && n.taskId === task.id)).toHaveLength(1);
    await tick(25);
    expect(store.tasks.get(task.id)!.escalationLevel).toBe(2);
    expect(store.events.filter((e) => e.taskId === task.id && e.type === 'task.escalated')).toHaveLength(2);
    // Moving the task resets the ladder.
    await request(app).post(`/api/tasks/${task.id}/transitions`).set(auth(leo)).send({ action: 'unblock' }).expect(200);
    expect(store.tasks.get(task.id)!.escalationLevel).toBe(0);
  });

  it('runs a due playbook once per day, and "Run now" on demand', async () => {
    const { app } = build();
    const ada = await token(app, 'demo-ada');
    const pb = (
      await request(app)
        .post('/api/playbooks')
        .set(auth(ada))
        .send({ name: 'Night shift handover', cadence: 'daily', timeOfDay: '00:00', items: [{ title: 'Log cash drawer totals', assigneeId: 'demo-maya', dueInHours: 2 }] })
        .expect(201)
    ).body.playbook;
    const count = () => [...store.tasks.values()].filter((t) => t.playbookId === pb.id).length;
    await app.services.automation.tick();
    expect(count()).toBe(1);
    await app.services.automation.tick();
    expect(count()).toBe(1);
    await request(app).post(`/api/playbooks/${pb.id}/run`).set(auth(ada)).expect(200);
    expect(count()).toBe(2);
    expect([...store.tasks.values()].find((t) => t.playbookId === pb.id)!.source).toBe('playbook');
    const tunde = await token(app, 'demo-tunde');
    await request(app).post('/api/playbooks').set(auth(tunde)).send({ name: 'Nope', cadence: 'daily', timeOfDay: '09:00', items: [{ title: 'x y z', assigneeId: 'demo-maya' }] }).expect(403);
  });

  it('sends the morning brief once, to the channel and as a ledger-backed standup', async () => {
    const { app, secrets } = build();
    await store.saveIntegration({ orgId: orgId(), provider: 'slack', config: { teamId: 'T9', channel: '#ops' }, secret: secrets.seal({ botToken: 'x', webhookUrl: 'https://hooks.slack.com/services/A' }), events: ['digest'], status: 'connected', lastError: null, createdById: 'demo-ada' });
    const org = store.orgs.get(orgId())!;
    org.settings = { ...org.settings, lastDigestOn: null, digest: { enabled: true, hour: 0 } };
    const first = await app.services.automation.tick();
    const second = await app.services.automation.tick();
    expect(first.digests).toBe(1);
    expect(second.digests).toBe(0);
    expect(store.outbound.filter((m) => m.channel === 'slack' && m.summary.startsWith('Standup'))).toHaveLength(1);
  });

  it('protects the cron endpoint with CRON_SECRET (GET for Vercel Cron, POST for pg_cron)', async () => {
    const { app } = build();
    await request(app).get('/api/cron/tick').expect(401);
    await request(app).get('/api/cron/tick').set('authorization', 'Bearer cron-secret').expect(200);
    const res = await request(app).post('/api/cron/tick').set('x-cron-secret', 'cron-secret').expect(200);
    expect(res.body.workspaces).toBe(1);
  });
});

/* ----------------------------------------------------------------------------- Google Drive */

describe('Google Drive verified proof', () => {
  it('verifies the file with Google, signs an attestation, and stores a verified proof', async () => {
    const { app } = build({ GOOGLE_CLIENT_ID: 'gid.apps.googleusercontent.com', GOOGLE_API_KEY: 'AIza-test', GOOGLE_PROJECT_NUMBER: '1234567890' }, [
      {
        match: (u) => u.startsWith('https://www.googleapis.com/drive/v3/files/'),
        respond: () => ({ id: 'file_abcdefghijk', name: 'Q4 board deck', webViewLink: 'https://docs.google.com/presentation/d/file_abcdefghijk/edit', modifiedTime: new Date().toISOString(), lastModifyingUser: { displayName: 'Kemi Adeyemi', emailAddress: 'kemi@lumen.example' } }),
      },
    ]);
    const kemi = await token(app, 'demo-kemi');
    const deck = taskBy('Finalize Q4 board deck');
    const check = await request(app).post(`/api/tasks/${deck.id}/drive-proof`).set(auth(kemi)).send({ fileId: 'file_abcdefghijk', accessToken: 'ya29.test-token' }).expect(200);
    expect(check.body.preview).toMatchObject({ verified: true, fileName: 'Q4 board deck' });
    await request(app).post(`/api/tasks/${deck.id}/transitions`).set(auth(kemi)).send({ action: 'submit', proofs: [{ kind: 'link', attestation: `${check.body.attestation}x` }] }).expect(400);
    await request(app).post(`/api/tasks/${deck.id}/transitions`).set(auth(kemi)).send({ action: 'submit', proofs: [{ kind: 'link', attestation: check.body.attestation }] }).expect(200);
    const proof = [...store.proofs.values()].find((p) => p.taskId === deck.id)!;
    expect(proof).toMatchObject({ source: 'gdrive', verified: true, url: 'https://docs.google.com/presentation/d/file_abcdefghijk/edit' });
  });
});

describe('invite codes still respect paid seats', () => {
  it('lets people join a paid Team workspace beyond five members', async () => {
    const { app } = build();
    for (let i = 0; i < 3; i++) {
      const t = await newUserToken(app, `n${i}@lumen.example`, `New ${i}`);
      await request(app).post('/api/onboarding/join').set(auth(t)).send({ code: DEMO_ORG_INVITE }).expect(201);
    }
    expect(store.memberships.filter((m) => m.orgId === orgId())).toHaveLength(9);
  });
});
