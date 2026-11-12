import { STATUS_META, taskRef, type Task, type TaskStatus } from '@delegate/shared';
import type { AppConfig } from '../config.js';
import { hmac, safeEqual } from '../lib/crypto.js';

/**
 * Low-level adapters for every outbound/inbound channel. Each verifies signatures exactly as the
 * provider documents and talks HTTP through an injectable `fetch` (so tests never hit the network).
 */

export type Http = typeof fetch;
const TIMEOUT_MS = 6_000;

export class ChannelError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

async function postJson(http: Http, url: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await http(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) throw new ChannelError(`HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`, res.status);
  return text;
}

/* ------------------------------------------------------------------------------------------ */
/* A channel-neutral message, rendered as Slack Block Kit or a Teams Adaptive Card              */
/* ------------------------------------------------------------------------------------------ */

export interface ChannelMessage {
  /** One-line headline, e.g. "🟢 Tunde submitted proof on DLG-412". */
  title: string;
  /** Supporting text (task title, reason, digest list). */
  body: string;
  status?: TaskStatus;
  url?: string;
  facts?: Array<[string, string]>;
}

const statusEmoji: Record<TaskStatus, string> = { open: '🔴', in_progress: '🟡', blocked: '🟠', done: '🟢', approved: '🔵' };

export function describeTask(task: Task): string {
  return `${taskRef(task.seq)} · ${task.title}`;
}

export function toSlack(msg: ChannelMessage) {
  const lines = [`*${msg.status ? `${statusEmoji[msg.status]} ` : ''}${escapeSlack(msg.title)}*`, escapeSlack(msg.body)].filter(Boolean);
  return {
    text: `${msg.title} — ${msg.body}`.slice(0, 3000),
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n').slice(0, 2900) } },
      ...(msg.facts?.length
        ? [{ type: 'context', elements: msg.facts.slice(0, 9).map(([k, v]) => ({ type: 'mrkdwn', text: `*${escapeSlack(k)}:* ${escapeSlack(v)}` })) }]
        : []),
      ...(msg.url
        ? [{ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open in Delegate' }, url: msg.url, action_id: 'open_delegate' }] }]
        : []),
    ],
  };
}

/** Teams "Workflows" (Power Automate) webhooks accept a message with an Adaptive Card attachment. */
export function toTeamsCard(msg: ChannelMessage) {
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            {
              type: 'TextBlock',
              text: `${msg.status ? `${statusEmoji[msg.status]} ` : ''}${msg.title}`,
              weight: 'Bolder',
              size: 'Medium',
              wrap: true,
            },
            { type: 'TextBlock', text: msg.body, wrap: true, spacing: 'Small' },
            ...(msg.facts?.length ? [{ type: 'FactSet', facts: msg.facts.map(([title, value]) => ({ title, value })) }] : []),
          ],
          actions: msg.url ? [{ type: 'Action.OpenUrl', title: 'Open in Delegate', url: msg.url }] : [],
        },
      },
    ],
  };
}

const escapeSlack = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const statusLabel = (s: TaskStatus) => STATUS_META[s].label;

/* ------------------------------------------------------------------------------------------ */
/* Slack                                                                                        */
/* ------------------------------------------------------------------------------------------ */

/** https://api.slack.com/authentication/verifying-requests-from-slack */
export function verifySlackRequest(signingSecret: string, headers: Record<string, string | string[] | undefined>, rawBody: string, now = Date.now()): boolean {
  const ts = String(headers['x-slack-request-timestamp'] ?? '');
  const sig = String(headers['x-slack-signature'] ?? '');
  if (!ts || !sig || Math.abs(now / 1000 - Number(ts)) > 60 * 5) return false;
  const expected = `v0=${hmac('sha256', signingSecret, `v0:${ts}:${rawBody}`)}`;
  return safeEqual(expected, sig);
}

export class SlackApi {
  constructor(private http: Http) {}

  async call<T = Record<string, unknown>>(method: string, token: string | null, params: Record<string, string>): Promise<T> {
    const res = await this.http(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string } & T;
    if (!json.ok) throw new ChannelError(`Slack ${method}: ${json.error ?? `HTTP ${res.status}`}`, res.status);
    return json;
  }

  postWebhook(url: string, msg: ChannelMessage) {
    return postJson(this.http, url, toSlack(msg));
  }

