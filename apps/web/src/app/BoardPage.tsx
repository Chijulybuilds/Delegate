import { availableActions, isManagerRole, LANES, STATUS_META, taskRef, type ProofSource, type Task, type TaskProof, type TaskSource, type TransitionAction } from '@delegate/shared';
import { AlarmClock, ArrowRight, BellRing, CirclePlay, History, OctagonPause, Pause, Plus, RefreshCw, ShieldCheck, Sparkles, Users, type LucideIcon } from 'lucide-react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { EmptyLaneArt } from '../components/EmptyLaneArt';
import { useToast } from '../components/Toast';
import { Avatar, Button, cx, EASE, EmptyState, PriorityTag, Segmented, Select, Spinner, StatusDot } from '../components/ui';
import { dueLabel, timeAgo } from '../lib/format';
import { PageHeader } from './AppShell';
import { memberName, useBoard, useNotifications, useTransition, useWorkspace, type WorkspaceData } from './data';
import { NewTaskModal } from './NewTaskModal';
import { departmentOptions, memberOptions } from './options';
import { TaskDrawer } from './TaskDrawer';

const laneText: Record<string, string> = {
  open: 'text-s-open',
  active: 'text-s-active',
  done: 'text-s-done',
  approved: 'text-s-approved',
};
const laneTone: Record<string, string> = {
  open: 'bg-s-open',
  active: 'bg-s-active',
  done: 'bg-s-done',
  approved: 'bg-s-approved',
};
/** The coloured wash at the top of each lane: a solid band fading into the lane. */
const laneBand: Record<string, string> = {
  open: 'bg-s-open-tint',
  active: 'bg-s-active-tint',
  done: 'bg-s-done-tint',
  approved: 'bg-s-approved-tint',
};
const laneWash: Record<string, string> = {
  open: 'from-s-open-tint',
  active: 'from-s-active-tint',
  done: 'from-s-done-tint',
  approved: 'from-s-approved-tint',
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
/** The little icon chip on each glance tile (it shows the number instead when there is one). */
const GLANCE_ICON: Record<Focus, { icon: LucideIcon; tone?: string }> = {
  toStart: { icon: CirclePlay },
  inMotion: { icon: RefreshCw },
  overdue: { icon: AlarmClock, tone: 'bg-s-open-soft text-s-open-ink' },
  blocked: { icon: OctagonPause, tone: 'bg-s-active-soft text-s-active-ink' },
  waitingOnMe: { icon: Pause },
  toAudit: { icon: ShieldCheck, tone: 'bg-s-approved-soft text-s-approved-ink' },
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
  const news = useNotifications().data?.tasks ?? {};
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
  const isOwner = ws.data?.me.role === 'owner';
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
  const navigate = useNavigate();
  // For the owner, History includes everything from earlier days that still needs action.
  const earlier = (board.data?.earlier.unfinished ?? 0) + (board.data?.earlier.awaitingAudit ?? 0);
  const glance = useMemo(() => {
    const all = board.data?.tasks ?? [];
    return GLANCE[isManager ? 'manager' : 'member'].map((f) => ({
      id: f,
      // The owner's tile opens History (earlier days); for everyone else it's what's blocked on them.
      label: f === 'waitingOnMe' && isOwner ? 'History' : FOCUS[f].label,
      count: f === 'waitingOnMe' && isOwner ? earlier : all.filter(FOCUS[f].match(meId, isManager)).length,
    }));
  }, [board.data, meId, isManager, isOwner, earlier]);

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
        {glance.map((g) => {
          const on = focus === g.id;
          const { icon: Icon, tone } = GLANCE_ICON[g.id];
          const alert = g.count > 0 && (g.id === 'overdue' || g.id === 'waitingOnMe');
          return (
            <motion.button
              key={g.id}
              onClick={() => (g.id === 'waitingOnMe' && isOwner ? navigate('/app/waiting') : setFocus((f) => (f === g.id ? null : g.id)))}
              aria-pressed={on}
              whileHover={on ? undefined : { y: -2 }}
              whileTap={{ scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 520, damping: 32 }}
              className={cx(
                'flex items-center justify-between rounded-2xl px-4 py-3.5 text-left transition-[background,border-color,box-shadow] duration-300',
                on ? 'obsidian border border-transparent' : 'surface shadow-[var(--shadow-tile)] hover:border-t-[var(--rim-strong)] hover:shadow-[var(--shadow-tile-hover)]',
              )}
              data-testid={`glance-${g.id}`}
            >
              <span className={cx('text-[1.0625rem] font-medium tracking-[-0.01em]', on ? 'text-milk/85' : 'text-ink-2')}>{g.label}</span>
              <span
                className={cx(
                  'grid h-9 min-w-9 place-items-center rounded-xl px-2 tabular-nums shadow-[var(--shadow-chip)] ring-1 ring-black/[0.04] transition-colors',
                  on ? 'bg-milk/15 text-milk' : alert ? 'bg-s-open-soft text-s-open-ink' : g.count > 0 ? 'bg-milk-2 text-ink' : (tone ?? 'bg-milk-2 text-ink-2'),
                )}
              >
                <AnimatePresence mode="popLayout" initial={false}>
                  {g.count > 0 ? (
                    <motion.span key={`n-${g.count}`} className="text-xl font-medium tracking-display" initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -8, opacity: 0 }} transition={{ duration: 0.25, ease: EASE }}>
                      {g.count}
                    </motion.span>
                  ) : (
                    <motion.span key="icon" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={{ duration: 0.25, ease: EASE }} aria-label="0">
                      <Icon className="size-[17px]" strokeWidth={1.9} />
                    </motion.span>
                  )}
                </AnimatePresence>
              </span>
            </motion.button>
          );
        })}
      </div>

      {/* Every day starts fresh: earlier work is on History (everyone sees their own). */}
      {board.data && earlier > 0 && (
        <Link
          to="/app/waiting"
          className="group mx-4 mb-4 flex items-center gap-3 rounded-2xl border border-dashed border-line-2 px-4 py-2.5 text-sm text-ink-2 transition-colors hover:border-ink hover:text-ink sm:mx-8"
          data-testid="earlier-days"
        >
          <History className="size-4 shrink-0 text-mute" />
          <span>
            From earlier days:{' '}
            {[
              board.data.earlier.unfinished > 0 && `${board.data.earlier.unfinished} unfinished`,
              board.data.earlier.awaitingAudit > 0 && `${board.data.earlier.awaitingAudit} awaiting audit`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
          <span className="ml-auto inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-medium">
            History <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
        </Link>
      )}

      {/* Filters: swimlanes by department/person without losing the global rhythm */}
      {isManager && (
      <div className={cx('flex flex-wrap items-center gap-2 px-4 pb-5 sm:px-8', focus && 'pointer-events-none opacity-40')}>
        <Segmented
          value={scope}
          onChange={setScope}
          options={[
            { value: 'all', label: 'Everyone' },
            { value: 'mine', label: 'Mine' },
          ]}
        />
        <Select size="sm" value={dept} onChange={setDept} options={departmentOptions(ws.data.departments, { value: 'all', label: 'All departments' })} aria-label="Filter by department" data-testid="filter-department" />
        <Select
          size="sm"
          value={person}
          onChange={setPerson}
          options={[{ value: 'all', label: 'Every person', icon: <Users className="size-4 text-mute" /> }, ...memberOptions(ws.data.members, { meId: meId, departments: ws.data.departments })]}
          aria-label="Filter by person"
          data-testid="filter-person"
        />
      </div>
      )}

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
            <p className="text-sm text-s-active-ink">
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

      <BoardLanes
        tasks={tasks}
        ws={ws.data}
        aiVerdicts={board.data?.aiVerdicts ?? {}}
        verified={board.data?.verified ?? {}}
        news={news}
        onOpen={(id) => openTask(id)}
        onQuick={quick}
        busyId={transition.isPending ? (transition.variables?.id ?? null) : null}
        emptyOpenHint={isManager && !focus ? 'No tasks yet today' : 'No tasks here yet'}
      />

      {(board.data?.tasks.length ?? 0) === 0 && (
        <div className="px-4 pb-10 sm:px-8">
          <EmptyState
            title="Your board is empty"
            body={isOwner ? 'Every day starts with a fresh board; earlier tasks are in History. Assign the first task of the day: it lands red on the assignee’s board.' : 'Every day starts with a fresh board. Your tasks for today will appear here; earlier ones are in History.'}
            action={<Button onClick={() => setCreating(true)}>Create the first task</Button>}
          />
        </div>
      )}

      <NewTaskModal open={creating} onClose={() => setCreating(false)} ws={ws.data} />
      <TaskDrawer taskId={openTaskId} intent={params.get('intent')} onClose={() => openTask(null)} ws={ws.data} />
    </div>
  );
}

