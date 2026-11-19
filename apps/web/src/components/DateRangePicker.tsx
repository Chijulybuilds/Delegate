import { CalendarRange, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useId, useMemo, useRef, useState } from 'react';
import { Popover } from './Popover';
import { cx, EASE } from './util';

/**
 * Date range filter: quick ranges (Yesterday, Last 7 days, This month…) on the left and a
 * calendar on the right. Click a first day, then a last day; the range lights up as you hover.
 * Values are local calendar days, "YYYY-MM-DD"; `to` is inclusive.
 */

export interface DayRange {
  from?: string;
  to?: string;
}

const DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const pad = (n: number) => String(n).padStart(2, '0');
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (k: string) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
};
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const short = (k: string) => fromKey(k).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** The range as ISO instants for the API: [from 00:00, day after `to` 00:00). */
export function rangeToIso(r: DayRange): { from?: string; to?: string } {
  return {
    from: r.from ? fromKey(r.from).toISOString() : undefined,
    to: r.to ? addDays(fromKey(r.to), 1).toISOString() : undefined,
  };
}

function presets(now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const y = addDays(today, -1);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  return [
    { id: 'yesterday', label: 'Yesterday', range: { from: dayKey(y), to: dayKey(y) } },
    { id: '7d', label: 'Last 7 days', range: { from: dayKey(addDays(today, -7)), to: dayKey(y) } },
    { id: '30d', label: 'Last 30 days', range: { from: dayKey(addDays(today, -30)), to: dayKey(y) } },
    { id: 'month', label: 'This month', range: { from: dayKey(monthStart), to: dayKey(today) } },
    { id: 'lastmonth', label: 'Last month', range: { from: dayKey(lastMonthStart), to: dayKey(addDays(monthStart, -1)) } },
    { id: 'all', label: 'All dates', range: {} },
  ];
}

export function rangeLabel(r: DayRange) {
  const match = presets().find((p) => p.range.from === r.from && p.range.to === r.to && p.id !== 'all');
  if (match) return match.label;
  if (r.from && r.to) return r.from === r.to ? short(r.from) : `${short(r.from)} – ${short(r.to)}`;
  if (r.from) return `From ${short(r.from)}`;
  if (r.to) return `Until ${short(r.to)}`;
  return 'All dates';
}

