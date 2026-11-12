import {
  isManagerRole,
  taskRef,
  type AiVerdict,
  type AppNotification,
  type ChannelEvent,
  type Entitlements,
  type Member,
  type NotificationType,
  type Organization,
  type Task,
} from '@delegate/shared';
import type { AppConfig } from '../config.js';
import { mask, type Secrets } from '../lib/crypto.js';
import type { IntegrationRecord, Store } from '../store/types.js';
import { ChannelError, SlackApi, TeamsApi, WhatsAppApi, WHATSAPP_TEMPLATES, type ChannelMessage, type Http } from './channels.js';

/** Something happened that people should hear about. Emitted by the services, fanned out here. */
export type DomainEvent =
  | { type: 'assigned'; org: Organization; task: Task; actorId: string | null }
  | { type: 'blocked'; org: Organization; task: Task; actorId: string | null }
  | { type: 'submitted'; org: Organization; task: Task; actorId: string | null; aiVerdict: AiVerdict | null; source?: string }
  | { type: 'approved'; org: Organization; task: Task; actorId: string }
  | { type: 'changes_requested'; org: Organization; task: Task; actorId: string; comment: string }
  | { type: 'commented'; org: Organization; task: Task; actorId: string; preview: string }
  | { type: 'escalated'; org: Organization; task: Task; level: 1 | 2; reason: 'blocked'; hours: number }
  | { type: 'overdue'; org: Organization; task: Task; hours: number };

interface Plan {
  inApp: Array<{ userId: string; type: NotificationType; title: string; body: string }>;
  channel: { event: ChannelEvent; msg: ChannelMessage } | null;
  whatsapp: Array<{ userId: string; template: string; params: string[]; summary: string }>;
}

export interface SlackSecret {
  botToken: string;
  webhookUrl: string | null;
}
export interface TeamsSecret {
  webhookUrl: string | null;
  outgoingToken: string | null;
}

export class Notifier {
  private slack: SlackApi;
  private teams: TeamsApi;
  private whatsapp: WhatsAppApi | null;

  constructor(
    private store: Store,
    private config: AppConfig,
    private secrets: Secrets,
    private entitlements: (orgId: string) => Promise<Entitlements>,
    http: Http,
  ) {
    this.slack = new SlackApi(http);
    this.teams = new TeamsApi(http);
    this.whatsapp = config.whatsapp ? new WhatsAppApi(http, config.whatsapp) : null;
  }

  taskUrl(task: Pick<Task, 'id'>) {
    return `${this.appUrl()}/app?task=${task.id}`;
  }
  appUrl() {
    return (this.config.publicAppUrl ?? 'http://localhost:3000').replace(/\/$/, '');
  }

  /** Never throws: a failed Slack post must not fail the user's action. */
  async dispatch(evt: DomainEvent): Promise<void> {
    try {
      const members = await this.store.listMembers(evt.org.id);
      const plan = this.plan(evt, members);
      await Promise.allSettled([
        plan.inApp.length
          ? this.store.insertNotifications(plan.inApp.map((n) => ({ ...n, orgId: evt.org.id, taskId: evt.task.id })))
          : Promise.resolve(),
        plan.channel ? this.postToChannels(evt.org, plan.channel.event, plan.channel.msg) : Promise.resolve(),
        plan.whatsapp.length ? this.sendWhatsApp(evt.org, plan.whatsapp) : Promise.resolve(),
      ]);
    } catch (error) {
      console.error('[notify] dispatch failed', error);
    }
  }

