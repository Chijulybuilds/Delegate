import { isManagerRole, STATUS_META, taskRef, type AuditRow } from '@delegate/shared';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { dayKey } from '../components/DateRangePicker';
import { Avatar, Button, cx, EASE, EmptyState, PriorityTag, Spinner, StatusBadge } from '../components/ui';
import { dueLabel, timeAgo } from '../lib/format';
import { PageHeader } from './AppShell';
import { NewsBadge } from './BoardPage';
import { useHistory, useNotifications, useWorkspace, type WorkspaceData } from './data';
import { FilterBar, isFiltered, toApiFilters, useFilterParams } from './TaskFilters';
import { TaskDrawer } from './TaskDrawer';

/**
 * History: every task from earlier days. The Today board starts empty each morning; yesterday's
 * work (done or not) lands here, grouped by the day it was given out, and stays workable:
 * open a task to start it, finish it or audit it.
 */
export default function HistoryPage() {
  const ws = useWorkspace();
  const { state, page, set } = useFilterParams();
  const [params, setParams] = useSearchParams();
  const history = useHistory(toApiFilters(state, true), page);
  const news = useNotifications().data?.tasks ?? {};
  const openTaskId = params.get('task');
  const openTask = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('task', id);
    else next.delete('task');
    setParams(next, { replace: !id });
  };

  const data = history.data;
  const groups = useMemo(() => groupByDay(data?.rows ?? [], data?.timezone ?? 'UTC'), [data]);
  const yesterday = dayKey(new Date(Date.now() - 86_400_000));

  if (!ws.data) return <Spinner className="m-8" />;
  const manager = isManagerRole(ws.data.me.role);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div>
      <PageHeader
        title="History"
        subtitle={
          manager
            ? 'Every task from earlier days. Today’s board starts fresh each morning; nothing is lost.'
            : 'Your tasks from earlier days. Today’s board starts fresh each morning.'
        }
      />
      <div className="z-20 border-b border-line bg-milk/90 px-4 py-3 backdrop-blur-xl sm:px-8 lg:sticky lg:top-0">
        <FilterBar value={state} onChange={set} ws={ws.data} show={{ person: manager, status: true }} maxDay={yesterday} testId="history-filters" />
      </div>

      <div className="px-4 pb-14 pt-5 sm:px-8">
        <div className="mb-4 flex items-center justify-between text-sm text-mute">
          <span data-testid="history-total">
            {history.isLoading ? 'Loading…' : `${data?.total ?? 0} task${data?.total === 1 ? '' : 's'}${isFiltered(state) ? ' match' : ''}`}
          </span>
          {history.isFetching && !history.isLoading && <Spinner className="size-4" />}
        </div>

        {history.isLoading ? (
          <Spinner />
        ) : !data || data.total === 0 ? (
          <EmptyState
            title={isFiltered(state) ? 'Nothing matches these filters' : 'No history yet'}
            body={isFiltered(state) ? 'Try a wider date range or clear a filter.' : 'Tasks move here after the day they were given out. Come back tomorrow.'}
            action={
              isFiltered(state) ? (
                <Button variant="outline" onClick={() => set({ q: '', person: 'all', priority: 'all', status: 'all', range: {} })}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className={cx('max-w-5xl space-y-8 transition-opacity', history.isPlaceholderData && 'opacity-60')} data-testid="history-list">
            {groups.map((g) => (
              <section key={g.key}>
                <h2 className="sticky top-14 z-10 -mx-1 mb-3 flex flex-wrap items-baseline gap-x-2 bg-milk/90 px-1 py-1 backdrop-blur lg:top-[60px]">
                  <span className="text-xs font-medium uppercase tracking-[0.14em] text-faint">{g.label}</span>
                  <span className="text-xs text-faint">
                    · {g.rows.length} task{g.rows.length === 1 ? '' : 's'}
                    {g.unfinished > 0 && <span className="text-s-open-ink"> · {g.unfinished} unfinished</span>}
                  </span>
                </h2>
                <ol className="space-y-2">
                  <AnimatePresence initial={false}>
                    {g.rows.map((r, i) => (
                      <HistoryRow key={r.task.id} row={r} ws={ws.data!} news={news[r.task.id]?.count ?? 0} index={i} onOpen={() => openTask(r.task.id)} />
                    ))}
                  </AnimatePresence>
                </ol>
              </section>
            ))}
            {pages > 1 && (
              <div className="flex items-center justify-center gap-2 pt-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => set({ page: page - 1 })}>
                  <ChevronLeft className="size-4" /> Newer
                </Button>
                <span className="px-2 text-sm text-mute">
                  Page {page} of {pages}
                </span>
                <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => set({ page: page + 1 })} data-testid="history-older">
                  Older <ChevronRight className="size-4" />
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <TaskDrawer taskId={openTaskId} intent={null} onClose={() => openTask(null)} ws={ws.data} />
    </div>
  );
}

function HistoryRow({ row, ws, news, index, onOpen }: { row: AuditRow; ws: WorkspaceData; news: number; index: number; onOpen: () => void }) {
  const t = row.task;
  const assignee = ws.members.find((m) => m.userId === t.assigneeId);
  const unfinished = t.status === 'open' || t.status === 'in_progress' || t.status === 'blocked';
  const due = dueLabel(t.dueAt);
  const when =
    t.status === 'approved'
      ? `Audited ${timeAgo(t.approvedAt)}${row.auditorName ? ` by ${row.auditorName.split(' ')[0]}` : ''}`
      : t.status === 'done'
        ? `Submitted ${timeAgo(t.submittedAt)} · awaiting audit`
        : t.dueAt
          ? due.text
          : `Given ${timeAgo(t.createdAt)}`;
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35, ease: EASE, delay: Math.min(index, 10) * 0.025 }}
      className="relative"
    >
      <button
        onClick={onOpen}
        className={cx(
          'group relative flex w-full flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border bg-paper px-4 py-3 text-left shadow-[var(--shadow-card)] transition-[border,box-shadow] hover:border-line-2 hover:shadow-[var(--shadow-float)]',
          news ? 'border-s-open/40' : 'border-line',
        )}
        data-testid="history-row"
        data-task-title={t.title}
        data-status={t.status}
      >
        <NewsBadge count={news} />
        {/* Left edge: the task's colour, like a card on the board */}
        <span className={cx('absolute inset-y-3 left-0 w-1 rounded-r-full', STATUS_EDGE[STATUS_META[t.status].tone])} aria-hidden />
        <div className="min-w-0 flex-1 basis-64">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-faint">{taskRef(t.seq)}</span>
            <PriorityTag priority={t.priority} />
            {row.departmentName && <span className="text-[11px] text-faint">· {row.departmentName}</span>}
          </div>
          <p className="mt-1 truncate text-[14.5px] font-medium tracking-[-0.01em]">{t.title}</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-ink-2">
          <Avatar name={row.assigneeName} src={assignee?.avatarUrl} size={22} />
          <span className="max-w-[120px] truncate">{row.assigneeName}</span>
        </div>
        <span className={cx('text-xs', unfinished && due.overdue ? 'rounded-full bg-s-open-soft px-2 py-0.5 font-medium text-s-open-ink' : 'text-faint')}>{when}</span>
        <StatusBadge status={t.status} />
        <ArrowRight className="hidden size-4 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-ink sm:block" />
      </button>
    </motion.li>
  );
}

const STATUS_EDGE: Record<string, string> = { red: 'bg-s-open', amber: 'bg-s-active', green: 'bg-s-done', blue: 'bg-s-approved' };

/** Rows (already newest first) grouped by the day they were given out, in the workspace's time zone. */
function groupByDay(rows: AuditRow[], timezone: string) {
  const keyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const labelFmt = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const yesterday = keyFmt.format(new Date(Date.now() - 86_400_000));
  const out: Array<{ key: string; label: string; rows: AuditRow[]; unfinished: number }> = [];
  for (const r of rows) {
    const created = new Date(r.task.createdAt);
    const key = keyFmt.format(created);
    let g = out[out.length - 1];
    if (g?.key !== key) {
      const label = labelFmt.format(created).replace(/ \d{4}$/, (y) => (y.trim() === String(new Date().getFullYear()) ? '' : y));
      g = { key, label: key === yesterday ? `Yesterday · ${label}` : label, rows: [], unfinished: 0 };
      out.push(g);
    }
    g.rows.push(r);
    if (r.task.status === 'open' || r.task.status === 'in_progress' || r.task.status === 'blocked') g.unfinished++;
  }
  return out;
}