export function DateRangePicker({ value, onChange, maxDay, 'data-testid': testId = 'date-range' }: { value: DayRange; onChange: (r: DayRange) => void; maxDay?: string; 'data-testid'?: string }) {
  const uid = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DayRange>(value);
  const [hover, setHover] = useState<string | null>(null);
  const [month, setMonth] = useState(() => {
    const base = value.to ? fromKey(value.to) : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const [dir, setDir] = useState(0);
  const today = dayKey(new Date());
  const limit = maxDay ?? today;
  const active = !!(value.from || value.to);

  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7; // Monday first
    return Array.from({ length: 42 }, (_, i) => addDays(first, i - offset));
  }, [month]);

  const openPanel = () => {
    setDraft(value);
    setOpen(true);
  };
  const apply = (r: DayRange) => {
    onChange(r);
    setOpen(false);
  };
  const pick = (k: string) => {
    if (!draft.from || draft.to) return setDraft({ from: k, to: undefined });
    if (k < draft.from) return setDraft({ from: k, to: draft.from });
    setDraft({ from: draft.from, to: k });
  };
  const shift = (n: number) => {
    setDir(n);
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));
  };

  // While choosing the second day, the range follows the pointer.
  const lo = draft.from && !draft.to && hover ? (hover < draft.from ? hover : draft.from) : draft.from;
  const hi = draft.from && !draft.to && hover ? (hover < draft.from ? draft.from : hover) : draft.to;

  return (
    <>
      <motion.button
        ref={trigger}
        type="button"
        onClick={() => (open ? setOpen(false) : openPanel())}
        whileTap={{ scale: 0.97 }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? uid : undefined}
        className={cx(
          'inline-flex h-9 items-center gap-2 rounded-full border pl-3.5 pr-2.5 text-[0.8125rem] transition-[border,background,box-shadow]',
          open ? 'border-ink bg-paper ring-4 ring-ink/[0.06]' : active ? 'border-ink/70 bg-paper text-ink' : 'border-line bg-paper text-ink-2 hover:border-line-2',
        )}
        data-testid={testId}
      >
        <CalendarRange className="size-4 text-mute" />
        <span className={active ? 'font-medium' : ''}>{rangeLabel(value)}</span>
        {active ? (
          <span
            role="button"
            tabIndex={-1}
            aria-label="Clear dates"
            onClick={(e) => {
              e.stopPropagation();
              onChange({});
            }}
            className="grid size-5 place-items-center rounded-full text-mute hover:bg-ink/10 hover:text-ink"
          >
            <X className="size-3.5" />
          </span>
        ) : (
          <ChevronDown className={cx('size-4 text-faint transition-transform duration-300', open && 'rotate-180')} />
        )}
      </motion.button>

      <Popover anchor={trigger} open={open} onClose={() => setOpen(false)} placement="bottom-start" maxHeight={460} minSpace={360} sheetOnMobile className="w-[min(560px,calc(100vw-16px))]" id={uid} label="Choose dates">
        <div className="flex flex-col sm:flex-row" data-testid={`${testId}-panel`}>
          <div className="scrollbar-none flex gap-1 overflow-x-auto border-b border-line p-2 sm:w-40 sm:flex-col sm:border-b-0 sm:border-r">
            {presets().map((p) => {
              const on = (p.range.from ?? '') === (value.from ?? '') && (p.range.to ?? '') === (value.to ?? '');
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => apply(p.range)}
                  className={cx('shrink-0 rounded-xl px-3 py-2 text-left text-[0.8125rem] transition-colors', on ? 'bg-ink font-medium text-milk' : 'text-ink-2 hover:bg-ink/[0.05]')}
                  data-testid={`${testId}-preset-${p.id}`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          <div className="flex-1 p-3">
            <div className="flex items-center justify-between px-1 pb-2">
              <button type="button" onClick={() => shift(-1)} className="grid size-8 place-items-center rounded-full text-ink-2 hover:bg-ink/[0.06]" aria-label="Previous month">
                <ChevronLeft className="size-4" />
              </button>
              <AnimatePresence mode="popLayout" initial={false} custom={dir}>
                <motion.p key={month.toISOString()} className="text-sm font-medium" initial={{ opacity: 0, x: dir * 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: dir * -16 }} transition={{ duration: 0.25, ease: EASE }}>
                  {month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
                </motion.p>
              </AnimatePresence>
              <button
                type="button"
                onClick={() => shift(1)}
                disabled={dayKey(new Date(month.getFullYear(), month.getMonth() + 1, 1)) > limit}
                className="grid size-8 place-items-center rounded-full text-ink-2 hover:bg-ink/[0.06] disabled:opacity-30"
                aria-label="Next month"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
            <div className="grid grid-cols-7 text-center text-[0.6875rem] font-medium text-faint">
              {DOW.map((d) => (
                <span key={d} className="py-1">
                  {d}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-y-0.5" onMouseLeave={() => setHover(null)}>
              {days.map((d) => {
                const k = dayKey(d);
                const outside = d.getMonth() !== month.getMonth();
                const disabled = k > limit;
                const inRange = !!(lo && hi && k >= lo && k <= hi);
                const edge = k === lo || k === hi;
                return (
                  <div key={k} className={cx('relative h-9', inRange && !edge && 'bg-ink/[0.07]', inRange && k === lo && hi !== lo && 'rounded-l-full bg-ink/[0.07]', inRange && k === hi && hi !== lo && 'rounded-r-full bg-ink/[0.07]')}>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => pick(k)}
                      onMouseEnter={() => setHover(k)}
                      className={cx(
                        'relative mx-auto grid size-9 place-items-center rounded-full text-[0.8125rem] tabular-nums transition-colors',
                        edge ? 'bg-ink font-medium text-milk' : outside ? 'text-faint' : 'text-ink-2 hover:bg-ink/[0.08]',
                        disabled && 'pointer-events-none opacity-30',
                        k === today && !edge && 'font-semibold text-ink underline decoration-2 underline-offset-4',
                      )}
                      aria-label={d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
                      aria-pressed={edge}
                      data-day={k}
                    >
                      {d.getDate()}
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3">
              <p className="text-xs text-mute">{draft.from ? (draft.to ? rangeLabel(draft) : `${short(draft.from)} – pick the last day`) : 'Pick the first day'}</p>
              <div className="flex gap-1.5">
                <button type="button" onClick={() => setDraft({})} className="rounded-full px-3 py-1.5 text-[0.8125rem] text-mute hover:bg-ink/[0.05] hover:text-ink">
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => apply(draft.from && !draft.to ? { from: draft.from, to: draft.from } : draft)}
                  className="rounded-full bg-ink px-4 py-1.5 text-[0.8125rem] font-medium text-milk transition-transform active:scale-95"
                  data-testid={`${testId}-apply`}
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      </Popover>
    </>
  );
}