  private plan(evt: DomainEvent, members: Member[]): Plan {
    const byId = new Map(members.map((m) => [m.userId, m]));
    const name = (id: string | null | undefined) => (id ? (byId.get(id)?.fullName ?? 'Someone') : 'Automation');
    const first = (id: string | null | undefined) => name(id).split(' ')[0]!;
    const managers = members.filter((m) => isManagerRole(m.role));
    const owners = members.filter((m) => m.role === 'owner');
    const { task } = evt;
    const ref = taskRef(task.seq);
    const url = this.taskUrl(task);
    const out: Plan = { inApp: [], channel: null, whatsapp: [] };
    const notActor = (ids: string[], actor: string | null) => [...new Set(ids)].filter((id) => id !== actor);

    switch (evt.type) {
      case 'assigned': {
        if (task.assigneeId !== evt.actorId) {
          out.inApp.push({ userId: task.assigneeId, type: 'assigned', title: `${ref} assigned to you`, body: `${task.title} — from ${name(evt.actorId)}` });
          out.whatsapp.push({
            userId: task.assigneeId,
            template: WHATSAPP_TEMPLATES.assigned,
            params: [ref, task.title, name(evt.actorId), task.dueAt ? new Date(task.dueAt).toUTCString().slice(0, 22) : 'no due date'],
            summary: `Assigned ${ref}`,
          });
        }
        out.channel = {
          event: 'assigned',
          msg: { title: `${name(evt.actorId)} assigned ${ref} to ${name(task.assigneeId)}`, body: task.title, status: 'open', url, facts: task.dueAt ? [['Due', new Date(task.dueAt).toUTCString().slice(0, 22)]] : [] },
        };
        break;
      }
      case 'blocked': {
        const reason = task.blockedReason ?? 'No reason given';
        if (task.waitingOnId) {
          out.inApp.push({ userId: task.waitingOnId, type: 'blocked_on_you', title: `${first(task.assigneeId)} is waiting on you`, body: `${ref} ${task.title}: ${reason}` });
          out.whatsapp.push({ userId: task.waitingOnId, template: WHATSAPP_TEMPLATES.blocker, params: [name(task.assigneeId), ref, task.title, reason], summary: `Blocker ping ${ref}` });
        }
        out.channel = {
          event: 'blocked',
          msg: {
            title: `${name(task.assigneeId)} is blocked on ${ref}${task.waitingOnId ? ` — waiting on ${name(task.waitingOnId)}` : ''}`,
            body: `${task.title}\n“${reason}”`,
            status: 'blocked',
            url,
          },
        };
        break;
      }
      case 'submitted': {
        for (const m of managers.filter((m) => m.userId !== task.assigneeId || m.role === 'owner')) {
          out.inApp.push({ userId: m.userId, type: 'awaiting_audit', title: `${ref} is ready for your audit`, body: `${task.title} — proof from ${name(task.assigneeId)}${evt.aiVerdict === 'pass' ? ' · AI check passed' : ''}` });
        }
        out.channel = {
          event: 'submitted',
          msg: {
            title: `${name(task.assigneeId)} executed ${ref}${evt.source ? ` (via ${evt.source})` : ''}`,
            body: task.title,
            status: 'done',
            url,
            facts: evt.aiVerdict ? [['AI check', evt.aiVerdict === 'pass' ? 'Looks complete' : evt.aiVerdict === 'review' ? 'Needs a look' : "Doesn't match"]] : [],
          },
        };
        break;
      }
      case 'approved': {
        out.inApp.push(...notActor([task.assigneeId], evt.actorId).map((userId) => ({ userId, type: 'approved' as const, title: `${ref} audited ✓`, body: `${task.title} — approved by ${name(evt.actorId)}` })));
        out.channel = { event: 'approved', msg: { title: `${name(evt.actorId)} audited ${ref} ✓`, body: task.title, status: 'approved', url } };
        break;
      }
      case 'changes_requested': {
        out.inApp.push({ userId: task.assigneeId, type: 'changes_requested', title: `Changes requested on ${ref}`, body: `${name(evt.actorId)}: ${evt.comment}` });
        break;
      }
      case 'commented': {
        out.inApp.push(
          ...notActor([task.assigneeId, task.createdById], evt.actorId).map((userId) => ({ userId, type: 'commented' as const, title: `${first(evt.actorId)} replied on ${ref}`, body: evt.preview })),
        );
        break;
      }
      case 'escalated': {
        const recipients = evt.level === 1 ? managers : owners;
        const title = `${ref} has been blocked for ${Math.round(evt.hours)}h`;
        const body = `${task.title} — ${name(task.assigneeId)}${task.waitingOnId ? ` is waiting on ${name(task.waitingOnId)}` : ''}: ${task.blockedReason ?? ''}`;
        for (const m of recipients) {
          out.inApp.push({ userId: m.userId, type: 'escalated', title, body });
          out.whatsapp.push({ userId: m.userId, template: WHATSAPP_TEMPLATES.escalation, params: [ref, task.title, String(Math.round(evt.hours)), name(task.assigneeId)], summary: `Escalation L${evt.level} ${ref}` });
        }
        out.channel = { event: 'escalated', msg: { title: `Escalation (level ${evt.level}): ${title}`, body, status: 'blocked', url } };
        break;
      }
      case 'overdue': {
        const ids = [task.assigneeId, ...managers.map((m) => m.userId)];
        for (const userId of [...new Set(ids)]) {
          out.inApp.push({ userId, type: 'overdue', title: `${ref} is overdue`, body: `${task.title} — ${name(task.assigneeId)}` });
        }
        out.channel = { event: 'escalated', msg: { title: `${ref} is overdue by ${Math.round(evt.hours)}h`, body: `${task.title} — ${name(task.assigneeId)}`, status: task.status, url } };
        break;
      }
    }
    return out;
  }

