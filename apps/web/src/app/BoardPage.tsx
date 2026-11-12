import { availableActions, isManagerRole, LANES, STATUS_META, taskRef, type ProofSource, type Task, type TaskProof, type TaskSource, type TransitionAction } from '@delegate/shared';
import { BellRing, Plus, ShieldCheck, Sparkles } from 'lucide-react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useToast } from '../components/Toast';
import { Avatar, Button, cx, EASE, EmptyState, PriorityTag, Segmented, Select, Spinner, StatusDot } from '../components/ui';
import { dueLabel, timeAgo } from '../lib/format';
import { PageHeader } from './AppShell';
import { memberName, useBoard, useTransition, useWorkspace, type WorkspaceData } from './data';
import { NewTaskModal } from './NewTaskModal';
import { TaskDrawer } from './TaskDrawer';

const laneTone: Record<string, string> = {
  open: 'bg-s-open',
  active: 'bg-s-active',
  done: 'bg-s-done',
  approved: 'bg-s-approved',
};

type Focus = 'toStart' | 'inMotion' | 'overdue' | 'blocked' | 'waitingOnMe' | 'toAudit';
const isLate = (t: Task) => !!t.dueAt && new Date(t.dueAt).getTime() < Date.now() && (t.status === 'open' || t.status === 'in_progress' || t.status === 'blocked');
/** `team` = a manager's view across everyone; otherwise only the viewer's own work. */
const FOCUS: Record<Focus, { label: string; match: (me: string, team: boolean) => (t: Task) => boolean }> = {
  toStart: { label: 'To start', match: (me) => (t) => t.assigneeId === me && t.status === 'open' },
  inMotion: { label: 'In motion', match: (me) => (t) => t.assigneeId === me && (t.status === 'in_progress' || t.status === 'blocked') },
  overdue: { label: 'Overdue', match: (me, team) => (t) => isLate(t) && (team || t.assigneeId === me) },
  blocked: { label: 'Blocked', match: () => (t) => t.status === 'blocked' },
  waitingOnMe: { label: 'Waiting on me', match: (me) => (t) => t.status === 'blocked' && t.waitingOnId === me },
  toAudit: { label: 'To audit', match: () => (t) => t.status === 'done' },
};
/** Four numbers that answer "what needs me today?" — different for managers and staff. */
const GLANCE: Record<'manager' | 'member', Focus[]> = {
  manager: ['overdue', 'blocked', 'waitingOnMe', 'toAudit'],
  member: ['toStart', 'inMotion', 'overdue', 'waitingOnMe'],
};

const SOURCE_LABEL: Record<TaskSource, string> = { app: 'App', slack: 'Slack', teams: 'Teams', whatsapp: 'WhatsApp', playbook: 'Playbook', github: 'GitHub' };

const QUICK: Partial<Record<TransitionAction, string>> = {
  start: 'Start',
  submit: 'Submit proof',
  approve: 'Approve ✓',
  unblock: 'Unblock',
};