/** Open · In motion · Executed · Audited — the board layout shared by Today and History. */
export function BoardLanes({
  tasks,
  ws,
  aiVerdicts,
  verified,
  news,
  onOpen,
  onQuick,
  busyId,
  emptyOpenHint = 'No tasks here yet',
  dayOf,
}: {
  tasks: Task[];
  ws: WorkspaceData;
  aiVerdicts: Record<string, TaskProof['aiVerdict']>;
  verified: Record<string, ProofSource>;
  news: Record<string, { count: number }>;
  onOpen: (id: string) => void;
  onQuick: (task: Task, action: TransitionAction) => void;
  busyId: string | null;
  emptyOpenHint?: string;
  /** When the board spans several days, each card shows the day it was given out. */
  dayOf?: (task: Task) => string | null;
}) {
  const isOwner = ws.me.role === 'owner';
  return (
    <LayoutGroup>
      <div className="grid gap-3 px-4 pb-10 sm:px-8 md:grid-cols-2 xl:grid-cols-4">
        {LANES.map((lane) => {
          const laneTasks = tasks
            .filter((t) => (lane.statuses as readonly string[]).includes(t.status))
            .sort((a, b) => (b.status === 'blocked' ? 1 : 0) - (a.status === 'blocked' ? 1 : 0) || b.updatedAt.localeCompare(a.updatedAt));
          return (
            <section key={lane.id} className="relative flex min-h-[260px] flex-col overflow-hidden rounded-3xl bg-milk-2/70 p-2.5" aria-label={lane.label} data-testid={`lane-${lane.id}`}>
              {/* The lane's colour washes down from the top, like a coloured header */}
              <div className={cx('pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b to-transparent', laneWash[lane.id])} aria-hidden />
              <div className={cx('pointer-events-none absolute inset-x-0 top-0 h-12 opacity-80', laneBand[lane.id])} aria-hidden />
              <header className="relative flex items-center gap-2 px-2 pb-3 pt-1.5">
                <span className={cx('glow size-2.5 rounded-full', laneText[lane.id])} />
                <h2 className="text-[0.9062rem] font-medium tracking-[-0.01em]">{lane.label}</h2>
                <span className="ml-auto grid min-w-6 place-items-center rounded-full bg-paper/90 px-2 py-0.5 text-xs tabular-nums text-ink-2 shadow-[var(--shadow-card)]" data-testid={`lane-count-${lane.id}`}>
                  {laneTasks.length}
                </span>
              </header>
              <div className="relative flex flex-1 flex-col gap-2">
                <AnimatePresence mode="popLayout" initial={false}>
                  {laneTasks.map((t) => (
                    <TaskCard
                      key={t.id}
                      task={t}
                      ws={ws}
                      aiVerdict={aiVerdicts[t.id] ?? null}
                      verifiedBy={verified[t.id] ?? null}
                      news={news[t.id]?.count ?? 0}
                      day={dayOf?.(t) ?? null}
                      onOpen={() => onOpen(t.id)}
                      onQuick={(a) => onQuick(t, a)}
                      busy={busyId === t.id}
                    />
                  ))}
                </AnimatePresence>
                {laneTasks.length === 0 && (
                  <motion.div className="flex flex-1 flex-col items-center justify-center gap-2 px-2 py-8 text-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
                    <EmptyLaneArt className="w-24 text-faint" />
                    <p className="text-[0.8125rem] text-mute">{lane.id === 'open' ? emptyOpenHint : 'No tasks here yet'}</p>
                  </motion.div>
                )}
                {lane.id === 'approved' && isOwner && (
                  <Link to="/app/audits" className="mt-auto inline-flex items-center justify-center gap-1 rounded-xl px-2 py-2 text-xs text-mute transition-colors hover:bg-paper hover:text-ink" data-testid="all-audits-link">
                    Every audit, all time <ArrowRight className="size-3.5" />
                  </Link>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </LayoutGroup>
  );
}

function TaskCard({
  task,
  ws,
  aiVerdict,
  verifiedBy,
  news = 0,
  day = null,
  onOpen,
  onQuick,
  busy,
}: {
  task: Task;
  ws: WorkspaceData;
  aiVerdict: TaskProof['aiVerdict'];
  verifiedBy: ProofSource | null;
  /** Unread messages and updates about this task for the viewer: the red badge. */
  news?: number;
  /** The day it was given out (shown when a board spans several days). */
  day?: string | null;
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
      aria-label={`${task.title}, ${STATUS_META[task.status].label}${news ? `, ${news} new` : ''}`}
      data-testid="task-card"
      data-task-title={task.title}
      data-status={task.status}
      whileHover={{ y: -2 }}
      className={cx(
        'surface lift group relative cursor-pointer rounded-2xl p-3.5 outline-none focus-visible:ring-2 focus-visible:ring-ink/50',
        task.status === 'blocked' ? 'border-s-active/50' : news ? 'border-s-open/40' : '',
      )}
    >
      <NewsBadge count={news} />
      <div className="flex items-center gap-2">
        <StatusDot status={task.status} pulse={task.status === 'blocked'} glow={task.status === 'in_progress' || task.status === 'blocked'} />
        <span className="shrink-0 whitespace-nowrap font-mono text-[0.6875rem] text-faint" data-testid="task-ref">
          {taskRef(task.seq)}
        </span>
        <PriorityTag priority={task.priority} />
        {day && (
          <span className="shrink-0 whitespace-nowrap rounded-full bg-milk-2 px-1.5 py-0.5 text-[0.625rem] font-medium text-ink-2" data-testid="task-day">
            {day}
          </span>
        )}
        {task.source !== 'app' && (
          <span className="rounded-full bg-milk px-1.5 py-0.5 text-[0.625rem] font-medium text-mute" title={`Created from ${SOURCE_LABEL[task.source]}`}>
            {SOURCE_LABEL[task.source]}
          </span>
        )}
        {dept && (
          <span className="ml-auto inline-flex min-w-0 items-center gap-1.5 text-[0.6875rem] text-faint">
            <span className="size-1.5 shrink-0 rounded-full" style={{ background: dept.color }} />
            <span className="truncate">{dept.name}</span>
          </span>
        )}
      </div>
      <h3 className="mt-2 text-[0.9062rem] font-medium leading-snug tracking-[-0.01em]">{task.title}</h3>

      {task.status === 'blocked' && task.blockedReason && (
        <div className="mt-2 rounded-xl bg-s-active-soft px-2.5 py-1.5 text-xs text-s-active-ink">
          <p className="line-clamp-2">
            Blocked{task.waitingOnId ? ` · waiting on ${memberName(ws.members, task.waitingOnId).split(' ')[0]}` : ''}: {task.blockedReason}
          </p>
        </div>
      )}
      {(task.status === 'done' || task.status === 'approved') && verifiedBy && (
        <span className="mt-2 mr-1 inline-flex items-center gap-1 rounded-full bg-s-approved-soft px-2 py-0.5 text-[0.6875rem] font-medium text-s-approved-ink" data-testid="verified-badge">
          <ShieldCheck className="size-3" /> Verified · {verifiedBy === 'gdrive' ? 'Google Drive' : verifiedBy === 'github' ? 'GitHub' : 'WhatsApp'}
        </span>
      )}
      {task.status === 'done' && aiVerdict && (
        <span
          className={cx(
            'mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium',
            aiVerdict === 'pass' ? 'bg-s-done-soft text-s-done-ink' : aiVerdict === 'review' ? 'bg-s-active-soft text-s-active-ink' : 'bg-s-open-soft text-s-open-ink',
          )}
        >
          <Sparkles className="size-3" /> AI check: {aiVerdict === 'pass' ? 'looks complete' : aiVerdict === 'review' ? 'needs a look' : 'doesn’t match'}
        </span>
      )}

      <div className="mt-3 flex items-center gap-2">
        <Avatar name={assignee?.fullName ?? '?'} src={assignee?.avatarUrl} size={22} />
        <span className="truncate text-xs text-ink-2">{assignee?.fullName.split(' ')[0] ?? 'Unassigned'}</span>
        <span
          className={cx(
            'ml-auto shrink-0 text-[0.6875rem] tabular-nums',
            due.overdue && task.status !== 'done' && task.status !== 'approved' ? 'rounded-full bg-s-open-soft px-2 py-0.5 font-medium text-s-open-ink' : 'text-faint',
          )}
        >
          {footer}
        </span>
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

/** The red count on a task card: new messages and updates about this task, cleared when it's opened. */
export function NewsBadge({ count }: { count: number }) {
  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.span
          key="news"
          className="absolute -right-1.5 -top-1.5 z-10 grid h-5 min-w-5 place-items-center rounded-full bg-s-open px-1.5 text-[0.6875rem] font-semibold leading-none text-white shadow-[0_2px_8px_rgb(229_72_77/0.45)] ring-2 ring-paper"
          initial={{ scale: 0, rotate: -20 }}
          animate={{ scale: 1, rotate: 0 }}
          exit={{ scale: 0, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 520, damping: 18 }}
          aria-label={`${count} new`}
          data-testid="task-news"
        >
          <span className="absolute inset-0 animate-ping rounded-full bg-s-open opacity-30" aria-hidden />
          <span className="relative">{count > 9 ? '9+' : count}</span>
        </motion.span>
      )}
    </AnimatePresence>
  );
}
