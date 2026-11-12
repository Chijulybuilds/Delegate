import { jwtVerify, SignJWT } from 'jose';
import {
  CHANNEL_EVENTS,
  isManagerRole,
  TASK_REF_PATTERN,
  taskRef,
  type ChannelEvent,
  type IntegrationProvider,
  type IntegrationsOverview,
  type IntegrationSummary,
  type Member,
  type Profile,
} from '@delegate/shared';
import type { AppConfig } from '../config.js';
import { hmac, mask, randomToken, safeEqual, shortCode, type Secrets } from '../lib/crypto.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import type { IntegrationRecord, Store } from '../store/types.js';
import type { BillingService } from './billing.js';
import { isTeamsWebhookUrl, normalizePhone, SlackApi, verifyMetaSignature, verifySlackRequest, verifyTeamsOutgoing, type Http } from './channels.js';
import type { CommandService } from './commands.js';
import type { Notifier, SlackSecret, TeamsSecret } from './notify.js';
import type { Ctx, WorkspaceService } from './workspace.js';

const DEFAULT_EVENTS: ChannelEvent[] = ['assigned', 'blocked', 'submitted', 'approved', 'escalated', 'digest'];
const SLACK_SCOPES = 'commands,chat:write,users:read,users:read.email,incoming-webhook';
const CLOSING = /\b(?:fix(?:e[sd])?|close[sd]?|resolve[sd]?|done)\s*:?\s+DLG-(\d{1,7})\b/gi;

interface GitHubSecret {
  webhookSecret: string;
}

export interface HookResult {
  status: number;
  body: unknown;
  contentType?: 'json' | 'text';
}

export class IntegrationService {
  private slackApi: SlackApi;
  private stateKey: Uint8Array;

  constructor(
    private store: Store,
    private config: AppConfig,
    private secrets: Secrets,
    private notifier: Notifier,
    private workspace: WorkspaceService,
    private commands: CommandService,
    private billing: BillingService,
    http: Http,
  ) {
    this.slackApi = new SlackApi(http);
    this.stateKey = new Uint8Array(config.encryptionKey);
  }

  private appUrl() {
    return this.notifier.appUrl();
  }

  private requireManager(ctx: Ctx) {
    if (!isManagerRole(ctx.role)) throw forbidden('Only managers can manage integrations');
  }

  /* ------------------------------------------------------------------ overview */

  async overview(ctx: Ctx): Promise<IntegrationsOverview> {
    const records = await this.store.listIntegrations(ctx.orgId);
    const profile = await this.store.getProfile(ctx.userId);
    const code = await this.store.getActiveLinkCode(ctx.userId);
    const summaries = (['slack', 'teams', 'whatsapp', 'github', 'gdrive'] as IntegrationProvider[]).map((p) => this.summary(p, records.find((r) => r.provider === p)));
    const number = this.config.whatsapp?.businessNumber;
    return {
      integrations: summaries,
      deliveries: isManagerRole(ctx.role) ? await this.store.listOutbound(ctx.orgId, 25) : [],
      me: {
        phone: profile?.phone ?? null,
        whatsappLinkCode: code?.code ?? null,
        whatsappLink: code && number ? `https://wa.me/${number}?text=${encodeURIComponent(`LINK ${code.code}`)}` : null,
      },
    };
  }

  private summary(provider: IntegrationProvider, r?: IntegrationRecord): IntegrationSummary {
    if (provider === 'gdrive') {
      return { provider, connected: !!this.config.google, connectedAt: null, connectedBy: null, details: { platform: true }, events: [], lastError: this.config.google ? null : 'Set GOOGLE_CLIENT_ID, GOOGLE_API_KEY and GOOGLE_PROJECT_NUMBER on the server' };
    }
    const details: IntegrationSummary['details'] = {};
    if (r) for (const [k, v] of Object.entries(r.config)) if (['string', 'number', 'boolean'].includes(typeof v) || v === null) details[k] = v as string | number | boolean | null;
    if (provider === 'teams' && r) details.outgoingUrl = `${this.appUrl()}/api/hooks/teams/${r.id}`;
    if (provider === 'github' && r) details.webhookUrl = `${this.appUrl()}/api/hooks/github/${r.id}`;
    if (provider === 'whatsapp') {
      details.platformReady = !!this.config.whatsapp || this.config.simulateProviders;
      details.businessNumber = this.config.whatsapp?.businessNumber ?? null;
    }
    if (provider === 'slack') details.platformReady = !!this.config.slack || this.config.simulateProviders;
    return {
      provider,
      connected: !!r,
      connectedAt: r?.createdAt ?? null,
      connectedBy: r?.createdById ?? null,
      details,
      events: r?.events ?? [],
      lastError: r?.lastError ?? null,
    };
  }

