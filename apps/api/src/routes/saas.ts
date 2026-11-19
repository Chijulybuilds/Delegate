import { Router, type Request } from 'express';
import { z } from 'zod';
import { CHANNEL_EVENTS, INTEGRATION_PROVIDERS, isManagerRole, type NotificationsResponse } from '@delegate/shared';
import { forbidden } from '../lib/errors.js';
import type { AutomationService } from '../services/automation.js';
import type { BillingService } from '../services/billing.js';
import type { DriveService } from '../services/drive.js';
import type { IntegrationService } from '../services/integrations.js';
import type { Ctx, WorkspaceService } from '../services/workspace.js';
import type { Store } from '../store/types.js';

const ctxOf = (req: Request): Ctx => ({ userId: req.user!.id, orgId: req.member!.orgId, role: req.member!.role });
const ownerOnly = (req: Request) => {
  if (req.member!.role !== 'owner') throw forbidden('Only the workspace owner can manage billing');
};
const provider = z.enum(INTEGRATION_PROVIDERS);

/** Public: Slack redirects the browser here after "Add to Slack" (the signed `state` carries the workspace). */
export function oauthRoutes(integrations: IntegrationService) {
  const r = Router();
  r.get('/integrations/slack/callback', async (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    res.redirect(302, await integrations.slackCallback(q.code, q.state, q.error));
  });
  return r;
}

