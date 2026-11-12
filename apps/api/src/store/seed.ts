import { DEFAULT_ORG_SETTINGS, type EventType, type MemberRole, type Task, type TaskPriority, type TaskStatus } from '@delegate/shared';
import { localParts } from '../services/automation.js';
import type { MemoryStore } from './memory.js';

export const DEMO_ORG_INVITE = 'LUMEN-2026';

export const DEMO_PERSONAS: Array<{
  id: string;
  fullName: string;
  email: string;
  role: MemberRole;
  dept: 'Operations' | 'Engineering' | 'Creative';
  title: string;
}> = [
  { id: 'demo-ada', fullName: 'Ada Okafor', email: 'ada@lumen.example', role: 'owner', dept: 'Operations', title: 'COO' },
  { id: 'demo-kemi', fullName: 'Kemi Adeyemi', email: 'kemi@lumen.example', role: 'manager', dept: 'Creative', title: 'Creative Lead' },
  { id: 'demo-tunde', fullName: 'Tunde Bakare', email: 'tunde@lumen.example', role: 'member', dept: 'Engineering', title: 'Engineer' },
  { id: 'demo-maya', fullName: 'Maya Chen', email: 'maya@lumen.example', role: 'member', dept: 'Operations', title: 'Ops Associate' },
  { id: 'demo-leo', fullName: 'Leo Martins', email: 'leo@lumen.example', role: 'member', dept: 'Engineering', title: 'Engineer' },
  { id: 'demo-sara', fullName: 'Sara Idowu', email: 'sara@lumen.example', role: 'member', dept: 'Creative', title: 'Designer' },
];

