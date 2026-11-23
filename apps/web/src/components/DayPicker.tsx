import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useId, useMemo, useRef, useState } from 'react';
import { Popover } from './Popover';
import { cx, EASE } from './util';

/**
 * Pick one day from a calendar ("YYYY-MM-DD", local), or clear it to go back to the whole period.
 * Days outside [minDay, maxDay] can't be picked; days in `marked` get a small dot (e.g. days with work).
 */

const DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const pad = (n: number) => String(n).padStart(2, '0');
const keyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (k: string) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
};
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export function DayPicker({
  value,
  onChange,
  minDay,
  maxDay,
  marked,
  emptyLabel,
  'data-testid': testId = 'day-picker',
}: {
  value: string | null;
  onChange: (day: string | null) => void;
  minDay?: string;
  maxDay?: string;
  marked?: Set<string>;
  /** What the button says with no day picked, e.g. "All 14 days". */
  emptyLabel: string;
  'data-testid'?: string;
}) {
  const uid = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const today = keyOf(new Date());
  const limit = maxDay ?? today;
  const [month, setMonth] = useState(() => {
    const base = fromKey(value ?? limit);
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const [dir, setDir] = useState(0);

  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7; // Monday first
    return Array.from({ length: 42 }, (_, i) => addDays(first, i - offset));
  }, [month]);

  const label = value ? fromKey(value).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: value.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric' }) : emptyLabel;
  const yesterday = keyOf(addDays(new Date(), -1));
  const pick = (k: string | null) => {
    onChange(k);
    setOpen(false);
  };
  const shift = (n: number) => {
    setDir(n);
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));
  };
  const firstOf = (d: Date) => keyOf(new Date(d.getFullYear(), d.getMonth(), 1));
  const lastOf = (d: Date) => keyOf(new Date(d.getFullYear(), d.getMonth() + 1, 0));

  return (
    <>
      <motion.button
        ref={trigger}
        type="button"
        onClick={() => {
          if (!open) setMonth(() => {
            const base = fromKey(value ?? limit);
            return new Date(base.getFullYear(), base.getMonth(), 1);
          });
          setOpen((o) => !o);
        }}
        whileTap={{ scale: 0.97 }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? uid : undefined}
        className={cx(
          'inline-flex h-10 items-center gap-2 rounded-full border pl-3.5 pr-2.5 text-sm transition-[border,background,box-shadow]',
          open ? 'border-ink bg-paper ring-4 ring-ink/[0.06]' : value ? 'border-ink/70 bg-paper text-ink' : 'border-line bg-paper text-ink-2 hover:border-line-2',
        )}
        data-testid={testId}
      >
        <CalendarDays className="size-4 text-mute" />
        <span className="font-medium">{label}</span>
        {value ? (
          <span
            role="button"
            tabIndex={-1}
            aria-label="Show the whole period"
            onClick={(e) => {
              e.stopPropagation();
              onChange(null);
            }}
            className="grid size-5 place-items-center rounded-full text-mute hover:bg-ink/10 hover:text-ink"
            data-testid={`${testId}-clear`}
          >
            <X className="size-3.5" />
          </span>
        ) : (
          <ChevronDown className={cx('size-4 text-faint transition-transform duration-300', open && 'rotate-180')} />
        )}
      </motion.button>

      <Popover anchor={trigger} open={open} onClose={() => setOpen(false)} placement="bottom-start" maxHeight={440} minSpace={340} sheetOnMobile className="w-[min(340px,calc(100vw-16px))]" id={uid} label="Choose a day">
        <div className="p-3" data-testid={`${testId}-panel`}>
          <div className="mb-2 flex gap-1.5">
            {[
              { id: 'all', label: emptyLabel, day: null },
              { id: 'today', label: 'Today', day: today },
              { id: 'yesterday', label: 'Yesterday', day: yesterday },
            ]
              .filter((q) => !q.day || ((!minDay || q.day >= minDay) && q.day <= limit))
              .map((q) => (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => pick(q.day)}
                  className={cx('rounded-full px-3 py-1.5 text-[0.8125rem] transition-colors', value === q.day ? 'bg-ink font-medium text-milk' : 'bg-milk-2 text-ink-2 hover:bg-ink/[0.08]')}
                  data-testid={`${testId}-${q.id}`}
                >
                  {q.label}
                </button>
              ))}
          </div>
          <div className="flex items-center justify-between px-1 pb-2">
            <button type="button" onClick={() => shift(-1)} disabled={!!minDay && lastOf(addDays(month, -1)) < minDay} className="grid size-8 place-items-center rounded-full text-ink-2 hover:bg-ink/[0.06] disabled:opacity-30" aria-label="Previous month">
              <ChevronLeft className="size-4" />
            </button>
            <AnimatePresence mode="popLayout" initial={false} custom={dir}>
              <motion.p key={month.toISOString()} className="text-sm font-medium" initial={{ opacity: 0, x: dir * 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: dir * -16 }} transition={{ duration: 0.25, ease: EASE }}>
                {month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
              </motion.p>
            </AnimatePresence>
            <button type="button" onClick={() => shift(1)} disabled={firstOf(new Date(month.getFullYear(), month.getMonth() + 1, 1)) > limit} className="grid size-8 place-items-center rounded-full text-ink-2 hover:bg-ink/[0.06] disabled:opacity-30" aria-label="Next month">
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
          <div className="grid grid-cols-7 gap-y-0.5">
            {days.map((d) => {
              const k = keyOf(d);
              const outside = d.getMonth() !== month.getMonth();
              const disabled = k > limit || (!!minDay && k < minDay);
              const on = k === value;
              return (
                <button
                  key={k}
                  type="button"
                  disabled={disabled}
                  onClick={() => pick(k)}
                  className={cx(
                    'relative mx-auto grid size-9 place-items-center rounded-full text-[0.8125rem] tabular-nums transition-colors',
                    on ? 'bg-ink font-medium text-milk' : outside ? 'text-faint' : 'text-ink-2 hover:bg-ink/[0.08]',
                    disabled && 'pointer-events-none opacity-30',
                    k === today && !on && 'font-semibold text-ink underline decoration-2 underline-offset-4',
                  )}
                  aria-label={d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
                  aria-pressed={on}
                  data-day={k}
                >
                  {d.getDate()}
                  {marked?.has(k) && !disabled && <span className={cx('absolute bottom-1 size-1 rounded-full', on ? 'bg-milk' : 'bg-ink/60')} />}
                </button>
              );
            })}
          </div>
          <p className="mt-2 px-1 text-xs text-mute">Dots mark days with work executed.</p>
        </div>
      </Popover>
    </>
  );
}
