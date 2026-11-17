import { Router, type Request } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { MEMBER_ROLES, TASK_PRIORITIES, type TransitionAction } from '@delegate/shared';
import { badRequest } from '../lib/errors.js';
import { standupToText, type MetricsService } from '../services/metrics.js';
import type { AccountService } from '../services/account.js';
import type { BillingService } from '../services/billing.js';
import type { Ctx, WorkspaceService } from '../services/workspace.js';
import type { Store } from '../store/types.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

const ctxOf = (req: Request): Ctx => ({ userId: req.user!.id, orgId: req.member!.orgId, role: req.member!.role });
const id = z.string().min(1).max(64);
const isoDate = z.string().datetime({ offset: true });

const createTask = z.object({
  title: z.string().trim().min(3, 'Give the task a clear title').max(160),
  description: z.string().max(4000).optional(),
  assigneeId: id.optional(),
  departmentId: id.nullable().optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueAt: isoDate.nullable().optional(),
});

const transition = z.object({
  action: z.enum(['start', 'block', 'unblock', 'submit', 'approve', 'request_changes']),
  reason: z.string().max(500).optional(),
  waitingOnId: id.nullable().optional(),
  comment: z.string().max(2000).optional(),
  proofs: z
    .array(
      z.object({
        kind: z.enum(['link', 'note', 'file']),
        url: z.string().max(2000).nullable().optional(),
        note: z.string().max(2000).nullable().optional(),
        filePath: z.string().max(400).nullable().optional(),
        fileName: z.string().max(200).nullable().optional(),
        attestation: z.string().max(4000).nullable().optional(),
      }),
    )
    .max(10)
    .optional(),
});

/** Mounted behind requireUser + requireMember. */
export function workspaceRoutes(deps: {
  store: Store;
  workspace: WorkspaceService;
  metrics: MetricsService;
  billing: BillingService;
  account: AccountService;
}) {
  const { store, workspace, metrics, billing } = deps;
  const r = Router();

  /* ------------------------------ Workspace ------------------------------ */

  r.get('/workspace', async (req, res) => {
    const { orgId, org, role, departmentId } = req.member!;
    const [members, departments, entitlements] = await Promise.all([store.listMembers(orgId), store.listDepartments(orgId), billing.entitlements(orgId)]);
    res.json({ org, members, departments, entitlements, me: { userId: req.user!.id, role, departmentId } });
  });

  r.patch('/workspace', async (req, res) => {
    const body = z
      .object({
        name: z.string().trim().min(2).max(60).optional(),
        timezone: z.string().max(64).optional(),
        regenerateInvite: z.boolean().optional(),
        settings: z
          .object({
            escalation: z
              .object({
                enabled: z.boolean(),
                blockedManagerHours: z.number().min(0.5).max(168),
                blockedOwnerHours: z.number().min(1).max(336),
                overdueHours: z.number().min(0).max(168),
              })
              .partial()
              .optional(),
            digest: z.object({ enabled: z.boolean(), hour: z.number().int().min(0).max(23) }).partial().optional(),
          })
          .optional(),
      })
      .parse(req.body);
    res.json({ org: await workspace.updateOrg(ctxOf(req), body as Parameters<WorkspaceService['updateOrg']>[1]) });
  });

  r.patch('/members/:userId', async (req, res) => {
    const body = z.object({ role: z.enum(MEMBER_ROLES).optional(), departmentId: id.nullable().optional() }).parse(req.body);
    await workspace.updateMember(ctxOf(req), String(req.params.userId), body);
    res.json({ ok: true });
  });

  // Someone left the company: take them off the workspace and hand their unfinished work to you.
  r.delete('/members/:userId', async (req, res) => {
    res.json(await deps.account.remove(req.user!.id, req.member!.orgId, String(req.params.userId)));
  });

  r.post('/departments', async (req, res) => {
    const body = z
      .object({ name: z.string().trim().min(2).max(40), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() })
      .parse(req.body);
    res.status(201).json({ department: await workspace.createDepartment(ctxOf(req), body) });
  });

  /* -------------------------------- Tasks -------------------------------- */

  r.get('/tasks', async (req, res) => {
    res.json(await workspace.listBoard(ctxOf(req)));
  });

  r.get('/audits/all-time', async (req, res) => {
    res.json({ tasks: await workspace.listAllAudited(ctxOf(req)) });
  });

  r.post('/tasks', async (req, res) => {
    const task = await workspace.createTask(ctxOf(req), createTask.parse(req.body));
    res.status(201).json({ task });
  });

  r.get('/tasks/:id', async (req, res) => {
    res.json(await workspace.detail(ctxOf(req), String(req.params.id)));
  });

  r.patch('/tasks/:id', async (req, res) => {
    const task = await workspace.updateTask(ctxOf(req), String(req.params.id), createTask.partial().parse(req.body));
    res.json({ task });
  });

  r.post('/tasks/:id/transitions', async (req, res) => {
    const { action, ...input } = transition.parse(req.body);
    res.json(await workspace.transition(ctxOf(req), String(req.params.id), action as TransitionAction, input));
  });

  r.post('/tasks/:id/comments', async (req, res) => {
    const body = z.object({ body: z.string().trim().min(1, 'Write something first').max(2000) }).parse(req.body);
    res.status(201).json({ comment: await workspace.comment(ctxOf(req), String(req.params.id), body.body) });
  });

  /** Step 1 of a proof upload: direct-to-storage URL (Supabase) or "send it to the API" (demo). */
  r.post('/tasks/:id/proof-uploads', async (req, res) => {
    const body = z.object({ fileName: z.string().min(1).max(200), size: z.number().int().min(1) }).parse(req.body);
    res.json(await workspace.prepareProofUpload(ctxOf(req), String(req.params.id), body.fileName, body.size));
  });

  r.post('/tasks/:id/proof-files', upload.single('file'), async (req, res) => {
    if (!req.file) throw badRequest('Choose a file to upload');
    res.status(201).json(await workspace.uploadProofFile(ctxOf(req), String(req.params.id), req.file));
  });

  r.get('/tasks/:id/proofs/:proofId/file', async (req, res) => {
    const { file, fileName } = await workspace.proofFile(ctxOf(req), String(req.params.id), String(req.params.proofId));
    if ('url' in file) {
      res.json({ url: file.url });
      return;
    }
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(file.data);
  });

  /* ------------------------ Heartbeat, velocity, standup ------------------------ */

  r.get('/feed', async (req, res) => {
    const q = z
      .object({ limit: z.coerce.number().int().min(1).max(100).default(50), before: isoDate.optional() })
      .parse(req.query);
    res.json({ events: await store.listEvents({ orgId: req.member!.orgId, limit: q.limit, before: q.before }) });
  });

  r.get('/metrics/velocity', async (req, res) => {
    const q = z.object({ days: z.coerce.number().int().refine((d) => [7, 14, 30].includes(d), 'days must be 7, 14 or 30').default(14) }).parse(req.query);
    const ent = await billing.entitlements(req.member!.orgId);
    res.json(await metrics.velocity(req.member!.orgId, Math.min(q.days, ent.velocityDays)));
  });

  r.get('/standup', async (req, res) => {
    const brief = await metrics.standup(req.member!.orgId);
    res.json({ brief, text: standupToText(brief) });
  });

  return r;
}
