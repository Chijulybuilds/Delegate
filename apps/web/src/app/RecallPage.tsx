import { isManagerRole, taskRef, type AuditRow, type Task, type TaskFilters } from '@delegate/shared';
import { Check, RotateCcw } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { dayKey } from '../components/DateRangePicker';
import { useToast } from '../components/Toast';
import { Avatar, Button, cx, EASE, EmptyState, PriorityTag, Segmented, Spinner, StatusBadge } from '../components/ui';
import { dueLabel } from '../lib/format';
import { PageHeader } from './AppShell';
import { useHistory, useRecallMany, useWorkspace } from './data';
import { RecallModal } from './RecallModal';
import { FilterBar, isFiltered, toApiFilters, useFilterParams } from './TaskFilters';
import { TaskDrawer } from './TaskDrawer';

/**
 * Recall: bring tasks from earlier days back onto today's board. Pick one (and give it to someone,
 * set the due time, leave a note) or tick several and recall them together. The owner can recall
 * anything (even audited work); managers what they handed out; staff their own unfinished tasks.
 */

type Scope = 'unfinished' | 'done' | 'approved' | 'all';
const SCOPES: Array<{ value: Scope; label: string }> = [
  { value: 'unfinished', label: 'Not finished' },
  { value: 'done', label: 'Executed' },
  { value: 'approved', label: 'Audited' },
  { value: 'all', label: 'Everything' },
];

