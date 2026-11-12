import { motion } from 'motion/react';
import { useState, type ReactNode } from 'react';
import { cx, EASE } from './ui';

/* Chart primitives following one spec: thin marks (≤24px), 4px rounded data-ends square at the
   baseline, 2px surface gaps, hairline recessive axes, text in ink tokens, hover tooltips,
   and an sr-only table so nothing is colour- or hover-gated. */

export function StatTile({ label, value, hint, testId }: { label: string; value: ReactNode; hint?: string; testId?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-paper px-5 py-4 shadow-[var(--shadow-card)]" data-testid={testId}>
      <p className="text-[13px] text-mute">{label}</p>
      <p className="mt-1.5 text-[2rem] font-medium leading-none tracking-display">{value}</p>
      {hint && <p className="mt-2 text-xs text-faint">{hint}</p>}
    </div>
  );
}

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  return (n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

export function ColumnChart({
  data,
  unit,
  title,
  height = 180,
  color = 'var(--color-ink)',
  emptyText = 'No data in this period yet',
}: {
  data: Array<{ label: string; value: number; tooltipLabel?: string }>;
  unit: string;
  title: string;
  height?: number;
  color?: string;
  emptyText?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const empty = data.every((d) => d.value === 0);
  const max = niceMax(Math.max(1, ...data.map((d) => d.value)));
  const peak = data.reduce((best, d, i) => (d.value > (data[best]?.value ?? -1) ? i : best), 0);
  const ticks = [0, max / 2, max];

  return (
    <figure aria-label={title}>
      <div className="relative flex" style={{ height }}>
        {/* y-axis ticks */}
        <div className="relative w-7 shrink-0 text-right text-[11px] text-faint">
          {ticks.map((t) => (
            <span key={t} className="absolute right-2 -translate-y-1/2" style={{ top: `${(1 - t / max) * 100}%` }}>
              {t}
            </span>
          ))}
        </div>
        <div className="relative flex-1">
          {ticks.map((t) => (
            <div key={t} className="absolute inset-x-0 h-px bg-line" style={{ top: `${(1 - t / max) * 100}%` }} />
          ))}
          {empty && <p className="absolute inset-x-0 top-1/3 text-center text-sm text-faint">{emptyText}</p>}
          <div className="absolute inset-0 flex items-end gap-[2px]">
            {data.map((d, i) => {
              const h = (d.value / max) * 100;
              const showLabel = (i === peak || i === data.length - 1) && d.value > 0;
              return (
                <div
                  key={d.label}
                  className="relative flex h-full flex-1 items-end justify-center"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  tabIndex={0}
                  aria-label={`${d.tooltipLabel ?? d.label}: ${d.value} ${unit}`}
                >
                  {hover === i && <div className="absolute inset-y-0 left-0 right-0 rounded-md bg-black/[0.03]" />}
                  <motion.div
                    className="relative w-full max-w-6 rounded-t-[4px]"
                    style={{ background: color, opacity: hover === null || hover === i ? 1 : 0.45 }}
                    initial={{ height: 0 }}
                    animate={{ height: `${h}%` }}
                    transition={{ duration: 0.7, ease: EASE, delay: i * 0.02 }}
                  >
                    {showLabel && <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[11px] font-medium text-ink-2">{d.value}</span>}
                  </motion.div>
                  {hover === i && (
                    <div className="pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-xs text-milk shadow-[var(--shadow-float)]">
                      <span className="text-milk/60">{d.tooltipLabel ?? d.label}</span> · {d.value} {unit}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="ml-7 mt-2 flex gap-[2px] text-[10px] text-faint">
        {data.map((d, i) => (
          <span key={d.label} className="flex-1 text-center">
            {data.length <= 14 || i % 2 === 0 ? d.label : ''}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}>
              <th scope="row">{d.tooltipLabel ?? d.label}</th>
              <td>
                {d.value} {unit}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

const hatch = 'repeating-linear-gradient(45deg, rgba(255,255,255,0.55) 0 2px, transparent 2px 6px)';

/** Horizontal stacked bar for part-to-whole with a labelled legend (identity never colour-alone). */
export function StackedBar({ title, segments }: { title: string; segments: Array<{ label: string; value: number; color: string; textured?: boolean }> }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <figure aria-label={title}>
      <div className="flex h-6 w-full gap-[2px] overflow-visible">
        {segments
          .filter((s) => s.value > 0)
          .map((s, i, arr) => (
            <motion.div
              key={s.label}
              className={cx('relative h-full', i === 0 && 'rounded-l-[4px]', i === arr.length - 1 && 'rounded-r-[4px]')}
              style={{ background: s.textured ? `${hatch}, ${s.color}` : s.color, opacity: hover === null || hover === i ? 1 : 0.5 }}
              initial={{ width: 0 }}
              animate={{ width: `${(s.value / total) * 100}%` }}
              transition={{ duration: 0.8, ease: EASE }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              {hover === i && (
                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-xs text-milk">
                  {s.label} · {s.value} ({Math.round((s.value / total) * 100)}%)
                </div>
              )}
            </motion.div>
          ))}
      </div>
      <figcaption className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
        {segments.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-2 text-sm text-ink-2">
            <span className="size-2.5 rounded-[3px]" style={{ background: s.textured ? `${hatch}, ${s.color}` : s.color }} />
            {s.label}
            <span className="font-medium text-ink">{s.value}</span>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

/** Inline magnitude bar for tables (single hue). */
export function InlineBar({ value, max, label }: { value: number | null; max: number; label: string }) {
  const pct = value === null || max <= 0 ? 0 : Math.max(4, (value / max) * 100);
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 flex-1 rounded-r-[4px] bg-transparent">
        <motion.div className="h-full rounded-r-[4px] bg-ink" initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.8, ease: EASE }} />
      </div>
      <span className="w-14 shrink-0 text-right text-sm tabular-nums text-ink-2">{label}</span>
    </div>
  );
}