  /** Posts to every Slack/Teams connection of the workspace that subscribed to this event. */
  async postToChannels(org: Organization, event: ChannelEvent, msg: ChannelMessage) {
    const integrations = (await this.store.listIntegrations(org.id)).filter((i) => (i.provider === 'slack' || i.provider === 'teams') && i.events.includes(event));
    await Promise.allSettled(integrations.map((i) => this.postToIntegration(i, msg)));
  }

  async postToIntegration(i: IntegrationRecord, msg: ChannelMessage) {
    const channel = i.provider === 'slack' ? 'slack' : 'teams';
    const target = String(i.config.channel ?? i.config.maskedWebhook ?? channel);
    const log = (status: 'sent' | 'failed' | 'skipped' | 'simulated', error: string | null = null) =>
      this.store.logOutbound({ orgId: i.orgId, channel, target, summary: msg.title.slice(0, 200), status, error });
    if (this.config.simulateProviders || i.config.simulated) return log('simulated');
    try {
      if (i.provider === 'slack') {
        const secret = this.secrets.open<SlackSecret>(i.secret);
        if (!secret?.webhookUrl) return log('skipped', 'No channel selected — reconnect Slack');
        await this.slack.postWebhook(secret.webhookUrl, msg);
      } else {
        const secret = this.secrets.open<TeamsSecret>(i.secret);
        if (!secret?.webhookUrl) return log('skipped', 'No Teams channel webhook configured');
        await this.teams.postWebhook(secret.webhookUrl, msg);
      }
      await log('sent');
    } catch (error) {
      const message = error instanceof ChannelError ? error.message : 'Delivery failed';
      await log('failed', message);
      await this.store.saveIntegration({ ...i, lastError: message, status: 'error' });
    }
  }

  private async sendWhatsApp(org: Organization, items: Plan['whatsapp']) {
    const ent = await this.entitlements(org.id);
    const enabled = !!(await this.store.getIntegrationFor(org.id, 'whatsapp'));
    if (!ent.features.whatsapp || !enabled) return;
    await Promise.allSettled(
      items.map(async (item) => {
        const profile = await this.store.getProfile(item.userId);
        if (!profile?.phone) return;
        await this.whatsappTemplate(org.id, profile.phone, item.template, item.params, item.summary);
      }),
    );
  }

  async whatsappTemplate(orgId: string, phone: string, template: string, params: string[], summary: string) {
    const log = (status: 'sent' | 'failed' | 'skipped' | 'simulated', error: string | null = null) =>
      this.store.logOutbound({ orgId, channel: 'whatsapp', target: mask(phone, 3), summary, status, error });
    if (this.config.simulateProviders) return log('simulated');
    if (!this.whatsapp) return log('skipped', 'WhatsApp is not configured on this server');
    try {
      await this.whatsapp.sendTemplate(phone, template, params);
      await log('sent');
    } catch (error) {
      await log('failed', error instanceof ChannelError ? error.message : 'Delivery failed');
    }
  }

  async whatsappText(orgId: string | null, phone: string, text: string) {
    if (this.config.simulateProviders || !this.whatsapp) {
      if (orgId) await this.store.logOutbound({ orgId, channel: 'whatsapp', target: mask(phone, 3), summary: text.split('\n')[0]!.slice(0, 200), status: 'simulated', error: null });
      return;
    }
    try {
      await this.whatsapp.sendText(phone, text);
      if (orgId) await this.store.logOutbound({ orgId, channel: 'whatsapp', target: mask(phone, 3), summary: text.split('\n')[0]!.slice(0, 200), status: 'sent', error: null });
    } catch (error) {
      if (orgId) await this.store.logOutbound({ orgId, channel: 'whatsapp', target: mask(phone, 3), summary: text.slice(0, 120), status: 'failed', error: error instanceof ChannelError ? error.message : 'Delivery failed' });
    }
  }

  async notify(orgId: string, list: Array<Omit<AppNotification, 'id' | 'createdAt' | 'readAt' | 'orgId'>>) {
    await this.store.insertNotifications(list.map((n) => ({ ...n, orgId })));
  }
}
