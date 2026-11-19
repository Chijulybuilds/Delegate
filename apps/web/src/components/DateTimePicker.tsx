import { CalendarDays, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Popover } from './Popover';
import { cx, EASE } from './util';

/**
 * Date & time pickers that replace the browser's native ones, styled like the rest of Delegate in
 * light and dark: quick picks, a calendar whose months slide and whose selection glides, time
 * chips plus scrolling hour/minute columns, and a plain-language summary ("in 3 days").
 *
 * Values use the same format as <input type="datetime-local"> ("2026-11-14T18:00") and
 * <input type="time"> ("08:00"), so callers keep their existing conversions.
 */

const pad = (n: number) => String(n).padStart(2, '0');
const toValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const sameDay = (a: Date, b: Date) => dayKey(a) === dayKey(b);
const at = (d: Date, h: number, m = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m);
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
const parse = (v: string) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

export function formatDue(d: Date) {
  return `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function relativeDue(d: Date, now = new Date()) {
  const days = Math.round((at(d, 0).getTime() - at(now, 0).getTime()) / 86_400_000);
  if (d.getTime() < now.getTime()) return days === 0 ? 'earlier today' : days === -1 ? 'yesterday' : `${-days} days ago`;
  if (days === 0) {
    const mins = Math.round((d.getTime() - now.getTime()) / 60_000);
    return mins < 60 ? `in ${mins} min` : `in ${Math.round(mins / 60)} h`;
  }
  return days === 1 ? 'tomorrow' : days < 7 ? `in ${days} days` : days < 14 ? 'next week' : `in ${Math.round(days / 7)} weeks`;
}

/** The suggestions people reach for most. */
function quickPicks(now = new Date()) {
  const later = now.getHours() < 16 ? at(now, 18) : new Date(Math.ceil((now.getTime() + 2 * 3_600_000) / 1_800_000) * 1_800_000);
  const dow = (now.getDay() + 6) % 7; // Monday = 0
  const friday = addDays(at(now, 17), dow < 4 ? 4 - dow : 11 - dow);
  const monday = addDays(at(now, 9), 7 - dow);
  return [
    { id: 'today', label: 'Later today', date: later },
    { id: 'tomorrow', label: 'Tomorrow', date: addDays(at(now, 9), 1) },
    { id: 'friday', label: dow < 4 ? 'This Friday' : 'Next Friday', date: friday },
    { id: 'monday', label: 'Next Monday', date: monday },
  ];
}

/* ------------------------------------------------------------------ shared pieces */

const TIME_CHIPS = ['09:00', '12:00', '15:00', '17:00', '18:00'];

function TimeColumns({ hour, minute, onChange, testId }: { hour: number; minute: number; onChange: (h: number, m: number) => void; testId: string }) {
  const hours = useRef<HTMLDivElement>(null);
  const minutes = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Bring the chosen values to the middle of each column.
    for (const [col, v] of [
      [hours.current, hour],
      [minutes.current, Math.round(minute / 5) * 5],
    ] as const) {
      const el = col?.querySelector<HTMLElement>(`[data-v="${v}"]`);
      if (!col || !el) continue;
      const offset = el.getBoundingClientRect().top - col.getBoundingClientRect().top + col.scrollTop;
      col.scrollTo({ top: offset - col.clientHeight / 2 + el.clientHeight / 2, behavior: 'smooth' });
    }
  }, [hour, minute]);
  const col = (ref: React.RefObject<HTMLDivElement | null>, values: number[], current: number, pick: (v: number) => void, kind: 'hour' | 'minute') => (
    <div ref={ref} className="h-[216px] w-14 snap-y overflow-y-auto overscroll-contain rounded-xl bg-milk py-[92px] [scrollbar-width:none]" role="listbox" aria-label={kind === 'hour' ? 'Hour' : 'Minute'}>
      {values.map((v) => {
        const on = v === current;
        return (
          <button
            key={v}
            type="button"
            role="option"
            aria-selected={on}
            data-v={v}
            data-testid={`${testId}-${kind}-${v}`}
            onClick={() => pick(v)}
            className={cx('relative block h-8 w-full snap-center text-sm tabular-nums transition-colors', on ? 'font-semibold text-milk' : 'text-mute hover:text-ink')}
          >
            {on && <motion.span layoutId={`${testId}-${kind}-pill`} className="absolute inset-x-1.5 inset-y-0.5 -z-0 rounded-lg bg-ink" transition={{ type: 'spring', stiffness: 520, damping: 36 }} />}
            <span className="relative">{pad(v)}</span>
          </button>
        );
      })}
    </div>
  );
  return (
    <div className="flex items-center gap-1.5">
      {col(hours, Array.from({ length: 24 }, (_, i) => i), hour, (h) => onChange(h, minute), 'hour')}
      <span className="text-lg font-medium text-faint">:</span>
      {col(minutes, Array.from({ length: 12 }, (_, i) => i * 5), minute - (minute % 5), (m) => onChange(hour, m), 'minute')}
    </div>
  );
}

function Trigger({
  refEl,
  open,
  onClick,
  icon,
  children,
  hint,
  size,
  danger,
  label,
  testId,
  disabled,
  onEscape,
}: {
  refEl: React.RefObject<HTMLButtonElement | null>;
  open: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
  hint?: string | null;
  size: 'md' | 'inline';
  danger?: boolean;
  label?: string;
  testId?: string;
  disabled?: boolean;
  /** Esc while the picker is open: close just the picker, never the modal around it. */
  onEscape?: () => void;
}) {
  return (
    <motion.button
      ref={refEl}
      type="button"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !open || !onEscape) return;
        e.preventDefault();
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
        onEscape();
      }}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.98 }}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={label}
      data-testid={testId}
      className={cx(
        'group inline-flex min-w-0 items-center gap-2.5 text-left outline-none transition-[border-color,box-shadow,background-color] duration-200 disabled:cursor-not-allowed disabled:opacity-55',
        size === 'md'
          ? cx('h-11 w-full rounded-xl border bg-paper px-3.5 text-sm shadow-[var(--shadow-card)] hover:border-line-2 hover:shadow-[var(--shadow-pop)]', open ? 'border-ink ring-4 ring-ink/[0.06]' : 'border-line')
          : 'h-8 -ml-2 rounded-lg px-2 text-sm font-medium hover:bg-ink/[0.05]',
        danger ? 'text-s-open-ink' : 'text-ink',
      )}
    >
      <span className={cx('shrink-0', danger ? 'text-s-open-ink' : 'text-mute group-hover:text-ink')}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className={cx('shrink-0 text-xs', danger ? 'text-s-open-ink/80' : 'text-faint')}>{hint}</span>}
    </motion.button>
  );
}

/* ------------------------------------------------------------------ date + time */

export function DateTimePicker({
  value,
  onChange,
  placeholder = 'No due date',
  clearable = true,
  size = 'md',
  disabled,
  'aria-label': ariaLabel = 'Due date',
  'data-testid': testId = 'due',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  clearable?: boolean;
  size?: 'md' | 'inline';
  disabled?: boolean;
  'aria-label'?: string;
  'data-testid'?: string;
}) {
  const uid = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const current = parse(value);
  const [draft, setDraft] = useState<Date>(() => current ?? at(addDays(new Date(), 1), 17));
  const [month, setMonth] = useState(() => new Date(draft.getFullYear(), draft.getMonth(), 1));
  const [dir, setDir] = useState(0);
  const cancelled = useRef(false);
  const now = new Date();
  const picks = useMemo(() => quickPicks(), [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const openPicker = () => {
    const start = current ?? at(addDays(new Date(), 1), 17);
    setDraft(start);
    setMonth(new Date(start.getFullYear(), start.getMonth(), 1));
    cancelled.current = false;
    setOpen(true);
  };
  const commit = (d: Date | null) => {
    const v = d ? toValue(d) : '';
    if (v !== value) onChange(v);
    cancelled.current = true;
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus());
  };
  // Clicking away keeps what you picked (like Notion); Esc throws it away.
  const close = () => {
    if (!cancelled.current && current?.getTime() !== draft.getTime() && open) commit(draft);
    else setOpen(false);
  };

  const goMonth = (delta: number) => {
    setDir(delta);
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));
  };
  const pickDay = (d: Date) => {
    const next = at(d, draft.getHours(), draft.getMinutes());
    if (d.getMonth() !== month.getMonth()) goMonth(d.getMonth() > month.getMonth() || d.getFullYear() > month.getFullYear() ? 1 : -1);
    setDraft(next);
  };

  // 6 weeks, Monday first.
  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const start = addDays(first, -((first.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [month]);

  const onKey = (e: KeyboardEvent) => {
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in moves && (e.target as HTMLElement).closest('[data-calendar]')) {
      e.preventDefault();
      const next = addDays(draft, moves[e.key]!);
      if (next.getMonth() !== month.getMonth()) goMonth(moves[e.key]! > 0 ? 1 : -1);
      setDraft(next);
    } else if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      goMonth(e.key === 'PageDown' ? 1 : -1);
    } else if (e.key === 'Enter' && (e.target as HTMLElement).closest('[data-calendar]')) {
      e.preventDefault();
      commit(draft);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation(); // close the picker, not the modal around it
      cancelled.current = true;
      setOpen(false);
      trigger.current?.focus();
    }
  };

  // Move focus onto the selected day once the panel has rendered (it mounts a frame or two later).
  useEffect(() => {
    if (!open) return;
    const timers = [40, 140].map((ms) => window.setTimeout(() => grid.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus({ preventScroll: true }), ms));
    return () => timers.forEach(clearTimeout);
  }, [open]);

  const overdue = !!current && current.getTime() < now.getTime();

  return (
    <>
      <Trigger
        refEl={trigger}
        open={open}
        onClick={() => (open ? close() : openPicker())}
        icon={<CalendarDays className="size-4" />}
        hint={current ? (overdue ? 'overdue' : relativeDue(current)) : null}
        size={size}
        danger={overdue}
        label={ariaLabel}
        testId={testId}
        disabled={disabled}
        onEscape={() => {
          cancelled.current = true;
          setOpen(false);
        }}
      >
        {current ? formatDue(current) : <span className="text-faint">{placeholder}</span>}
      </Trigger>

      <Popover anchor={trigger} open={open} onClose={close} placement="bottom-start" maxHeight={560} minSpace={470} sheetOnMobile className="w-[min(94vw,520px)]" label={ariaLabel}>
        {({ maxHeight }) => (
          <div role="dialog" aria-label={ariaLabel} onKeyDown={onKey} className="overflow-y-auto overscroll-contain p-1.5" style={{ maxHeight: maxHeight - 12 }} data-testid={`${testId}-picker`}>
            {/* Quick picks */}
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {picks.map((p, i) => (
                <motion.button
                  key={p.id}
                  type="button"
                  onClick={() => commit(p.date)}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.03 * i, duration: 0.25, ease: EASE }}
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.97 }}
                  className="rounded-xl border border-line bg-milk px-2.5 py-2 text-left transition-colors hover:border-ink/40"
                  data-testid={`${testId}-quick-${p.id}`}
                >
                  <span className="block text-[0.8125rem] font-medium">{p.label}</span>
                  <span className="block truncate text-[0.6875rem] text-mute">{formatDue(p.date)}</span>
                </motion.button>
              ))}
            </div>

            <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_auto]">
              {/* Calendar */}
              <div className="rounded-2xl border border-line p-2.5" data-calendar>
                <div className="flex items-center justify-between px-1">
                  <AnimatePresence mode="popLayout" initial={false} custom={dir}>
                    <motion.p
                      key={month.toISOString()}
                      custom={dir}
                      initial={{ opacity: 0, y: dir >= 0 ? 8 : -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: dir >= 0 ? -8 : 8 }}
                      transition={{ duration: 0.22, ease: EASE }}
                      className="text-sm font-semibold"
                      aria-live="polite"
                    >
                      {month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
                    </motion.p>
                  </AnimatePresence>
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        const t = at(new Date(), draft.getHours(), draft.getMinutes());
                        setDir(t >= month ? 1 : -1);
                        setMonth(new Date(t.getFullYear(), t.getMonth(), 1));
                        setDraft(t);
                      }}
                      className="mr-1 rounded-full px-2 py-1 text-xs font-medium text-mute hover:bg-ink/5 hover:text-ink"
                    >
                      Today
                    </button>
                    {[
                      [-1, ChevronLeft, 'Previous month'],
                      [1, ChevronRight, 'Next month'],
                    ].map(([d, Icon, label]) => {
                      const I = Icon as typeof ChevronLeft;
                      return (
                        <motion.button key={label as string} type="button" whileTap={{ scale: 0.88 }} onClick={() => goMonth(d as number)} className="grid size-8 place-items-center rounded-full text-mute hover:bg-ink/5 hover:text-ink" aria-label={label as string}>
                          <I className="size-4" />
                        </motion.button>
                      );
                    })}
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-7 text-center text-[0.6875rem] font-medium uppercase tracking-[0.06em] text-faint">
                  {WEEKDAYS.map((w) => (
                    <span key={w} className="py-1">
                      {w}
                    </span>
                  ))}
                </div>
                <div className="relative overflow-hidden">
                  <AnimatePresence mode="popLayout" initial={false} custom={dir}>
                    <motion.div
                      key={month.toISOString()}
                      ref={grid}
                      role="grid"
                      aria-label={month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
                      className="grid grid-cols-7 gap-y-0.5"
                      custom={dir}
                      initial={{ opacity: 0, x: dir * 28 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: dir * -28 }}
                      transition={{ duration: 0.26, ease: EASE }}
                    >
                      {days.map((d) => {
                        const inMonth = d.getMonth() === month.getMonth();
                        const selected = sameDay(d, draft);
                        const today = sameDay(d, now);
                        const past = at(d, 23, 59) < now;
                        return (
                          <button
                            key={dayKey(d)}
                            type="button"
                            role="gridcell"
                            aria-selected={selected}
                            aria-label={d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
                            tabIndex={selected ? 0 : -1}
                            data-day={dayKey(d)}
                            onClick={() => pickDay(d)}
                            className={cx(
                              'relative mx-auto grid size-9 place-items-center rounded-full text-[0.8125rem] tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ink/40',
                              selected ? 'font-semibold text-milk' : inMonth ? (past ? 'text-faint hover:bg-ink/5' : 'text-ink hover:bg-ink/[0.07]') : 'text-faint/50 hover:bg-ink/5',
                            )}
                          >
                            {selected && <motion.span layoutId={`${uid}-day`} className="absolute inset-0 rounded-full bg-ink" transition={{ type: 'spring', stiffness: 520, damping: 34 }} />}
                            <span className="relative">{d.getDate()}</span>
                            {today && <span className={cx('absolute bottom-1 size-1 rounded-full', selected ? 'bg-milk' : 'bg-s-approved')} />}
                          </button>
                        );
                      })}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </div>

              {/* Time */}
              <div className="rounded-2xl border border-line p-2.5">
                <p className="flex items-center gap-1.5 px-1 text-sm font-semibold">
                  <Clock className="size-3.5 text-mute" /> Time
                </p>
                <div className="mt-2 flex gap-2.5 sm:flex-col">
                  <div className="flex flex-wrap content-start gap-1 sm:w-[130px]">
                    {TIME_CHIPS.map((t) => {
                      const [h, m] = t.split(':').map(Number) as [number, number];
                      const on = draft.getHours() === h && draft.getMinutes() === m;
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setDraft(at(draft, h, m))}
                          className={cx('rounded-full border px-2.5 py-1 text-xs tabular-nums transition-colors', on ? 'border-ink bg-ink text-milk' : 'border-line text-ink-2 hover:border-ink/40')}
                          data-testid={`${testId}-time-${t}`}
                        >
                          {t}
                        </button>
                      );
                    })}
                  </div>
                  <TimeColumns hour={draft.getHours()} minute={draft.getMinutes()} onChange={(h, m) => setDraft(at(draft, h, m))} testId={testId} />
                </div>
              </div>
            </div>

            {/* Summary + actions */}
            <div className="sticky -bottom-1.5 -mx-1.5 mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-line bg-paper/95 px-2.5 pb-1 pt-2.5 backdrop-blur">
              <p className="text-sm">
                <span className="font-medium">{formatDue(draft)}</span> <span className="text-mute">· {relativeDue(draft)}</span>
              </p>
              <div className="flex gap-1.5">
                {clearable && (
                  <button type="button" onClick={() => commit(null)} className="rounded-full px-3 py-1.5 text-sm text-mute hover:bg-ink/5 hover:text-ink" data-testid={`${testId}-clear`}>
                    {current ? 'Remove' : 'No date'}
                  </button>
                )}
                <motion.button type="button" whileTap={{ scale: 0.96 }} onClick={() => commit(draft)} className="rounded-full bg-ink px-4 py-1.5 text-sm font-medium text-milk hover:bg-ink/90" data-testid={`${testId}-done`}>
                  Done
                </motion.button>
              </div>
            </div>
          </div>
        )}
      </Popover>
    </>
  );
}

/* ------------------------------------------------------------------ time only */

export function TimePicker({
  value,
  onChange,
  'aria-label': ariaLabel = 'Time',
  'data-testid': testId = 'time',
  chips = ['07:00', '08:00', '09:00', '12:00', '17:00', '18:00'],
}: {
  value: string;
  onChange: (value: string) => void;
  'aria-label'?: string;
  'data-testid'?: string;
  chips?: string[];
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [h0, m0] = (value || '09:00').split(':').map(Number) as [number, number];
  const [draft, setDraft] = useState({ h: h0, m: m0 });
  const commit = (h: number, m: number) => {
    onChange(`${pad(h)}:${pad(m)}`);
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus());
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      setOpen(false);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commit(draft.h, draft.m);
    }
  };
  const period = draft.h < 12 ? 'Morning' : draft.h < 17 ? 'Afternoon' : 'Evening';

  return (
    <>
      <Trigger
        refEl={trigger}
        open={open}
        onClick={() => {
          setDraft({ h: h0, m: m0 });
          setOpen((o) => !o);
        }}
        icon={<Clock className="size-4" />}
        size="md"
        label={ariaLabel}
        testId={testId}
        onEscape={() => setOpen(false)}
      >
        <span className="tabular-nums">{value || 'Pick a time'}</span>
      </Trigger>
      <Popover anchor={trigger} open={open} onClose={() => (draft.h !== h0 || draft.m !== m0 ? commit(draft.h, draft.m) : setOpen(false))} placement="bottom-start" minSpace={300} className="w-[248px]" label={ariaLabel}>
        <div className="p-1.5" role="dialog" aria-label={ariaLabel} onKeyDown={onKey} data-testid={`${testId}-picker`}>
          <div className="flex flex-wrap gap-1">
            {chips.map((t) => {
              const [h, m] = t.split(':').map(Number) as [number, number];
              const on = draft.h === h && draft.m === m;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => commit(h, m)}
                  className={cx('rounded-full border px-2.5 py-1 text-xs tabular-nums transition-colors', on ? 'border-ink bg-ink text-milk' : 'border-line text-ink-2 hover:border-ink/40')}
                  data-testid={`${testId}-chip-${t}`}
                >
                  {t}
                </button>
              );
            })}
          </div>
          <div className="mt-2.5 flex items-center justify-between gap-3">
            <TimeColumns hour={draft.h} minute={draft.m} onChange={(h, m) => setDraft({ h, m })} testId={testId} />
            <div className="flex-1 text-center">
              <p className="text-3xl font-medium tabular-nums tracking-[-0.03em]">
                {pad(draft.h)}:{pad(draft.m)}
              </p>
              <p className="mt-1 text-xs text-mute">{period}</p>
              <motion.button type="button" whileTap={{ scale: 0.96 }} onClick={() => commit(draft.h, draft.m)} className="mt-4 rounded-full bg-ink px-4 py-1.5 text-sm font-medium text-milk hover:bg-ink/90" data-testid={`${testId}-done`}>
                Done
              </motion.button>
            </div>
          </div>
        </div>
      </Popover>
    </>
  );
}