  async updateEvents(ctx: Ctx, provider: IntegrationProvider, events: ChannelEvent[]) {
    this.requireManager(ctx);
    const r = await this.store.getIntegrationFor(ctx.orgId, provider);
    if (!r) throw notFound('Not connected');
    await this.store.saveIntegration({ ...r, events: events.filter((e) => (CHANNEL_EVENTS as readonly string[]).includes(e)) });
  }

  async disconnect(ctx: Ctx, provider: IntegrationProvider) {
    this.requireManager(ctx);
    const r = await this.store.getIntegrationFor(ctx.orgId, provider);
    if (!r) return;
    await this.store.deleteIntegration(r.id);
    await this.store.appendEvent({ orgId: ctx.orgId, taskId: null, actorId: ctx.userId, type: 'integration.disconnected', fromStatus: null, toStatus: null, meta: { provider } });
  }

  async sendTest(ctx: Ctx, provider: IntegrationProvider) {
    this.requireManager(ctx);
    const r = await this.store.getIntegrationFor(ctx.orgId, provider);
    if (!r || (provider !== 'slack' && provider !== 'teams')) throw badRequest('Connect Slack or Teams first');
    await this.notifier.postToIntegration(r, { title: 'Delegate is connected ✓', body: 'Assignments, blockers, proof and audits will appear in this channel.', url: `${this.appUrl()}/app` });
    return (await this.store.listOutbound(ctx.orgId, 1))[0] ?? null;
  }

  private async connected(ctx: Ctx, provider: IntegrationProvider, details: Record<string, unknown>) {
    await this.store.appendEvent({ orgId: ctx.orgId, taskId: null, actorId: ctx.userId, type: 'integration.connected', fromStatus: null, toStatus: null, meta: { provider, ...details } });
  }

  /* ------------------------------------------------------------------ Slack */

  async slackInstallUrl(ctx: Ctx): Promise<{ url: string }> {
    this.requireManager(ctx);
    if (!this.config.slack) {
      if (this.config.simulateProviders) {
        await this.store.saveIntegration({ orgId: ctx.orgId, provider: 'slack', config: { teamId: `T-DEMO-${ctx.orgId.slice(0, 6)}`, teamName: 'Demo Slack', channel: '#delegate', simulated: true }, secret: this.secrets.seal({ botToken: 'xoxb-demo', webhookUrl: null }), events: DEFAULT_EVENTS, status: 'connected', lastError: null, createdById: ctx.userId });
        await this.connected(ctx, 'slack', { simulated: true });
        return { url: '/app/settings?tab=integrations&connected=slack' };
      }
      throw badRequest('Slack is not configured on this server (SLACK_CLIENT_ID / SLACK_CLIENT_SECRET / SLACK_SIGNING_SECRET)');
    }
    const state = await new SignJWT({ orgId: ctx.orgId, userId: ctx.userId }).setProtectedHeader({ alg: 'HS256' }).setAudience('slack-install').setExpirationTime('15m').sign(this.stateKey);
    const params = new URLSearchParams({ client_id: this.config.slack.clientId, scope: SLACK_SCOPES, redirect_uri: `${this.appUrl()}/api/integrations/slack/callback`, state });
    return { url: `https://slack.com/oauth/v2/authorize?${params.toString()}` };
  }