export default function RecallPage() {
  const ws = useWorkspace();
  const manager = isManagerRole(ws.data?.me.role);
  const { state, set } = useFilterParams();
  const [params, setParams] = useSearchParams();
  const scope: Scope = manager ? ((SCOPES.find((x) => x.value === params.get('scope'))?.value ?? 'unfinished') as Scope) : 'unfinished';
  const filters: TaskFilters = { ...toApiFilters(state, false), recallable: true, ...(scope === 'all' ? {} : { status: scope }) };
  const list = useHistory(filters, !!ws.data);
  const recallMany = useRecallMany();
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [one, setOne] = useState<Task | null>(null);
  const openTaskId = params.get('task');

  const rows = list.data?.rows ?? [];
  const groups = useMemo(() => groupByDay(rows, list.data?.timezone ?? 'UTC'), [rows, list.data?.timezone]);
  const visibleIds = rows.map((r) => r.task.id);
  const chosen = visibleIds.filter((id) => selected.has(id));

  if (!ws.data) return <Spinner className="m-8" />;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleDay = (ids: string[]) =>
    setSelected((prev) => {
      const next = new Set(prev);
      const all = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (all) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  const setScope = (v: Scope) => {
    const next = new URLSearchParams(window.location.search);
    if (v === 'unfinished') next.delete('scope');
    else next.set('scope', v);
    setParams(next, { replace: true });
    setSelected(new Set());
  };
  const openTask = (id: string | null) => {
    const next = new URLSearchParams(window.location.search);
    if (id) next.set('task', id);
    else next.delete('task');
    setParams(next, { replace: !id });
  };

  const recallChosen = async () => {
    try {
      const r = await recallMany.mutateAsync(chosen);
      setSelected(new Set());
      if (r.recalled.length) toast.success(`Recalled ${r.recalled.length} task${r.recalled.length === 1 ? '' : 's'} to today`);
      if (r.skipped.length) toast.error(new Error(`${r.skipped.length} couldn’t be recalled: ${r.skipped[0]!.reason}`));
    } catch (e) {
      toast.error(e);
    }
  };

  const yesterday = dayKey(new Date(Date.now() - 86_400_000));
  return (
    <div className="pb-28">
      <PageHeader
        title="Recall"
        subtitle={
          ws.data.me.role === 'owner'
            ? 'Bring any task from an earlier day back onto today’s board: unfinished, executed or even audited. The original stays in History.'
            : manager
              ? 'Bring tasks you handed out on earlier days back onto today’s board.'
              : 'Bring your unfinished tasks from earlier days back onto today’s board.'
        }
      />
      <div className="z-20 space-y-3 border-b border-[var(--edge)] bg-milk px-4 py-3 sm:px-8 lg:sticky lg:top-0 lg:bg-panel">
        {manager && <Segmented value={scope} onChange={setScope} options={SCOPES} />}
        <FilterBar value={state} onChange={(p) => (set(p), setSelected(new Set()))} ws={ws.data} show={{ person: manager, status: false }} maxDay={yesterday} testId="recall-filters" />
      </div>

      <div className="px-4 pt-5 sm:px-8">
        {list.isLoading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState
            title={isFiltered(state) ? 'Nothing matches these filters' : 'Nothing to recall'}
            body={isFiltered(state) ? 'Try a wider date range or clear a filter.' : scope === 'unfinished' ? 'Everything from earlier days is finished or already recalled.' : 'No tasks like that from earlier days.'}
          />
        ) : (
          <div className={cx('max-w-5xl space-y-7 transition-opacity', list.isPlaceholderData && 'opacity-60')} data-testid="recall-list">
            {groups.map((g) => {
              const ids = g.rows.map((r) => r.task.id);
              const allOn = ids.every((id) => selected.has(id));
              return (
                <section key={g.key}>
                  <div className="mb-2.5 flex items-center gap-3">
                    <h2 className="text-xs font-medium uppercase tracking-[0.14em] text-faint">{g.label}</h2>
                    <button onClick={() => toggleDay(ids)} className="text-xs font-medium text-mute hover:text-ink" data-testid="recall-select-day">
                      {allOn ? 'Unselect all' : `Select all ${ids.length}`}
                    </button>
                  </div>
                  <ol className="space-y-2">
                    {g.rows.map((r, i) => (
                      <Row key={r.task.id} row={r} index={i} on={selected.has(r.task.id)} onToggle={() => toggle(r.task.id)} onRecall={() => setOne(r.task)} onOpen={() => openTask(r.task.id)} />
                    ))}
                  </ol>
                </section>
              );
            })}
          </div>
        )}
      </div>

      {/* The selection bar */}
      <AnimatePresence>
        {chosen.length > 0 && (
          <motion.div
            className="fixed inset-x-0 bottom-20 z-40 flex justify-center px-4 lg:bottom-8 lg:left-[256px]"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ duration: 0.3, ease: EASE }}
          >
            <div className="surface flex items-center gap-3 rounded-full py-2 pl-5 pr-2 shadow-[var(--shadow-float)]" data-testid="recall-bar">
              <span className="text-sm">
                <span className="font-medium">{chosen.length}</span> selected
              </span>
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
              <Button onClick={recallChosen} loading={recallMany.isPending} data-testid="recall-selected">
                <RotateCcw className="size-4" /> Recall {chosen.length} to today
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <RecallModal task={one} ws={ws.data} onClose={() => setOne(null)} />
      <TaskDrawer taskId={openTaskId} intent={null} onClose={() => openTask(null)} ws={ws.data} />
    </div>
  );
}

function Row({ row, index, on, onToggle, onRecall, onOpen }: { row: AuditRow; index: number; on: boolean; onToggle: () => void; onRecall: () => void; onOpen: () => void }) {
  const t = row.task;
  const due = dueLabel(t.dueAt);
  const late = due.overdue && (t.status === 'open' || t.status === 'in_progress' || t.status === 'blocked');
  return (
    <motion.li initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE, delay: Math.min(index, 10) * 0.02 }}>
      <div className={cx('surface lift flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl px-3 py-3 sm:px-4', on && 'border-ink/40 ring-2 ring-ink/15')} data-testid="recall-row" data-task-title={t.title}>
        <button
          onClick={onToggle}
          role="checkbox"
          aria-checked={on}
          aria-label={`Select ${t.title}`}
          className={cx('grid size-6 shrink-0 place-items-center rounded-lg border transition-colors', on ? 'obsidian border-transparent' : 'border-line-2 bg-paper hover:border-ink/60')}
          data-testid="recall-check"
        >
          {on && <Check className="size-4" strokeWidth={2.6} />}
        </button>
        <button onClick={onOpen} className="min-w-0 flex-1 basis-56 text-left">
          <span className="flex items-center gap-2">
            <span className="font-mono text-[0.6875rem] text-faint">{taskRef(t.seq)}</span>
            <PriorityTag priority={t.priority} />
            {row.departmentName && <span className="truncate text-[0.6875rem] text-faint">· {row.departmentName}</span>}
          </span>
          <span className="mt-0.5 block truncate text-[0.9375rem] font-medium">{t.title}</span>
        </button>
        <span className="flex items-center gap-2 text-xs text-ink-2">
          <Avatar name={row.assigneeName} size={22} />
          <span className="max-w-[120px] truncate">{row.assigneeName}</span>
        </span>
        {late && <span className="rounded-full bg-s-open-soft px-2 py-0.5 text-xs font-medium text-s-open-ink">{due.text}</span>}
        <StatusBadge status={t.status} />
        <Button size="sm" variant="outline" onClick={onRecall} data-testid="recall-one">
          <RotateCcw className="size-3.5" /> Recall…
        </Button>
      </div>
    </motion.li>
  );
}

/** Rows (newest first) grouped by the day they were given out, in the workspace's time zone. */
function groupByDay(rows: AuditRow[], timezone: string) {
  const keyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const labelFmt = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'long', day: 'numeric', month: 'long' });
  const yesterday = keyFmt.format(new Date(Date.now() - 86_400_000));
  const out: Array<{ key: string; label: string; rows: AuditRow[] }> = [];
  for (const r of rows) {
    const created = new Date(r.task.createdAt);
    const key = keyFmt.format(created);
    let g = out[out.length - 1];
    if (g?.key !== key) {
      g = { key, label: key === yesterday ? `Yesterday · ${labelFmt.format(created)}` : labelFmt.format(created), rows: [] };
      out.push(g);
    }
    g.rows.push(r);
  }
  return out;
}