/** Billing, integrations, notifications, playbooks and automations. Mounted behind requireUser + requireMember. */
export function saasRoutes(deps: {
  store: Store;
  billing: BillingService;
  integrations: IntegrationService;
  automation: AutomationService;
  workspace: WorkspaceService;
  drive: DriveService;
}) {
  const { store, billing, integrations, automation, workspace, drive } = deps;
  const r = Router();

  /* ------------------------------------------------------------------ billing */

  r.get('/billing', async (req, res) => {
    res.json(await billing.overview(req.member!.orgId));
  });

  r.post('/billing/checkout', async (req, res) => {
    ownerOnly(req);
    const body = z.object({ provider: z.enum(['stripe', 'paystack']) }).parse(req.body);
    res.json(await billing.checkout({ orgId: req.member!.orgId, email: req.user!.email, provider: body.provider }));
  });

  r.post('/billing/portal', async (req, res) => {
    ownerOnly(req);
    res.json(await billing.portal(req.member!.orgId));
  });

  r.post('/billing/demo-complete', async (req, res) => {
    ownerOnly(req);
    const body = z.object({ provider: z.enum(['stripe', 'paystack']) }).parse(req.body);
    res.json(await billing.completeDemoCheckout(req.member!.orgId, body.provider));
  });

  r.post('/billing/paystack/verify', async (req, res) => {
    ownerOnly(req);
    const body = z.object({ reference: z.string().min(4).max(120) }).parse(req.body);
    res.json(await billing.verifyPaystack(req.member!.orgId, body.reference));
  });

  /* ------------------------------------------------------------------ integrations */

  r.get('/integrations', async (req, res) => {
    res.json(await integrations.overview(ctxOf(req)));
  });

  r.post('/integrations/slack/install', async (req, res) => {
    res.json(await integrations.slackInstallUrl(ctxOf(req)));
  });

  r.post('/integrations/teams', async (req, res) => {
    const body = z.object({ webhookUrl: z.string().max(2000).nullable().optional(), outgoingToken: z.string().max(200).nullable().optional() }).parse(req.body);
    res.json(await integrations.connectTeams(ctxOf(req), body));
  });

  r.post('/integrations/whatsapp', async (req, res) => {
    const body = z.object({ enabled: z.boolean() }).parse(req.body);
    await integrations.enableWhatsApp(ctxOf(req), body.enabled);
    res.json({ ok: true });
  });

  r.post('/integrations/whatsapp/link-code', async (req, res) => {
    res.json(await integrations.whatsappLinkCode(ctxOf(req)));
  });

  r.post('/integrations/whatsapp/unlink', async (req, res) => {
    await integrations.unlinkPhone(ctxOf(req));
    res.json({ ok: true });
  });

  r.post('/integrations/whatsapp/simulate', async (req, res) => {
    const body = z.object({ text: z.string().trim().min(1).max(1000) }).parse(req.body);
    res.json(await integrations.simulateWhatsApp(ctxOf(req), body.text));
  });

  r.post('/integrations/github', async (req, res) => {
    res.json(await integrations.connectGitHub(ctxOf(req)));
  });

  r.patch('/integrations/:provider/events', async (req, res) => {
    const body = z.object({ events: z.array(z.enum(CHANNEL_EVENTS)) }).parse(req.body);
    await integrations.updateEvents(ctxOf(req), provider.parse(req.params.provider), body.events);
    res.json({ ok: true });
  });

  r.post('/integrations/:provider/test', async (req, res) => {
    res.json({ delivery: await integrations.sendTest(ctxOf(req), provider.parse(req.params.provider)) });
  });

  r.delete('/integrations/:provider', async (req, res) => {
    await integrations.disconnect(ctxOf(req), provider.parse(req.params.provider));
    res.json({ ok: true });
  });

  /** Google Drive proof: verify the picked file with Google, return a signed attestation. */
  r.post('/tasks/:id/drive-proof', async (req, res) => {
    const body = z.object({ fileId: z.string().min(10).max(200), accessToken: z.string().min(10).max(4000) }).parse(req.body);
    const ctx = ctxOf(req);
    const task = await workspace.getTaskForCtx(ctx, String(req.params.id));
    if (task.assigneeId !== ctx.userId) throw forbidden('Only the assignee can attach proof');
    res.json(await drive.verify(task, req.user!.email, body.fileId, body.accessToken));
  });

  /* ------------------------------------------------------------------ notifications */

  r.get('/notifications', async (req, res) => {
    const [general, unread] = await Promise.all([store.listNotifications(req.user!.id, 30, 'general'), store.listUnreadNotifications(req.user!.id)]);
    // News about a task belongs on that task: a red badge on its card, cleared when it's opened.
    const tasks: NotificationsResponse['tasks'] = {};
    for (const n of unread) {
      if (!n.taskId) continue;
      const slot = (tasks[n.taskId] ??= { count: 0, latest: { type: n.type, title: n.title, createdAt: n.createdAt } });
      slot.count++;
    }
    const body: NotificationsResponse = {
      notifications: general,
      unread: unread.filter((n) => !n.taskId).length,
      tasks,
      latest: unread[0] ? { id: unread[0].id, createdAt: unread[0].createdAt } : null,
    };
    res.json(body);
  });

  r.post('/notifications/read', async (req, res) => {
    const body = z
      .union([z.object({ ids: z.union([z.array(z.string().max(64)).max(100), z.literal('all')]) }), z.object({ taskId: z.string().min(1).max(64) })])
      .parse(req.body);
    await store.markNotificationsRead(req.user!.id, 'taskId' in body ? { taskId: body.taskId } : body.ids);
    res.json({ ok: true });
  });

  /* ------------------------------------------------------------------ playbooks */

  r.get('/playbooks', async (req, res) => {
    res.json({ playbooks: await automation.listPlaybooks(ctxOf(req)) });
  });

  r.post('/playbooks', async (req, res) => {
    res.status(201).json({ playbook: await automation.savePlaybook(ctxOf(req), req.body) });
  });

  r.put('/playbooks/:id', async (req, res) => {
    res.json({ playbook: await automation.savePlaybook(ctxOf(req), req.body, String(req.params.id)) });
  });

  r.delete('/playbooks/:id', async (req, res) => {
    await automation.deletePlaybook(ctxOf(req), String(req.params.id));
    res.json({ ok: true });
  });

  r.post('/playbooks/:id/run', async (req, res) => {
    const tasks = await automation.runNow(ctxOf(req), String(req.params.id));
    res.json({ created: tasks.length });
  });

  /** "Run checks now" for a manager: escalations, due playbooks and the digest for this workspace. */
  r.post('/automations/run', async (req, res) => {
    if (!isManagerRole(req.member!.role)) throw forbidden('Only managers can run automations');
    res.json(await automation.tick(new Date(), req.member!.orgId));
  });

  return r;
}