  /** OAuth redirect target. Returns where to send the browser next. */
  async slackCallback(code: string | undefined, state: string | undefined, error: string | undefined): Promise<string> {
    const back = (q: string) => `${this.appUrl()}/app/settings?tab=integrations&${q}`;
    if (error) return back(`error=${encodeURIComponent(error)}`);
    if (!this.config.slack || !code || !state) return back('error=slack_not_configured');
    let orgId: string;
    let userId: string;
    try {
      const { payload } = await jwtVerify(state, this.stateKey, { audience: 'slack-install' });
      orgId = String(payload.orgId);
      userId = String(payload.userId);
    } catch {
      return back('error=expired');
    }
    try {
      const res = await this.slackApi.call<{
        access_token: string;
        team: { id: string; name: string };
        incoming_webhook?: { channel: string; channel_id: string; url: string };
      }>('oauth.v2.access', null, {
        client_id: this.config.slack.clientId,
        client_secret: this.config.slack.clientSecret,
        code,
        redirect_uri: `${this.appUrl()}/api/integrations/slack/callback`,
      });
      const other = await this.store.findIntegrationByConfig('slack', 'teamId', res.team.id);
      if (other && other.orgId !== orgId) return back('error=slack_in_use');
      await this.store.saveIntegration({
        orgId,
        provider: 'slack',
        config: { teamId: res.team.id, teamName: res.team.name, channel: res.incoming_webhook?.channel ?? null, channelId: res.incoming_webhook?.channel_id ?? null },
        secret: this.secrets.seal({ botToken: res.access_token, webhookUrl: res.incoming_webhook?.url ?? null } satisfies SlackSecret),
        events: DEFAULT_EVENTS,
        status: 'connected',
        lastError: null,
        createdById: userId,
      });
      await this.store.appendEvent({ orgId, taskId: null, actorId: userId, type: 'integration.connected', fromStatus: null, toStatus: null, meta: { provider: 'slack', team: res.team.name } });
      return back('connected=slack');
    } catch (e) {
      console.error('[slack] oauth failed', e);
      return back('error=slack_oauth_failed');
    }
  }

  private async slackMember(i: IntegrationRecord, slackUserId: string): Promise<{ ctx: Ctx; member: Member } | null> {
    const secret = this.secrets.open<SlackSecret>(i.secret);
    if (!secret?.botToken) return null;
    let email: string | undefined;
    if (i.config.simulated) email = undefined;
    else {
      const info = await this.slackApi.call<{ user: { profile?: { email?: string } } }>('users.info', secret.botToken, { user: slackUserId });
      email = info.user.profile?.email;
    }
    if (!email) return null;
    const members = await this.store.listMembers(i.orgId);
    const member = members.find((m) => m.email.toLowerCase() === email!.toLowerCase());
    return member ? { ctx: { userId: member.userId, orgId: i.orgId, role: member.role }, member } : null;
  }

  /** `/delegate …` slash command. Must answer within 3 seconds. */
  async handleSlackCommand(rawBody: string, headers: Record<string, string | string[] | undefined>): Promise<HookResult> {
    if (!this.config.slack) return { status: 404, body: { error: 'not_configured' } };
    if (!verifySlackRequest(this.config.slack.signingSecret, headers, rawBody)) return { status: 401, body: { error: 'bad_signature' } };
    const form = new URLSearchParams(rawBody);
    const i = await this.store.findIntegrationByConfig('slack', 'teamId', form.get('team_id') ?? '');
    if (!i) return { status: 200, body: { response_type: 'ephemeral', text: 'Delegate is not connected to this Slack workspace yet. A manager can connect it in Delegate → Settings → Integrations.' } };
    const who = await this.slackMember(i, form.get('user_id') ?? '');
    if (!who) return { status: 200, body: { response_type: 'ephemeral', text: 'I could not match your Slack email to a Delegate member. Sign in to Delegate with the same email.' } };
    const text = form.get('text') ?? '';
    // Slack escapes mentions as <@U123|name>; resolve them to Delegate members by email.
    const mentionIds = [...text.matchAll(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g)].map((m) => m[1]!);
    const mentioned: string[] = [];
    for (const id of mentionIds.slice(0, 3)) {
      const m = await this.slackMember(i, id);
      if (m) mentioned.push(m.member.userId);
    }
    const org = await this.store.getOrg(i.orgId);
    const reply = await this.commands.execute({ ctx: who.ctx, channel: 'slack', timezone: org?.timezone ?? 'UTC', appUrl: this.appUrl(), mentionedUserIds: mentioned }, text.replace(/<@[^>]+>/g, ' '));
    return { status: 200, body: { response_type: 'ephemeral', text: reply } };
  }

