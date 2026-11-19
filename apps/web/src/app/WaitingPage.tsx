import type { Task, TransitionAction } from '@delegate/shared';
import { ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useMemo } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { dayKey, rangeLabel, type DayRange } from '../components/DateRangePicker';
import { TimePicker } from '../components/DateTimePicker';
import { useToast } from '../components/Toast';
import { Button, cx, EASE, Select, Spinner } from '../components/ui';
import { PageHeader } from './AppShell';
import { BoardLanes } from './BoardPage';
import { useHistory, useNotifications, useTransition, useWorkspace } from './data';
import { FilterBar, isFiltered, toApiFilters, useFilterParams } from './TaskFilters';
import { TaskDrawer } from './TaskDrawer';

/**
 * History (owner only): every task from earlier days, laid out exactly like Today
 * (Open · In motion · Executed · Audited). The Today board starts empty each morning; this is where
 * yesterday and every day before wait for the owner. Step through days, pick a range, narrow to a
 * time of day, a person or a priority, or search. Tasks open and can still be worked on.
 */

const WINDOWS = [
  { value: 'any', label: 'Any time', from: '', to: '' },
  { value: 'morning', label: 'Morning · before 12:00', from: '', to: '12:00' },
  { value: 'afternoon', label: 'Afternoon · 12:00–17:00', from: '12:00', to: '17:00' },
  { value: 'evening', label: 'Evening · after 17:00', from: '17:00', to: '' },
  { value: 'custom', label: 'Custom times…', from: '', to: '' },
] as const;

const addDays = (k: string, n: number) => {
  const [y, m, d] = k.split('-').map(Number);
  return dayKey(new Date(y!, m! - 1, d! + n));
};
const fromKey = (k: string) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
};