export default function BoardPage() {
  const ws = useWorkspace();
  const board = useBoard();
  const transition = useTransition();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [scope, setScope] = useState<'all' | 'mine'>('all');
  const [dept, setDept] = useState<string>('all');
  const [person, setPerson] = useState<string>('all');
  const [focus, setFocus] = useState<Focus | null>(null);
  const [creating, setCreating] = useState(false);

  const openTaskId = params.get('task');
  const openTask = (id: string | null, intent?: string) => {
    const next = new URLSearchParams(params);
    if (id) next.set('task', id);
    else next.delete('task');
    if (intent) next.set('intent', intent);
    else next.delete('intent');
    setParams(next, { replace: !id });
  };

  const meId = ws.data?.me.userId ?? '';
  const isManager = isManagerRole(ws.data?.me.role);
  const tasks = useMemo(() => {
    let list = board.data?.tasks ?? [];
    if (focus) list = list.filter(FOCUS[focus].match(meId, isManager));
    else {
      if (scope === 'mine') list = list.filter((t) => t.assigneeId === meId);
      if (dept !== 'all') list = list.filter((t) => t.departmentId === dept);
      if (person !== 'all') list = list.filter((t) => t.assigneeId === person);
    }
    return list;
  }, [board.data, scope, dept, person, meId, focus, isManager]);
  const glance = useMemo(() => {
    const all = board.data?.tasks ?? [];
    return GLANCE[isManager ? 'manager' : 'member'].map((f) => ({ id: f, label: FOCUS[f].label, count: all.filter(FOCUS[f].match(meId, isManager)).length }));
  }, [board.data, meId, isManager]);

  const waitingOnMe = (board.data?.tasks ?? []).filter((t) => t.status === 'blocked' && t.waitingOnId === meId);
  const counts = useMemo(() => {
    const all = board.data?.tasks ?? [];
    return { open: all.filter((t) => t.status !== 'approved').length, done: all.filter((t) => t.status === 'done').length };
  }, [board.data]);

  if (ws.isLoading || board.isLoading || !ws.data) {
    return (
      <div className="grid h-[60vh] place-items-center">
        <Spinner />
      </div>
    );
  }

  const quick = async (task: Task, action: TransitionAction) => {
    if (action === 'submit') return openTask(task.id, 'submit');
    try {
      await transition.mutateAsync({ id: task.id, action });
      toast.success(action === 'approve' ? 'Audited — sealed in the ledger' : action === 'start' ? 'Task started' : 'Unblocked');
    } catch (e) {
      toast.error(e);
    }
  };

  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div>
      <PageHeader
        title="Today’s board"
        subtitle={`${today} · ${counts.open} active · ${counts.done} awaiting audit`}
        actions={
          <Button onClick={() => setCreating(true)} data-testid="new-task">
            <Plus className="size-4" /> New task
          </Button>
        }
      />

      {/* Today at a glance: four numbers that double as one-click filters */}
      <div className="grid grid-cols-2 gap-2 px-4 pb-4 sm:px-8 md:grid-cols-4" data-testid="glance">
        {glance.map((g) => (
          <button
            key={g.id}
            onClick={() => setFocus((f) => (f === g.id ? null : g.id))}
            aria-pressed={focus === g.id}
            className={cx(
              'flex items-center justify-between rounded-2xl border px-4 py-3 text-left transition-colors',
              focus === g.id ? 'border-ink bg-ink text-milk' : 'border-line bg-paper hover:border-line-2',
            )}
            data-testid={`glance-${g.id}`}
          >
            <span className={cx('text-[13px]', focus === g.id ? 'text-milk/80' : 'text-mute')}>{g.label}</span>
            <span className={cx('text-2xl font-medium tracking-display', g.count > 0 && focus !== g.id && (g.id === 'overdue' || g.id === 'waitingOnMe') && 'text-[#B4232A]')}>{g.count}</span>
          </button>
        ))}
      </div>

      {/* Filters: swimlanes by department/person without losing the global rhythm */}
      <div className={cx('flex flex-wrap items-center gap-2 px-4 pb-5 sm:px-8', focus && 'pointer-events-none opacity-40')}>
        <Segmented
          value={scope}
          onChange={setScope}
          options={[
            { value: 'all', label: 'Everyone' },
            { value: 'mine', label: 'Mine' },
          ]}
        />
        <Select value={dept} onChange={(e) => setDept(e.target.value)} className="h-9 w-auto! rounded-full pr-9 text-[13px]" aria-label="Filter by department">
          <option value="all">All departments</option>
          {ws.data.departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
        <Select value={person} onChange={(e) => setPerson(e.target.value)} className="h-9 w-auto! rounded-full pr-9 text-[13px]" aria-label="Filter by person">
          <option value="all">Every person</option>
          {ws.data.members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.fullName}
            </option>
          ))}
        </Select>
      </div>

      {/* Blocker Ping: the bottleneck sees who is waiting on them */}
      <AnimatePresence>
        {waitingOnMe.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="mx-4 mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-s-active/40 bg-s-active-soft px-4 py-3 sm:mx-8"
            data-testid="blocker-banner"
          >
            <span className="grid size-8 place-items-center rounded-full bg-s-active text-white">
              <BellRing className="size-4" />
            </span>
            <p className="text-sm text-[#6b4700]">
              <span className="font-semibold">
                {waitingOnMe.length === 1 ? '1 teammate is' : `${waitingOnMe.length} teammates are`} waiting on you.
              </span>{' '}
              {waitingOnMe.map((t, i) => (
                <span key={t.id}>
                  {i > 0 && ' · '}
                  <button onClick={() => openTask(t.id)} className="underline underline-offset-2">
                    {t.title}
                  </button>{' '}
                  ({memberName(ws.data.members, t.assigneeId)})
                </span>
              ))}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <LayoutGroup>
        <div className="grid gap-3 px-4 pb-10 sm:px-8 md:grid-cols-2 xl:grid-cols-4">
          {LANES.map((lane) => {
            const laneTasks = tasks
              .filter((t) => (lane.statuses as readonly string[]).includes(t.status))
              .sort((a, b) => (b.status === 'blocked' ? 1 : 0) - (a.status === 'blocked' ? 1 : 0) || b.updatedAt.localeCompare(a.updatedAt));
            return (
              <section key={lane.id} className="flex min-h-[200px] flex-col rounded-3xl bg-milk-2/70 p-2.5" aria-label={lane.label} data-testid={`lane-${lane.id}`}>
                <header className="flex items-center gap-2 px-2 pb-3 pt-1.5">
                  <span className={cx('size-2.5 rounded-full', laneTone[lane.id])} />
                  <h2 className="text-[14px] font-medium tracking-[-0.01em]">{lane.label}</h2>
                  <span className="ml-auto rounded-full bg-paper px-2 py-0.5 text-xs text-mute">{laneTasks.length}</span>
                </header>
                <div className="flex flex-1 flex-col gap-2">
                  <AnimatePresence mode="popLayout" initial={false}>
                    {laneTasks.map((t) => (
                      <TaskCard
                        key={t.id}
                        task={t}
                        ws={ws.data}
                        aiVerdict={board.data?.aiVerdicts[t.id] ?? null}
                        verifiedBy={board.data?.verified[t.id] ?? null}
                        onOpen={() => openTask(t.id)}
                        onQuick={(a) => quick(t, a)}
                        busy={transition.isPending && transition.variables?.id === t.id}
                      />
                    ))}
                  </AnimatePresence>
                  {laneTasks.length === 0 && (
                    <p className="px-2 py-6 text-center text-xs text-faint">{lane.id === 'open' ? 'Nothing waiting. Assign something.' : 'Nothing here yet'}</p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </LayoutGroup>

      {(board.data?.tasks.length ?? 0) === 0 && (
        <div className="px-4 pb-10 sm:px-8">
          <EmptyState
            title="Your board is empty"
            body="Assign the first task of the day. It lands red on the assignee’s board and on everyone’s heartbeat."
            action={<Button onClick={() => setCreating(true)}>Create the first task</Button>}
          />
        </div>
      )}

      <NewTaskModal open={creating} onClose={() => setCreating(false)} ws={ws.data} />
      <TaskDrawer taskId={openTaskId} intent={params.get('intent')} onClose={() => openTask(null)} ws={ws.data} />
    </div>
  );
}

function TaskCard({
  task,
  ws,
  aiVerdict,
  verifiedBy,
  onOpen,
  onQuick,
  busy,
}: {
  task: Task;
  ws: WorkspaceData;
  aiVerdict: TaskProof['aiVerdict'];
  verifiedBy: ProofSource | null;
  onOpen: () => void;
  onQuick: (a: TransitionAction) => void;
  busy: boolean;
}) {
  const assignee = ws.members.find((m) => m.userId === task.assigneeId);
  const dept = ws.departments.find((d) => d.id === task.departmentId);
  const actions = availableActions(task, { userId: ws.me.userId, role: ws.me.role });
  const primary = (['start', 'submit', 'approve', 'unblock'] as TransitionAction[]).find((a) => actions.includes(a));
  const due = dueLabel(task.dueAt);
  const footer =
    task.status === 'approved'
      ? `Audited ${timeAgo(task.approvedAt)}`
      : task.status === 'done'
        ? `Submitted ${timeAgo(task.submittedAt)}`
        : task.status === 'in_progress'
          ? `Started ${timeAgo(task.startedAt)}`
          : due.text;

  return (
    <motion.article
      layout
      layoutId={`task-${task.id}`}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.45, ease: EASE }}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen())}
      tabIndex={0}
      role="button"
      aria-label={`${task.title}, ${STATUS_META[task.status].label}`}
      data-testid="task-card"
      data-task-title={task.title}
      data-status={task.status}
      className={cx(
        'group cursor-pointer rounded-2xl border bg-paper p-3.5 shadow-[var(--shadow-card)] outline-none transition-[border,box-shadow] hover:border-line-2 hover:shadow-[var(--shadow-float)] focus-visible:border-ink',
        task.status === 'blocked' ? 'border-s-active/50' : 'border-line',
      )}
    >
      <div className="flex items-center gap-2">
        <StatusDot status={task.status} pulse={task.status === 'blocked'} />
        <span className="font-mono text-[11px] text-faint" data-testid="task-ref">
          {taskRef(task.seq)}
        </span>
        <PriorityTag priority={task.priority} />
        {task.source !== 'app' && (
          <span className="rounded-full bg-milk px-1.5 py-0.5 text-[10px] font-medium text-mute" title={`Created from ${SOURCE_LABEL[task.source]}`}>
            {SOURCE_LABEL[task.source]}
          </span>
        )}
        {dept && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-faint">
            <span className="size-1.5 rounded-full" style={{ background: dept.color }} />
            {dept.name}
          </span>
        )}
      </div>
      <h3 className="mt-2 text-[14.5px] font-medium leading-snug tracking-[-0.01em]">{task.title}</h3>

      {task.status === 'blocked' && task.blockedReason && (
        <div className="mt-2 rounded-xl bg-s-active-soft px-2.5 py-1.5 text-xs text-[#6b4700]">
          <p className="line-clamp-2">
            Blocked{task.waitingOnId ? ` · waiting on ${memberName(ws.members, task.waitingOnId).split(' ')[0]}` : ''}: {task.blockedReason}
          </p>
        </div>
      )}
      {(task.status === 'done' || task.status === 'approved') && verifiedBy && (
        <span className="mt-2 mr-1 inline-flex items-center gap-1 rounded-full bg-s-approved-soft px-2 py-0.5 text-[11px] font-medium text-[#1A56C2]" data-testid="verified-badge">
          <ShieldCheck className="size-3" /> Verified · {verifiedBy === 'gdrive' ? 'Google Drive' : verifiedBy === 'github' ? 'GitHub' : 'WhatsApp'}
        </span>
      )}
      {task.status === 'done' && aiVerdict && (
        <span
          className={cx(
            'mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
            aiVerdict === 'pass' ? 'bg-s-done-soft text-[#1E6B47]' : aiVerdict === 'review' ? 'bg-s-active-soft text-[#8A5A00]' : 'bg-s-open-soft text-[#B4232A]',
          )}
        >
          <Sparkles className="size-3" /> AI check: {aiVerdict === 'pass' ? 'looks complete' : aiVerdict === 'review' ? 'needs a look' : 'doesn’t match'}
        </span>
      )}

      <div className="mt-3 flex items-center gap-2">
        <Avatar name={assignee?.fullName ?? '?'} src={assignee?.avatarUrl} size={22} />
        <span className="truncate text-xs text-ink-2">{assignee?.fullName.split(' ')[0] ?? 'Unassigned'}</span>
        <span className={cx('ml-auto shrink-0 text-[11px]', due.overdue && task.status !== 'done' && task.status !== 'approved' ? 'font-medium text-[#B4232A]' : 'text-faint')}>{footer}</span>
      </div>

      {primary && QUICK[primary] && (
        <div className="mt-3 border-t border-line pt-3">
          <Button
            size="sm"
            variant={primary === 'approve' ? 'primary' : 'outline'}
            className="h-8 w-full"
            loading={busy}
            onClick={(e) => {
              e.stopPropagation();
              onQuick(primary);
            }}
            data-testid={`quick-${primary}`}
          >
            {QUICK[primary]}
          </Button>
        </div>
      )}
    </motion.article>
  );
}