  /** Interactivity: the "Create Delegate task" message shortcut (callback_id delegate_create_task). */
  async handleSlackInteraction(rawBody: string, headers: Record<string, string | string[] | undefined>): Promise<HookResult> {
    if (!this.config.slack) return { status: 404, body: { error: 'not_configured' } };
    if (!verifySlackRequest(this.config.slack.signingSecret, headers, rawBody)) return { status: 401, body: { error: 'bad_signature' } };
    const payload = JSON.parse(new URLSearchParams(rawBody).get('payload') ?? '{}') as {
      type?: string;
      callback_id?: string;
      team?: { id: string };
      user?: { id: string };
      message?: { text?: string };
      response_url?: string;
    };
    if (payload.type !== 'message_action' || payload.callback_id !== 'delegate_create_task') return { status: 200, body: '', contentType: 'text' };
    const i = await this.store.findIntegrationByConfig('slack', 'teamId', payload.team?.id ?? '');
    const respond = (text: string) => (payload.response_url ? this.slackApi.respond(payload.response_url, text).catch(() => undefined) : undefined);
    if (!i) {
      await respond('Delegate is not connected to this Slack workspace yet.');
      return { status: 200, body: '', contentType: 'text' };
    }
    const who = await this.slackMember(i, payload.user?.id ?? '');
    if (!who) {
      await respond('I could not match your Slack email to a Delegate member.');
      return { status: 200, body: '', contentType: 'text' };
    }
    const text = (payload.message?.text ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text.length < 3) {
      await respond('That message has no text to turn into a task.');
      return { status: 200, body: '', contentType: 'text' };
    }
    const task = await this.workspace.createTask(who.ctx, { title: text.slice(0, 120), description: text }, 'slack');
    await respond(`✅ Created ${taskRef(task.seq)} “${task.title}”. Open it to assign or set a due date: ${this.appUrl()}/app?task=${task.id}`);
    return { status: 200, body: '', contentType: 'text' };
  }

  /* ------------------------------------------------------------------ Microsoft Teams */

  async connectTeams(ctx: Ctx, input: { webhookUrl?: string | null; outgoingToken?: string | null }) {
    this.requireManager(ctx);
    const existing = await this.store.getIntegrationFor(ctx.orgId, 'teams');
    const prev = this.secrets.open<TeamsSecret>(existing?.secret) ?? { webhookUrl: null, outgoingToken: null };
    const webhookUrl = input.webhookUrl === undefined ? prev.webhookUrl : input.webhookUrl?.trim() || null;
    const outgoingToken = input.outgoingToken === undefined ? prev.outgoingToken : input.outgoingToken?.trim() || null;
    if (webhookUrl && !isTeamsWebhookUrl(webhookUrl) && !this.config.simulateProviders) {
      throw badRequest('Paste the HTTPS URL from the Teams "Post to a channel when a webhook request is received" workflow');
    }
    if (outgoingToken && !/^[A-Za-z0-9+/=]{20,}$/.test(outgoingToken)) throw badRequest('That does not look like a Teams outgoing-webhook security token');
    const saved = await this.store.saveIntegration({
      orgId: ctx.orgId,
      provider: 'teams',
      config: {
        maskedWebhook: webhookUrl ? `${new URL(webhookUrl).hostname}/…${webhookUrl.slice(-6)}` : null,
        notifications: !!webhookUrl,
        commands: !!outgoingToken,
        ...(this.config.simulateProviders ? { simulated: true } : {}),
      },
      secret: this.secrets.seal({ webhookUrl, outgoingToken } satisfies TeamsSecret),
      events: existing?.events ?? DEFAULT_EVENTS,
      status: 'connected',
      lastError: null,
      createdById: existing?.createdById ?? ctx.userId,
    });
    if (!existing) await this.connected(ctx, 'teams', {});
    return { id: saved.id, outgoingUrl: `${this.appUrl()}/api/hooks/teams/${saved.id}` };
  }