/** Small deterministic PRNG so the demo looks the same on every boot. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

interface Blueprint {
  title: string;
  description: string;
  assignee: string;
  dept: 'Operations' | 'Engineering' | 'Creative';
  daysAgo: number;
  status: TaskStatus;
  priority: TaskPriority;
  proof?: { url?: string; note: string };
  blocked?: { reason: string; waitingOn: string };
  overdue?: boolean;
}

const BLUEPRINTS: Blueprint[] = [
  // Audited (blue) — history for the velocity board
  { title: 'Reconcile October vendor invoices', description: 'Match every October vendor invoice against POs and flag mismatches over $50.', assignee: 'demo-maya', dept: 'Operations', daysAgo: 13, status: 'approved', priority: 'high', proof: { url: 'https://docs.example.com/recon-oct', note: '42 invoices matched, 3 flagged and sent to vendors.' } },
  { title: 'Fix checkout timeout on mobile', description: 'Checkout times out on slow 3G. Add retry with backoff and raise gateway timeout.', assignee: 'demo-tunde', dept: 'Engineering', daysAgo: 12, status: 'approved', priority: 'urgent', proof: { url: 'https://git.example.com/lumen/web/pull/412', note: 'PR merged, p95 checkout latency down from 9.1s to 2.4s.' } },
  { title: 'Design social assets for webinar', description: 'Three sizes (1080², 1920×1080, 1200×628) with speaker photos.', assignee: 'demo-sara', dept: 'Creative', daysAgo: 11, status: 'approved', priority: 'medium', proof: { url: 'https://figma.example.com/file/webinar', note: 'All 9 assets exported and uploaded to the shared drive.' } },
  { title: 'Set up uptime alerts for API', description: 'Alert on-call when /health fails twice in 2 minutes.', assignee: 'demo-leo', dept: 'Engineering', daysAgo: 10, status: 'approved', priority: 'high', proof: { url: 'https://status.example.com/monitors', note: 'Monitors live, test page sent to on-call phone.' } },
  { title: 'Prepare weekly payroll export', description: 'Export hours from the time tracker and send to payroll before noon.', assignee: 'demo-maya', dept: 'Operations', daysAgo: 9, status: 'approved', priority: 'urgent', proof: { note: 'Export sent to payroll at 10:42, confirmation received.' } },
  { title: 'Update pricing page copy', description: 'Reflect the new Team plan and annual discount.', assignee: 'demo-sara', dept: 'Creative', daysAgo: 8, status: 'approved', priority: 'medium', proof: { url: 'https://lumen.example/pricing', note: 'Copy live, legal reviewed the discount wording.' } },
  { title: 'Migrate staging DB to Postgres 17', description: 'Dump, restore and run the smoke suite against the new instance.', assignee: 'demo-tunde', dept: 'Engineering', daysAgo: 7, status: 'approved', priority: 'high', proof: { url: 'https://git.example.com/lumen/infra/pull/88', note: 'Staging cut over, smoke suite green.' } },
  { title: 'Resolve 12 aged support tickets', description: 'Anything older than 5 days in the support queue.', assignee: 'demo-maya', dept: 'Operations', daysAgo: 6, status: 'approved', priority: 'medium', proof: { note: 'All 12 closed, 2 escalated to engineering with repro steps.' } },
  { title: 'Record product walkthrough video', description: '3-minute walkthrough of the new dashboard for the help center.', assignee: 'demo-sara', dept: 'Creative', daysAgo: 5, status: 'approved', priority: 'low', proof: { url: 'https://video.example.com/walkthrough-v3', note: 'Final cut 2:58, captions included.' } },
  { title: 'Renew domain and SSL certificates', description: 'Renew lumen.example and the wildcard certificate before expiry.', assignee: 'demo-leo', dept: 'Engineering', daysAgo: 4, status: 'approved', priority: 'high', proof: { note: 'Renewed for 2 years, cert valid until 2028.' } },
  { title: 'Compile customer churn interviews', description: 'Summarise the 8 churn calls into themes for the leadership sync.', assignee: 'demo-kemi', dept: 'Creative', daysAgo: 3, status: 'approved', priority: 'medium', proof: { url: 'https://docs.example.com/churn-themes', note: '4 themes, top one is onboarding friction.' } },

  // Executed (green) — awaiting audit
  { title: 'QA release 3.4 on Android', description: 'Run the regression checklist on Pixel 7 and Galaxy S23.', assignee: 'demo-leo', dept: 'Engineering', daysAgo: 1, status: 'done', priority: 'high', proof: { url: 'https://qa.example.com/runs/3.4', note: 'Checklist 58/58 passing, one cosmetic issue logged.' } },
  { title: 'Clean up CRM duplicate contacts', description: 'Merge duplicates created by the webinar import.', assignee: 'demo-maya', dept: 'Operations', daysAgo: 1, status: 'done', priority: 'low', proof: { note: 'Merged 214 duplicates, export of merged IDs attached in drive.' } },
  { title: 'Draft brand guidelines for Kora launch', description: 'Logo usage, colour, type scale and tone of voice — v1 for review.', assignee: 'demo-sara', dept: 'Creative', daysAgo: 0, status: 'done', priority: 'high', proof: { url: 'https://figma.example.com/file/kora-brand', note: 'v1 ready: 14 pages covering logo, colour, type and voice.' } },

  // In motion (amber)
  { title: 'Finalize Q4 board deck', description: 'Pull final numbers from finance and tighten the narrative to 12 slides.', assignee: 'demo-kemi', dept: 'Creative', daysAgo: 0, status: 'in_progress', priority: 'urgent' },
  { title: 'Ship onboarding email sequence v2', description: 'Five emails, new copy, wire into the lifecycle tool with UTM tags.', assignee: 'demo-tunde', dept: 'Engineering', daysAgo: 0, status: 'in_progress', priority: 'high' },
  { title: 'Negotiate courier contract renewal', description: 'Target 8% lower per-parcel rate or add same-day at current rate.', assignee: 'demo-maya', dept: 'Operations', daysAgo: 0, status: 'blocked', priority: 'medium', blocked: { reason: 'Need signed volume forecast from Creative before the call.', waitingOn: 'demo-kemi' } },
  { title: 'Integrate SSO for enterprise pilot', description: 'SAML SSO with the pilot customer IdP.', assignee: 'demo-tunde', dept: 'Engineering', daysAgo: 1, status: 'blocked', priority: 'high', blocked: { reason: 'Waiting on IdP metadata XML from the customer IT team.', waitingOn: 'demo-leo' } },

  // Open (red) — assigned this morning
  { title: 'Write job post for ops associate', description: 'Role scope, must-haves, salary band. Post to two boards.', assignee: 'demo-maya', dept: 'Operations', daysAgo: 0, status: 'open', priority: 'medium' },
  { title: 'Audit SOC 2 access reviews', description: 'Confirm quarterly access reviews are complete for all production systems.', assignee: 'demo-leo', dept: 'Engineering', daysAgo: 0, status: 'open', priority: 'high' },
  { title: 'Storyboard Q1 campaign film', description: '30-second hero film, 3 storyboard options.', assignee: 'demo-sara', dept: 'Creative', daysAgo: 0, status: 'open', priority: 'medium' },
  { title: 'Review agency invoices for October', description: 'Check hours against the SOW before payment run.', assignee: 'demo-kemi', dept: 'Creative', daysAgo: 0, status: 'open', priority: 'low' },
  { title: 'Patch dependency CVE in image service', description: 'Bump the image library and redeploy.', assignee: 'demo-tunde', dept: 'Engineering', daysAgo: 2, status: 'open', priority: 'urgent', overdue: true },
];

export async function seedDemo(store: MemoryStore): Promise<void> {
  store.reset();
  const rand = rng(20261112);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const dayStart = (daysAgo: number) => new Date(today.getTime() - daysAgo * 86_400_000);
  const addH = (d: Date, h: number) => new Date(d.getTime() + h * 3_600_000);
  const iso = (d: Date) => d.toISOString();
  const clampPast = (d: Date) => (d.getTime() > Date.now() - 60_000 ? new Date(Date.now() - 60_000) : d);

  const orgCreated = dayStart(30);
  const org = await store.createOrg({
    name: 'Lumen & Co.',
    slug: 'lumen',
    inviteCode: DEMO_ORG_INVITE,
    timezone: 'Africa/Lagos',
    // The demo has already had its morning brief, so the tick doesn't fire one on every boot.
    settings: { ...structuredClone(DEFAULT_ORG_SETTINGS), lastDigestOn: localParts(new Date(), 'Africa/Lagos').date },
  });
  await store.upsertSubscription({
    orgId: org.id,
    plan: 'team',
    status: 'active',
    provider: 'manual',
    seats: DEMO_PERSONAS.length,
    trialEndsAt: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    providerCustomerId: null,
    providerSubscriptionId: null,
    updatedAt: new Date().toISOString(),
  });
  store.orgs.get(org.id)!.createdAt = iso(orgCreated);
  store.orgs.get(org.id)!.plan = 'team';

  const deptIds: Record<string, string> = {};
  for (const [name, color] of [
    ['Operations', '#6E56CF'],
    ['Engineering', '#0EA5A4'],
    ['Creative', '#D9480F'],
  ] as const) {
    deptIds[name] = (await store.createDepartment({ orgId: org.id, name, color })).id;
  }

  for (const [i, p] of DEMO_PERSONAS.entries()) {
    await store.upsertProfile({ id: p.id, email: p.email, fullName: p.fullName, avatarUrl: null });
    store.profiles.get(p.id)!.createdAt = iso(addH(orgCreated, i * 20));
    store.memberships.push({
      orgId: org.id,
      userId: p.id,
      role: p.role,
      departmentId: deptIds[p.dept] ?? null,
      joinedAt: iso(addH(orgCreated, i * 20)),
    });
  }

  const managers = ['demo-ada', 'demo-kemi'];
  const event = (
    type: EventType,
    at: Date,
    task: Task,
    actorId: string,
    from: TaskStatus | null,
    to: TaskStatus | null,
    meta: Record<string, unknown> = {},
  ) =>
    store.appendEvent({
      orgId: org.id,
      taskId: task.id,
      actorId,
      type,
      fromStatus: from,
      toStatus: to,
      meta: { title: task.title, ...meta },
      createdAt: iso(clampPast(at)),
    });

  await store.appendEvent({
    orgId: org.id,
    taskId: null,
    actorId: 'demo-ada',
    type: 'org.created',
    fromStatus: null,
    toStatus: null,
    meta: { name: org.name },
    createdAt: iso(orgCreated),
  });

  // Insert oldest first so the ledger reads chronologically.
  const ordered = [...BLUEPRINTS].sort((a, b) => b.daysAgo - a.daysAgo);
  for (const bp of ordered) {
    const assigner = bp.assignee === 'demo-kemi' ? 'demo-ada' : managers[Math.floor(rand() * managers.length)]!;
    const created = clampPast(addH(dayStart(bp.daysAgo), 7 + rand() * 1.5)); // assigned ~8am
    const due = addH(dayStart(bp.daysAgo), bp.overdue ? 17 : 18 + (bp.daysAgo === 0 ? 0 : 0));
    const started = clampPast(addH(created, 0.2 + rand() * 1.4));
    const submitted = clampPast(addH(started, 0.8 + rand() * (bp.priority === 'urgent' ? 3 : 7)));
    const approved = clampPast(addH(submitted, 0.4 + rand() * 4));

    const reached = (s: TaskStatus) => {
      const order: TaskStatus[] = ['open', 'in_progress', 'done', 'approved'];
      const target = bp.status === 'blocked' ? 'in_progress' : bp.status;
      return order.indexOf(target) >= order.indexOf(s);
    };

    const task = await store.insertTask({
      orgId: org.id,
      source: 'app',
      blockedAt: bp.blocked ? iso(addH(started, 0.5)) : null,
      escalationLevel: 0,
      overdueAlertedAt: null,
      playbookId: null,
      title: bp.title,
      description: bp.description,
      status: bp.status,
      priority: bp.priority,
      assigneeId: bp.assignee,
      createdById: assigner,
      departmentId: deptIds[bp.dept] ?? null,
      dueAt: iso(due),
      blockedReason: bp.blocked?.reason ?? null,
      waitingOnId: bp.blocked?.waitingOn ?? null,
      startedAt: reached('in_progress') ? iso(started) : null,
      submittedAt: reached('done') ? iso(submitted) : null,
      approvedAt: reached('approved') ? iso(approved) : null,
      approvedById: reached('approved') ? (bp.assignee === 'demo-kemi' ? 'demo-ada' : assigner) : null,
      createdAt: iso(created),
    });
    store.tasks.get(task.id)!.updatedAt = iso(
      reached('approved') ? approved : reached('done') ? submitted : reached('in_progress') ? started : created,
    );

    await event('task.created', created, task, assigner, null, 'open', { assigneeId: bp.assignee });
    if (reached('in_progress')) await event('task.started', started, task, bp.assignee, 'open', 'in_progress');
    if (bp.blocked) {
      await event('task.blocked', addH(started, 0.5), task, bp.assignee, 'in_progress', 'blocked', {
        reason: bp.blocked.reason,
        waitingOnId: bp.blocked.waitingOn,
      });
    }
    if (reached('done') && bp.proof) {
      if (bp.proof.url) {
        await store.insertProof({
          taskId: task.id,
          orgId: org.id,
          authorId: bp.assignee,
          kind: 'link',
          url: bp.proof.url,
          note: null,
          fileName: null,
          filePath: null,
          source: 'manual',
          verified: false,
          aiVerdict: null,
          aiReason: null,
          createdAt: iso(submitted),
        });
      }
      await store.insertProof({
        taskId: task.id,
        orgId: org.id,
        authorId: bp.assignee,
        kind: 'note',
        url: null,
        note: bp.proof.note,
        fileName: null,
        filePath: null,
        source: 'manual',
        verified: false,
        aiVerdict: null,
        aiReason: null,
        createdAt: iso(submitted),
      });
      await event('task.submitted', submitted, task, bp.assignee, 'in_progress', 'done');
    }
    if (reached('approved')) {
      await event('task.approved', approved, task, task.approvedById!, 'done', 'approved');
    }
  }

  // A little micro-chat so the drawer feels alive.
  const deck = [...store.tasks.values()].find((t) => t.title === 'Finalize Q4 board deck');
  if (deck) {
    const at = (h: number) => iso(clampPast(addH(new Date(deck.createdAt), h)));
    await store.insertComment({ taskId: deck.id, orgId: org.id, authorId: 'demo-ada', body: 'Use the restated September revenue please — finance updated it Friday.', createdAt: at(0.5) });
    await store.insertComment({ taskId: deck.id, orgId: org.id, authorId: 'demo-kemi', body: 'On it. Slides 4–6 updated, narrative pass next.', createdAt: at(1.2) });
  }
  const brand = [...store.tasks.values()].find((t) => t.title === 'Draft brand guidelines for Kora launch');
  if (brand) {
    await store.insertComment({ taskId: brand.id, orgId: org.id, authorId: 'demo-sara', body: 'Tone of voice section is the one I would love a second pair of eyes on.', createdAt: brand.submittedAt ?? brand.createdAt });
  }

  // A recurring playbook so the Playbooks page isn't empty in the demo.
  await store.savePlaybook({
    orgId: org.id,
    name: 'Daily ops checklist',
    active: true,
    cadence: 'weekdays',
    weekday: null,
    monthDay: null,
    timeOfDay: '08:00',
    items: [
      { id: 'pb-1', title: 'Reconcile yesterday’s payments', description: 'Match bank receipts to invoices; flag anything over ₦50,000.', assigneeId: 'demo-maya', priority: 'high', dueInHours: 4 },
      { id: 'pb-2', title: 'Clear the support inbox to zero', description: 'Every ticket answered or escalated with a note.', assigneeId: 'demo-maya', priority: 'medium', dueInHours: 8 },
      { id: 'pb-3', title: 'Check uptime and error dashboards', description: 'Screenshot of the dashboard as proof.', assigneeId: 'demo-leo', priority: 'medium', dueInHours: 2 },
    ],
    createdById: 'demo-ada',
    lastRunOn: localParts(new Date(), 'Africa/Lagos').date,
  });
}
