import { LANES, type TaskFilters as ApiFilters, type TaskPriority } from '@delegate/shared';
import { Flag, Layers, Search, Users, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { DateRangePicker, rangeToIso, type DayRange } from '../components/DateRangePicker';
import { cx, EASE, Select } from '../components/ui';
import type { WorkspaceData } from './data';
import { memberOptions, priorityOptions } from './options';

/**
 * The filter bar for History and Audits: a search box (title, DLG number or a person's name),
 * person, priority, status (History) and a date range. Filters live in the address bar, so a
 * filtered view can be bookmarked, shared, or reached from a link (e.g. "?status=done").
 */

export interface FilterState {
  q: string;
  person: string;
  priority: string;
  status: string;
  range: DayRange;
}

const LANE_DOT: Record<string, string> = { open: 'var(--color-s-open)', active: 'var(--color-s-active)', done: 'var(--color-s-done)', approved: 'var(--color-s-approved)' };

/** Filters ↔ the page address. */
export function useFilterParams() {
  const [params, setParams] = useSearchParams();
  const state: FilterState = {
    q: params.get('q') ?? '',
    person: params.get('person') ?? 'all',
    priority: params.get('priority') ?? 'all',
    status: params.get('status') ?? 'all',
    range: { from: params.get('from') ?? undefined, to: params.get('to') ?? undefined },
  };
  const page = Math.max(1, Number(params.get('page')) || 1);
  // Only the keys in `patch` change, starting from the address as it is right now (not as it was
  // when this render happened), so a quick "Reset" followed by typing can't bring old filters back.
  const set = (patch: Partial<FilterState> & { page?: number }) => {
    const p = new URLSearchParams(window.location.search);
    const put = (k: string, v: string | undefined, empty = '') => (v && v !== empty ? p.set(k, v) : p.delete(k));
    if (patch.q !== undefined) put('q', patch.q.trim());
    if (patch.person !== undefined) put('person', patch.person, 'all');
    if (patch.priority !== undefined) put('priority', patch.priority, 'all');
    if (patch.status !== undefined) put('status', patch.status, 'all');
    if (patch.range !== undefined) {
      put('from', patch.range.from);
      put('to', patch.range.to);
    }
    put('page', patch.page && patch.page > 1 ? String(patch.page) : undefined);
    setParams(p, { replace: true });
  };
  return { state, page, set };
}

export function toApiFilters(f: FilterState, withStatus: boolean): ApiFilters {
  return {
    q: f.q.trim() || undefined,
    assigneeId: f.person !== 'all' ? f.person : undefined,
    priority: f.priority !== 'all' ? (f.priority as TaskPriority) : undefined,
    status: withStatus && f.status !== 'all' ? (f.status as ApiFilters['status']) : undefined,
    ...rangeToIso(f.range),
  };
}

export function isFiltered(f: FilterState) {
  return !!(f.q.trim() || f.person !== 'all' || f.priority !== 'all' || f.status !== 'all' || f.range.from || f.range.to);
}

export function FilterBar({
  value,
  onChange,
  ws,
  show,
  maxDay,
  testId = 'filters',
}: {
  value: FilterState;
  onChange: (patch: Partial<FilterState>) => void;
  ws: WorkspaceData;
  show: { person: boolean; status: boolean };
  maxDay?: string;
  testId?: string;
}) {
  // Typing feels instant; the search runs a moment after you pause.
  const [q, setQ] = useState(value.q);
  useEffect(() => setQ(value.q), [value.q]);
  useEffect(() => {
    if (q === value.q) return;
    const id = setTimeout(() => onChange({ q }), 250);
    return () => clearTimeout(id);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={testId}>
      <label className="group relative flex h-9 min-w-[220px] flex-1 items-center sm:max-w-sm">
        <Search className="pointer-events-none absolute left-3 size-4 text-faint transition-colors group-focus-within:text-ink" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search tasks, DLG-12 or a name"
          className="h-9 w-full rounded-full border border-line bg-paper pl-9 pr-8 text-[13px] outline-none transition-[border,box-shadow] placeholder:text-faint hover:border-line-2 focus:border-ink focus:ring-4 focus:ring-ink/[0.06]"
          aria-label="Search"
          data-testid={`${testId}-search`}
        />
        <AnimatePresence>
          {q && (
            <motion.button
              type="button"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.5, opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={() => {
                setQ('');
                onChange({ q: '' });
              }}
              className="absolute right-2 grid size-5 place-items-center rounded-full text-mute hover:bg-ink/10 hover:text-ink"
              aria-label="Clear search"
            >
              <X className="size-3.5" />
            </motion.button>
          )}
        </AnimatePresence>
      </label>

      {show.person && (
        <Select
          size="sm"
          value={value.person}
          onChange={(person) => onChange({ person })}
          options={[{ value: 'all', label: 'Everyone', icon: <Users className="size-4 text-mute" /> }, ...memberOptions(ws.members, { meId: ws.me.userId, departments: ws.departments })]}
          aria-label="Filter by person"
          data-testid={`${testId}-person`}
        />
      )}
      <Select
        size="sm"
        value={value.priority}
        onChange={(priority) => onChange({ priority })}
        options={[{ value: 'all', label: 'Any priority', icon: <Flag className="size-4 text-mute" /> }, ...priorityOptions]}
        aria-label="Filter by priority"
        data-testid={`${testId}-priority`}
      />
      {show.status && (
        <Select
          size="sm"
          value={value.status}
          onChange={(status) => onChange({ status })}
          options={[{ value: 'all', label: 'Any status', icon: <Layers className="size-4 text-mute" /> }, ...LANES.map((l) => ({ value: l.id, label: l.label, dot: LANE_DOT[l.id] }))]}
          aria-label="Filter by status"
          data-testid={`${testId}-status`}
        />
      )}
      <DateRangePicker value={value.range} onChange={(range) => onChange({ range })} maxDay={maxDay} data-testid={`${testId}-dates`} />

      <AnimatePresence>
        {isFiltered(value) && (
          <motion.button
            type="button"
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -6 }}
            transition={{ duration: 0.2, ease: EASE }}
            onClick={() => {
              setQ('');
              onChange({ q: '', person: 'all', priority: 'all', status: 'all', range: {} });
            }}
            className={cx('h-9 rounded-full px-3 text-[13px] text-mute transition-colors hover:bg-ink/[0.05] hover:text-ink')}
            data-testid={`${testId}-reset`}
          >
            Reset
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