  /** Teams outgoing webhook: "@Delegate new Fix checkout @Tunde Bakare tomorrow". Reply within 5s. */
  async handleTeamsOutgoing(integrationId: string, rawBody: Buffer, authorization: string | undefined): Promise<HookResult> {
    const i = await this.store.getIntegration(integrationId);
    const secret = i?.provider === 'teams' ? this.secrets.open<TeamsSecret>(i.secret) : null;
    if (!i || !secret?.outgoingToken) return { status: 404, body: { error: 'not_configured' } };
    if (!verifyTeamsOutgoing(secret.outgoingToken, authorization, rawBody)) return { status: 401, body: { error: 'bad_signature' } };
    const activity = JSON.parse(rawBody.toString('utf8')) as { text?: string; from?: { name?: string } };
    const reply = (text: string): HookResult => ({ status: 200, body: { type: 'message', text: text.replace(/\n/g, '<br>') } });
    const members = await this.store.listMembers(i.orgId);
    const byName = (name: string) => members.find((m) => m.fullName.trim().toLowerCase() === name.trim().toLowerCase());
    const sender = byName(activity.from?.name ?? '');
    if (!sender) return reply(`I couldn't match “${activity.from?.name ?? 'you'}” to a Delegate member. Use the same name in Delegate as in Teams.`);
    // Mentions arrive as <at>Name</at>; the first one is the bot itself.
    const ats = [...(activity.text ?? '').matchAll(/<at>(.*?)<\/at>/g)].map((m) => m[1]!);
    const mentioned = ats.slice(1).map((n) => byName(n)?.userId).filter((x): x is string => !!x);
    const text = (activity.text ?? '').replace(/<at>.*?<\/at>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
    const org = await this.store.getOrg(i.orgId);
    const ctx: Ctx = { userId: sender.userId, orgId: i.orgId, role: sender.role };
    return reply(await this.commands.execute({ ctx, channel: 'teams', timezone: org?.timezone ?? 'UTC', appUrl: this.appUrl(), mentionedUserIds: mentioned }, text));
  }

  /* ------------------------------------------------------------------ WhatsApp */

  async enableWhatsApp(ctx: Ctx, enabled: boolean) {
    this.requireManager(ctx);
    if (!enabled) return this.disconnect(ctx, 'whatsapp');
    await this.billing.require(ctx.orgId, 'whatsapp', 'WhatsApp');
    if (!this.config.whatsapp && !this.config.simulateProviders) throw badRequest('WhatsApp is not configured on this server');
    await this.store.saveIntegration({ orgId: ctx.orgId, provider: 'whatsapp', config: { enabled: true }, secret: null, events: [], status: 'connected', lastError: null, createdById: ctx.userId });
    await this.connected(ctx, 'whatsapp', {});
  }

  /** Personal link code: the user sends "LINK ABC123" from their phone to our business number. */
  async whatsappLinkCode(ctx: Ctx) {
    const code = shortCode(6);
    await this.store.createLinkCode({ code, userId: ctx.userId, orgId: ctx.orgId, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() });
    const number = this.config.whatsapp?.businessNumber;
    return { code, link: number ? `https://wa.me/${number}?text=${encodeURIComponent(`LINK ${code}`)}` : null, expiresInMinutes: 30 };
  }

  async unlinkPhone(ctx: Ctx) {
    await this.store.setProfilePhone(ctx.userId, null);
  }

  verifyWhatsAppSubscription(query: Record<string, unknown>): HookResult {
    const wa = this.config.whatsapp;
    if (wa && query['hub.mode'] === 'subscribe' && typeof query['hub.verify_token'] === 'string' && safeEqual(query['hub.verify_token'], wa.verifyToken)) {
      return { status: 200, body: String(query['hub.challenge'] ?? ''), contentType: 'text' };
    }
    return { status: 403, body: 'Forbidden', contentType: 'text' };
  }

  async handleWhatsAppWebhook(rawBody: Buffer, signature: string | undefined): Promise<HookResult> {
    const wa = this.config.whatsapp;
    if (!wa) return { status: 404, body: { error: 'not_configured' } };
    if (!verifyMetaSignature(wa.appSecret, signature, rawBody)) return { status: 401, body: { error: 'bad_signature' } };
    const payload = JSON.parse(rawBody.toString('utf8')) as {
      entry?: Array<{ changes?: Array<{ value?: { messages?: Array<{ id: string; from: string; type: string; text?: { body?: string }; button?: { payload?: string; text?: string }; interactive?: { button_reply?: { id?: string; title?: string } } }> } }> }>;
    };
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const msg of change.value?.messages ?? []) {
          if (!(await this.store.recordWebhookEvent('whatsapp', msg.id))) continue; // Meta retries deliveries
          const text = msg.text?.body ?? msg.button?.payload ?? msg.button?.text ?? msg.interactive?.button_reply?.id ?? msg.interactive?.button_reply?.title ?? '';
          const reply = await this.handleWhatsAppText(msg.from, text);
          if (reply) await this.notifier.whatsappText(reply.orgId, msg.from, reply.text);
        }
      }
    }
    // Always 200 quickly, or Meta keeps retrying.
    return { status: 200, body: { ok: true } };
  }

  /** Demo workspace: type a WhatsApp message as yourself and see the reply, no Meta account needed. */
  async simulateWhatsApp(ctx: Ctx, text: string) {
    if (!this.config.simulateProviders) throw notFound();
    const profile = (await this.store.getProfile(ctx.userId))!;
    let phone = profile.phone;
    if (!phone && !/^\s*link\b/i.test(text)) {
      phone = `234800${String(Math.abs(hashCode(ctx.userId))).padStart(7, '0').slice(0, 7)}`;
      await this.store.setProfilePhone(ctx.userId, phone);
    }
    const from = phone ?? `234800${String(Math.abs(hashCode(ctx.userId))).padStart(7, '0').slice(0, 7)}`;
    const reply = await this.handleWhatsAppText(from, text);
    if (reply) await this.notifier.whatsappText(reply.orgId, from, reply.text);
    return { reply: reply?.text ?? '', phone: from };
  }

  private async handleWhatsAppText(from: string, raw: string): Promise<{ orgId: string | null; text: string } | null> {
    const phone = normalizePhone(from);
    if (!phone) return null;
    const text = raw.trim();
    const link = text.match(/^link\s+([A-Z0-9]{4,10})$/i);
    if (link) {
      const claim = await this.store.consumeLinkCode(link[1]!.toUpperCase());
      if (!claim) return { orgId: null, text: 'That link code is invalid or expired. Generate a new one in Delegate → Settings → Account.' };
      await this.store.setProfilePhone(claim.userId, phone);
      return { orgId: claim.orgId, text: '✅ Your WhatsApp is linked to Delegate. New tasks and blocker pings will arrive here.\n\nReply "list" to see your tasks or "help" for commands.' };
    }
    const profile: Profile | null = await this.store.getProfileByPhone(phone);
    if (!profile) return { orgId: null, text: 'This number is not linked to Delegate yet. Open Delegate → Settings → Account → "Link WhatsApp".' };
    const membership = await this.store.getMembershipForUser(profile.id);
    if (!membership) return { orgId: null, text: 'You are not in a Delegate workspace yet.' };
    const ent = await this.billing.entitlements(membership.orgId);
    if (!ent.features.whatsapp || !(await this.store.getIntegrationFor(membership.orgId, 'whatsapp'))) {
      return { orgId: membership.orgId, text: 'WhatsApp actions are switched off for your workspace. Ask your manager to enable them (Team plan).' };
    }
    const org = await this.store.getOrg(membership.orgId);
    const ctx: Ctx = { userId: profile.id, orgId: membership.orgId, role: membership.role };
    const members = await this.store.listMembers(membership.orgId);
    // "@Tunde" → the first member whose name starts with it.
    const mentioned = [...text.matchAll(/@([\p{L}][\p{L}'-]+)/gu)]
      .map((m) => members.find((x) => x.fullName.toLowerCase().startsWith(m[1]!.toLowerCase()))?.userId)
      .filter((x): x is string => !!x);
    const reply = await this.commands.execute({ ctx, channel: 'whatsapp', timezone: org?.timezone ?? 'UTC', appUrl: this.appUrl(), mentionedUserIds: mentioned }, text);
    return { orgId: membership.orgId, text: reply };
  }

  /* ------------------------------------------------------------------ GitHub */

  async connectGitHub(ctx: Ctx) {
    this.requireManager(ctx);
    const webhookSecret = randomToken(24);
    const existing = await this.store.getIntegrationFor(ctx.orgId, 'github');
    const saved = await this.store.saveIntegration({
      orgId: ctx.orgId,
      provider: 'github',
      config: { secretHint: mask(webhookSecret, 3), repos: existing?.config.repos ?? '', lastDeliveryAt: existing?.config.lastDeliveryAt ?? null },
      secret: this.secrets.seal({ webhookSecret } satisfies GitHubSecret),
      events: [],
      status: 'connected',
      lastError: null,
      createdById: existing?.createdById ?? ctx.userId,
    });
    if (!existing) await this.connected(ctx, 'github', {});
    // The secret is shown once; afterwards only a hint is displayed.
    return { webhookUrl: `${this.appUrl()}/api/hooks/github/${saved.id}`, secret: webhookSecret };
  }

  async handleGitHubWebhook(integrationId: string, rawBody: Buffer, headers: Record<string, string | string[] | undefined>): Promise<HookResult> {
    const i = await this.store.getIntegration(integrationId);
    const secret = i?.provider === 'github' ? this.secrets.open<GitHubSecret>(i.secret) : null;
    if (!i || !secret) return { status: 404, body: { error: 'not_configured' } };
    const signature = String(headers['x-hub-signature-256'] ?? '');
    if (!signature || !safeEqual(`sha256=${hmac('sha256', secret.webhookSecret, rawBody)}`, signature)) return { status: 401, body: { error: 'bad_signature' } };
    const event = String(headers['x-github-event'] ?? '');
    const delivery = String(headers['x-github-delivery'] ?? '');
    if (event === 'ping') return { status: 200, body: { ok: true, pong: true } };
    if (delivery && !(await this.store.recordWebhookEvent('github', delivery))) return { status: 200, body: { ok: true, duplicate: true } };

    const ent = await this.billing.entitlements(i.orgId);
    if (!ent.features.autoProof) return { status: 200, body: { ok: true, skipped: 'upgrade_required' } };
    const payload = JSON.parse(rawBody.toString('utf8')) as Record<string, any>;
    const repo: string = payload.repository?.full_name ?? '';
    const results: string[] = [];

    if (event === 'pull_request' && payload.action === 'closed' && payload.pull_request?.merged) {
      const pr = payload.pull_request;
      const refs = refsIn(`${pr.title ?? ''} ${pr.body ?? ''} ${pr.head?.ref ?? ''}`);
      for (const seq of refs) {
        const proof = {
          kind: 'link' as const,
          url: String(pr.html_url),
          note: `PR #${pr.number} “${String(pr.title).slice(0, 120)}” merged by ${pr.merged_by?.login ?? 'GitHub'} into ${pr.base?.ref ?? 'main'}`,
          source: 'github' as const,
          verified: true,
        };
        results.push(await this.completeFromGitHub(i.orgId, seq, proof));
      }
    } else if (event === 'push') {
      for (const commit of (payload.commits ?? []) as Array<{ id: string; message: string; url: string; author?: { name?: string } }>) {
        const closing = new Set([...commit.message.matchAll(CLOSING)].map((m) => Number(m[1])));
        for (const seq of refsIn(commit.message)) {
          const proof = { kind: 'link' as const, url: commit.url, note: `Commit ${commit.id.slice(0, 7)} by ${commit.author?.name ?? 'someone'}: ${commit.message.split('\n')[0]!.slice(0, 120)}`, source: 'github' as const, verified: true };
          if (closing.has(seq)) results.push(await this.completeFromGitHub(i.orgId, seq, proof));
          else {
            const task = await this.workspace.findByRef(i.orgId, seq);
            if (task) {
              await this.workspace.attachSystemProof(i.orgId, task.id, proof, 'github');
              results.push(`${taskRef(seq)}:attached`);
            }
          }
        }
      }
    }

    const repos = new Set(String(i.config.repos ?? '').split(',').filter(Boolean));
    if (repo) repos.add(repo);
    await this.store.saveIntegration({ ...i, config: { ...i.config, repos: [...repos].slice(-10).join(','), lastDeliveryAt: new Date().toISOString() }, lastError: null, status: 'connected' });
    return { status: 200, body: { ok: true, results } };
  }

  private async completeFromGitHub(orgId: string, seq: number, proof: { kind: 'link'; url: string; note: string; source: 'github'; verified: boolean }) {
    const task = await this.workspace.findByRef(orgId, seq);
    if (!task) return `${taskRef(seq)}:not_found`;
    if (task.status === 'done' || task.status === 'approved') {
      await this.workspace.attachSystemProof(orgId, task.id, proof, 'github');
      return `${taskRef(seq)}:attached`;
    }
    if (task.status === 'open') await this.workspace.systemTransition(orgId, task.id, 'start', {}, { source: 'github' });
    if (task.status === 'blocked') await this.workspace.systemTransition(orgId, task.id, 'unblock', {}, { source: 'github' });
    await this.workspace.systemTransition(orgId, task.id, 'submit', {}, { source: 'github', proofs: [proof] });
    return `${taskRef(seq)}:submitted`;
  }
}

function refsIn(text: string): number[] {
  return [...new Set([...text.matchAll(TASK_REF_PATTERN)].map((m) => Number(m[1])))].slice(0, 10);
}

function hashCode(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
}