export default function WaitingPage() {
  const ws = useWorkspace();
  const isOwner = ws.data?.me.role === 'owner';
  const { state, set } = useFilterParams();
  const [params, setParams] = useSearchParams();
  const history = useHistory(toApiFilters(state, false), isOwner);
  const news = useNotifications().data?.tasks ?? {};
  const transition = useTransition();
  const toast = useToast();
  const openTaskId = params.get('task');
  const openTask = (id: string | null, intent?: string) => {
    const next = new URLSearchParams(window.location.search);
    if (id) next.set('task', id);
    else next.delete('task');
    if (intent) next.set('intent', intent);
    else next.delete('intent');
    setParams(next, { replace: !id });
  };

  const yesterday = addDays(dayKey(new Date()), -1);
  const single = state.range.from && state.range.from === state.range.to ? state.range.from : null;
  const tz = history.data?.timezone ?? ws.data?.org.timezone ?? 'UTC';
  const rows = history.data?.rows ?? [];
  const tasks = useMemo(() => rows.map((r) => r.task), [rows]);
  const dayFmt = useMemo(() => new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short' }), [tz]);
  const counts = {
    unfinished: tasks.filter((t) => t.status === 'open' || t.status === 'in_progress' || t.status === 'blocked').length,
    awaiting: tasks.filter((t) => t.status === 'done').length,
    audited: tasks.filter((t) => t.status === 'approved').length,
  };
  const windowValue = WINDOWS.find((w) => w.value !== 'custom' && w.value !== 'any' && w.from === state.fromTime && w.to === state.toTime)?.value ?? (state.fromTime || state.toTime ? 'custom' : 'any');

  if (!ws.data) return <Spinner className="m-8" />;
  if (!isOwner) return <Navigate to="/app" replace />;

  const step = (n: number) => {
    const base = single ?? (n < 0 ? addDays(yesterday, 1) : addDays(yesterday, -1));
    const next = addDays(base, n);
    if (next > yesterday) return;
    set({ range: { from: next, to: next } });
  };
  const setRange = (range: DayRange) => set({ range });
  const quick = async (task: Task, action: TransitionAction) => {
    if (action === 'submit') return openTask(task.id, 'submit');
    try {
      await transition.mutateAsync({ id: task.id, action });
      toast.success(action === 'approve' ? 'Audited — sealed in the ledger' : action === 'start' ? 'Task started' : 'Unblocked');
    } catch (e) {
      toast.error(e);
    }
  };

  const title = single
    ? fromKey(single).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
    : state.range.from || state.range.to
      ? rangeLabel(state.range)
      : 'All earlier days';

  return (
    <div>
      <PageHeader title="History" subtitle="Every task from earlier days, laid out like Today. Only you, the owner, can see this page." />

      <div className="z-20 space-y-3 border-b border-[var(--edge)] bg-milk/90 px-4 py-3 backdrop-blur-xl sm:px-8 lg:sticky lg:top-0 lg:bg-panel">
        {/* The day: step back and forth, or pick a range */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="surface flex items-center gap-1 rounded-full p-1">
            <button onClick={() => step(-1)} className="grid size-8 place-items-center rounded-full text-ink-2 transition-colors hover:bg-ink/[0.06]" aria-label="Previous day" data-testid="day-prev">
              <ChevronLeft className="size-4" />
            </button>
            <span className="relative grid min-w-[180px] place-items-center overflow-hidden px-2" data-testid="day-title" aria-live="polite">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span key={title} className="text-center text-sm font-medium" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2, ease: EASE }}>
                  {single === yesterday ? `Yesterday · ${title}` : title}
                </motion.span>
              </AnimatePresence>
            </span>
            <button
              onClick={() => step(1)}
              disabled={!!single && single >= yesterday}
              className="grid size-8 place-items-center rounded-full text-ink-2 transition-colors hover:bg-ink/[0.06] disabled:opacity-30"
              aria-label="Next day"
              data-testid="day-next"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
          {(state.range.from || state.range.to) && (
            <button onClick={() => setRange({})} className="h-9 rounded-full px-3 text-[0.8125rem] text-mute hover:bg-ink/[0.05] hover:text-ink" data-testid="day-all">
              All earlier days
            </button>
          )}
        </div>

        <FilterBar value={state} onChange={set} ws={ws.data} show={{ person: true, status: false }} maxDay={yesterday} testId="waiting-filters">
          <Select
            size="sm"
            value={windowValue}
            onChange={(v) => {
              const w = WINDOWS.find((x) => x.value === v)!;
              if (v === 'custom') set({ fromTime: state.fromTime || '09:00', toTime: state.toTime || '17:00' });
              else set({ fromTime: w.from, toTime: w.to });
            }}
            options={WINDOWS.map((w) => ({ value: w.value, label: w.label, icon: w.value === 'any' ? <Clock className="size-4 text-mute" /> : undefined }))}
            aria-label="Time of day"
            data-testid="waiting-filters-time"
          />
          {windowValue === 'custom' && (
            <span className="flex items-center gap-1.5 text-[0.8125rem] text-mute">
              <TimePicker value={state.fromTime || '09:00'} onChange={(v) => set({ fromTime: v })} aria-label="From" data-testid="time-from" />
              to
              <TimePicker value={state.toTime || '17:00'} onChange={(v) => set({ toTime: v })} aria-label="To" data-testid="time-to" />
            </span>
          )}
        </FilterBar>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pb-4 pt-5 text-sm text-mute sm:px-8" data-testid="waiting-summary">
        {history.isLoading ? (
          'Loading…'
        ) : (
          <>
            <span className="font-medium text-ink">
              {history.data?.total ?? 0} task{history.data?.total === 1 ? '' : 's'}
              {isFiltered(state) ? ' match' : ''}
            </span>
            {counts.unfinished > 0 && <span className="text-s-open-ink">{counts.unfinished} unfinished</span>}
            {counts.awaiting > 0 && <span className="text-s-done-ink">{counts.awaiting} awaiting your audit</span>}
            {counts.audited > 0 && <span>{counts.audited} audited</span>}
            {(history.data?.total ?? 0) > rows.length && <span>Showing the newest {rows.length}; narrow the dates to see the rest.</span>}
            {history.isFetching && <Spinner className="size-4" />}
          </>
        )}
      </div>

      {history.isLoading ? (
        <Spinner className="mx-8" />
      ) : (
        <div className={cx('transition-opacity', history.isPlaceholderData && 'opacity-60')}>
          <BoardLanes
            tasks={tasks}
            ws={ws.data}
            aiVerdicts={{}}
            verified={{}}
            news={news}
            onOpen={(id) => openTask(id)}
            onQuick={quick}
            busyId={transition.isPending ? (transition.variables?.id ?? null) : null}
            emptyOpenHint={isFiltered(state) ? 'Nothing matches here' : 'Nothing left open'}
            dayOf={single ? undefined : (t) => dayFmt.format(new Date(t.createdAt))}
          />
          {(history.data?.total ?? 0) === 0 && isFiltered(state) && (
            <div className="-mt-4 px-4 pb-10 text-center sm:px-8">
              <Button variant="outline" onClick={() => set({ q: '', person: 'all', priority: 'all', status: 'all', range: {}, fromTime: '', toTime: '' })}>
                Clear filters
              </Button>
            </div>
          )}
        </div>
      )}

      <TaskDrawer taskId={openTaskId} intent={params.get('intent')} onClose={() => openTask(null)} ws={ws.data} />
    </div>
  );
}