  respond(responseUrl: string, text: string, ephemeral = true) {
    return postJson(this.http, responseUrl, { response_type: ephemeral ? 'ephemeral' : 'in_channel', text });
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Microsoft Teams                                                                              */
/* ------------------------------------------------------------------------------------------ */

const TEAMS_WEBHOOK_HOSTS = ['.logic.azure.com', '.powerplatform.com', '.powerautomate.com', '.webhook.office.com'];

/** Only Microsoft webhook hosts are accepted (prevents SSRF through a user-supplied URL). */
export function isTeamsWebhookUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && TEAMS_WEBHOOK_HOSTS.some((h) => u.hostname.endsWith(h));
  } catch {
    return false;
  }
}

/** Outgoing webhooks: Authorization: HMAC base64(HMAC-SHA256(base64decode(securityToken), body)). */
export function verifyTeamsOutgoing(securityToken: string, authorization: string | undefined, rawBody: Buffer | string): boolean {
  if (!authorization?.startsWith('HMAC ')) return false;
  const expected = hmac('sha256', Buffer.from(securityToken, 'base64'), rawBody, 'base64');
  return safeEqual(expected, authorization.slice(5).trim());
}

export class TeamsApi {
  constructor(private http: Http) {}
  postWebhook(url: string, msg: ChannelMessage) {
    if (!isTeamsWebhookUrl(url)) throw new ChannelError('Not a Microsoft Teams webhook URL');
    return postJson(this.http, url, toTeamsCard(msg));
  }
}

/* ------------------------------------------------------------------------------------------ */
/* WhatsApp Cloud API                                                                           */
/* ------------------------------------------------------------------------------------------ */

/** Meta signs webhook payloads: X-Hub-Signature-256: sha256=<hex HMAC of raw body with the app secret>. */
export function verifyMetaSignature(appSecret: string, header: string | undefined, rawBody: Buffer | string): boolean {
  if (!header?.startsWith('sha256=')) return false;
  return safeEqual(`sha256=${hmac('sha256', appSecret, rawBody)}`, header);
}

/** Template parameters may not contain newlines, tabs or 4+ consecutive spaces. */
const templateText = (s: string) => s.replace(/[\n\t]+/g, ' · ').replace(/ {4,}/g, '   ').slice(0, 900);

export const WHATSAPP_TEMPLATES = {
  assigned: 'delegate_task_assigned', // {{1}} ref, {{2}} title, {{3}} assigned by, {{4}} due · quick reply button "Start"
  blocker: 'delegate_blocker', // {{1}} person blocked, {{2}} ref, {{3}} title, {{4}} reason
  escalation: 'delegate_escalation', // {{1}} ref, {{2}} title, {{3}} hours, {{4}} assignee
  digest: 'delegate_daily_digest', // {{1}} first name, {{2}} count, {{3}} list
} as const;

export class WhatsAppApi {
  constructor(
    private http: Http,
    private cfg: NonNullable<AppConfig['whatsapp']>,
  ) {}

  private send(to: string, payload: Record<string, unknown>) {
    return postJson(
      this.http,
      `https://graph.facebook.com/${this.cfg.graphVersion}/${this.cfg.phoneNumberId}/messages`,
      { messaging_product: 'whatsapp', recipient_type: 'individual', to, ...payload },
      { Authorization: `Bearer ${this.cfg.token}` },
    );
  }

  /** Business-initiated message (outside the 24h window) — needs an approved template. */
  sendTemplate(to: string, name: string, params: string[], quickReplies: string[] = []) {
    return this.send(to, {
      type: 'template',
      template: {
        name,
        language: { code: this.cfg.templateLang },
        components: [
          { type: 'body', parameters: params.map((text) => ({ type: 'text', text: templateText(text) })) },
          // Payloads for the template's quick-reply buttons, in order; they come back as button.payload.
          ...quickReplies.map((payload, index) => ({ type: 'button', sub_type: 'quick_reply', index: String(index), parameters: [{ type: 'payload', payload }] })),
        ],
      },
    });
  }

  /** Free-form reply; allowed within 24h of the user's last message. */
  sendText(to: string, body: string) {
    return this.send(to, { type: 'text', text: { preview_url: false, body: body.slice(0, 4000) } });
  }
}

/** Normalises a phone number to WhatsApp's wa_id form: digits only, with country code. */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}
