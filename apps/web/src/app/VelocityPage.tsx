import { SIZE_META, TASK_SIZES, type TaskSize, type VelocityRow } from '@delegate/shared';
import { ChevronDown, Layers, Scale, Sparkles } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { ColumnChart, InlineBar, StatTile } from '../components/charts';
import { DayPicker } from '../components/DayPicker';
import { useToast } from '../components/Toast';
import { Avatar, Button, Card, cx, EASE, Segmented, Select, Spinner } from '../components/ui';
import { useAuth } from '../lib/auth';
import { pct } from '../lib/format';
import { PageHeader } from './AppShell';
import { useSizeTasks, useVelocity, useWorkspace } from './data';
import { sizeOptions } from './options';

/**
 * Insights (owner only: they compare teammates). The leaderboard ranks by impact: work delivered,
 * weighted by how complex it is. Pick a date from the calendar (or click a bar) to see that day's
 * numbers and leaderboard; pick a size to compare people on that kind of work only.
 */

/** "≈ 18 h": typical hours of work for the sizes delivered. */
const work = (h: number) => (h <= 0 ? '—' : `≈ ${h < 10 ? String(Math.round(h * 10) / 10) : Math.round(h)} h`);
/** Lighter for quick work, darker for complex work. */
const SIZE_SHADE: Record<TaskSize, string> = { xs: 'bg-ink/15', s: 'bg-ink/30', m: 'bg-ink/50', l: 'bg-ink/75', xl: 'bg-ink' };
const WINDOWS = ['7', '14', '30'] as const;

export default function VelocityPage({ embedded = false }: { embedded?: boolean }) {
  const ws = useWorkspace().data;
  const { config } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const days = (WINDOWS as readonly string[]).includes(params.get('days') ?? '') ? (params.get('days') as (typeof WINDOWS)[number]) : '14';
  const day = /^\d{4}-\d{2}-\d{2}$/.test(params.get('day') ?? '') ? params.get('day') : null;
  const size = (TASK_SIZES as readonly string[]).includes(params.get('size') ?? '') ? (params.get('size') as TaskSize) : null;
  const isOwner = ws?.me.role === 'owner';
  const { data, isLoading, isPlaceholderData, error } = useVelocity(Number(days), { day, size, enabled: isOwner });
  const sizeTasks = useSizeTasks();
  const [how, setHow] = useState(false);

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  const dates = data?.daily.map((d) => d.date) ?? [];
  const today = dates[dates.length - 1];
  const marked = useMemo(() => new Set(data?.activeDays ?? []), [data?.activeDays]);
  const dayLabel = (key: string) => {
    const label = new Date(`${key}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    return key === today ? `Today · ${label}` : key === dates[dates.length - 2] ? `Yesterday · ${label}` : label;
  };

  if (ws && !isOwner) return <Navigate to="/app" replace />;

  const windowPicker = <Segmented value={days} onChange={(v) => set({ days: v, day: null })} options={WINDOWS.map((w) => ({ value: w, label: `${w} days` }))} />;
  const intro = 'Who delivers the most: work weighted by how complex it is, on time and right the first time. Only you see this.';

  return (
    <div>
      {embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-4 sm:px-8">
          <p className="text-sm text-mute">{intro}</p>
          {windowPicker}
        </div>
      ) : (
        <PageHeader title="Velocity Pulse" subtitle={intro} actions={windowPicker} />
      )}

      {/* Which day (a calendar, or click a bar below) and which kind of work */}
      <div className="flex flex-wrap items-center gap-2 px-4 pb-4 sm:px-8">
        <DayPicker value={day} onChange={(d) => set({ day: d })} minDay={data?.firstDay} maxDay={today} marked={marked} emptyLabel={`All ${days} days`} data-testid="insights-day" />
        <Select
          size="sm"
          value={size ?? 'all'}
          onChange={(v) => set({ size: v === 'all' ? null : v })}
          options={[{ value: 'all', label: 'Every size of task', icon: <Layers className="size-4 text-mute" /> }, ...sizeOptions.map((o) => ({ ...o, label: `${o.label} tasks only` }))]}
          aria-label="Complexity"
          data-testid="insights-size"
        />
        {(isPlaceholderData || (isLoading && !!data)) && <Spinner className="size-4" />}
      </div>

      {error ? (
        <p className="px-8 text-sm text-mute">{error instanceof Error ? error.message : 'Insights could not be loaded.'}</p>
      ) : isLoading || !data || !ws ? (
        <div className="px-8">
          <Spinner />
        </div>
      ) : (
        <div className={cx('space-y-4 px-4 pb-12 transition-opacity sm:px-8', isPlaceholderData && 'opacity-60')}>
          {ws.features?.taskSize === false && (
            <p className="rounded-2xl border border-s-active/40 bg-s-active-soft px-4 py-3 text-sm text-s-active-ink" data-testid="size-migration-note">
              Task sizes aren’t being saved yet, so sizes are estimated from each task’s words. In Supabase → SQL Editor, run <span className="font-mono text-xs">supabase/migrations/20261122000000_task_size.sql</span>.
            </p>
          )}
          {ws.features?.taskSize !== false && data.estimated > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-paper px-4 py-3 text-sm" data-testid="estimated-note">
              <Sparkles className="size-4 shrink-0 text-mute" />
              <span className="min-w-0 flex-1 text-ink-2">
                {data.estimated} of these task{data.estimated === 1 ? ' has' : 's have'} no size, so Delegate estimated {data.estimated === 1 ? 'it' : 'them'} from the title. Save sizes for every older task so you can check and change them.
              </span>
              <Button
                size="sm"
                variant="outline"
                loading={sizeTasks.isPending}
                onClick={async () => {
                  try {
                    const r = await sizeTasks.mutateAsync();
                    toast.success(`Sized ${r.sized} task${r.sized === 1 ? '' : 's'}${r.method === 'ai' ? ' with AI' : ''}. Change any of them in the task panel.`);
                  } catch (e) {
                    toast.error(e);
                  }
                }}
                data-testid="size-tasks"
              >
                <Sparkles className="size-3.5" /> {config?.aiVerification ? 'Size them with AI' : 'Size them now'}
              </Button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile label="Executed" value={data.team.completed} hint={day ? dayLabel(day) : `last ${data.windowDays} days`} testId="kpi-completed" />
            <StatTile label="Work done" value={work(data.team.workHours)} hint="typical hours, by task size" testId="kpi-work" />
            <StatTile label="On time" value={pct(data.team.onTimeRate)} hint="by deadline, or fair for its size" />
            <StatTile label="Right first time" value={pct(data.team.firstTimeRate)} hint="approved without changes" />
            <StatTile label="Blocked now" value={data.team.blockedNow} hint="waiting on someone" />
            <StatTile label="Awaiting audit" value={data.team.awaitingAudit} hint="green, not yet blue" />
          </div>

          <Card className="p-5 sm:p-6">
            <h2 className="text-[0.9375rem] font-medium">Tasks executed per day</h2>
            <p className="text-xs text-faint">Click a day, or pick any date above, to see that day’s numbers and leaderboard</p>
            <div className="mt-6">
              <ColumnChart
                title="Tasks executed per day"
                unit="executed"
                selected={day && dates.includes(day) ? dates.indexOf(day) : null}
                onSelect={(i) => set({ day: i === null ? null : dates[i]! })}
                data={data.daily.map((d) => {
                  const date = new Date(`${d.date}T12:00:00Z`);
                  return {
                    label: date.toLocaleDateString('en-GB', { day: 'numeric', timeZone: 'UTC' }),
                    tooltipLabel: `${date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })} · ${work(d.workHours)}`,
                    value: d.completed,
                  };
                })}
              />
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-end justify-between gap-3 px-5 pb-3 pt-5 sm:px-6">
              <div>
                <h2 className="text-[0.9375rem] font-medium">Team leaderboard</h2>
                <p className="text-xs text-faint" data-testid="leaderboard-scope">
                  Most impact first: work delivered, weighted by how complex it is
                  {day ? ` · ${dayLabel(day)}` : ` · last ${days} days`}
                  {size ? ` · ${SIZE_META[size].label} tasks only` : ''}
                </p>
              </div>
              <button onClick={() => setHow((v) => !v)} aria-expanded={how} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-mute transition-colors hover:bg-ink/[0.05] hover:text-ink" data-testid="how-scored">
                <Scale className="size-3.5" /> How it’s scored <ChevronDown className={cx('size-3.5 transition-transform', how && 'rotate-180')} />
              </button>
            </div>
            <AnimatePresence initial={false}>
              {how && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden">
                  <ul className="mx-5 mb-4 space-y-1.5 rounded-2xl bg-milk-2/70 px-4 py-3.5 text-[0.8125rem] leading-relaxed text-ink-2 sm:mx-6" data-testid="how-scored-text">
                    <li>
                      <span className="font-medium text-ink">Complexity counts.</span> Each task is worth the typical hours of work for its size: Quick 15 min, Small 1 h, Medium 3 h, Large 6 h, Huge 16 h. Five video edits outweigh twenty-five phone calls.
                    </li>
                    <li>
                      <span className="font-medium text-ink">On time keeps full credit.</span> Work delivered late (past its deadline, or past a fair time for its size when there was none) earns 75%; work the audit sent back earns 85%.
                    </li>
                    <li>
                      <span className="font-medium text-ink">A fair clock.</span> It starts when the task became theirs (reassigned work starts fresh), and time blocked waiting on someone else doesn’t count.
                    </li>
                    <li>
                      <span className="font-medium text-ink">Impact score.</span> 100 is whoever delivered the most in this view; everyone else is compared with them.
                    </li>
                    <li>
                      <span className="font-medium text-ink">No size set?</span> Delegate estimates it from the task’s words (or with AI), and you can change it in the task panel.
                    </li>
                  </ul>
                </motion.div>
              )}
            </AnimatePresence>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm" data-testid="velocity-table">
                <thead>
                  <tr className="border-y border-line text-left text-xs text-faint">
                    <th className="px-5 py-2.5 font-normal sm:px-6">#</th>
                    <th className="py-2.5 font-normal">Person</th>
                    <th className="w-[22%] py-2.5 font-normal">Impact</th>
                    <th className="py-2.5 text-right font-normal">Work done</th>
                    <th className="py-2.5 pl-6 font-normal">Complexity</th>
                    <th className="py-2.5 text-right font-normal">On time</th>
                    <th className="py-2.5 text-right font-normal">Right first time</th>
                    <th className="px-5 py-2.5 text-right font-normal sm:px-6">Open now</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r, i) => (
                    <tr key={r.userId} className="border-b border-line last:border-0" data-testid="leaderboard-row" data-user={r.userId}>
                      <td className={cx('px-5 py-3 tabular-nums sm:px-6', i < 3 && r.impactScore !== null ? 'font-semibold' : 'text-faint')}>{r.impactScore === null ? '—' : i + 1}</td>
                      <td className="py-3">
                        <span className="flex items-center gap-2.5">
                          <Avatar name={r.fullName} src={r.avatarUrl} size={26} />
                          <span className="font-medium">{r.fullName}</span>
                        </span>
                      </td>
                      <td className="py-3 pr-6">
                        {r.impactScore === null ? <span className="text-xs text-faint">Nothing executed{day ? ' this day' : ' yet'}</span> : <InlineBar value={r.impactScore} max={100} label={String(r.impactScore)} />}
                      </td>
                      <td className="py-3 text-right tabular-nums">
                        <span className="block">{work(r.workHours)}</span>
                        <span className="block text-[0.6875rem] text-faint">
                          {r.completed} task{r.completed === 1 ? '' : 's'}
                        </span>
                      </td>
                      <td className="py-3 pl-6">
                        <SizeMix row={r} />
                      </td>
                      <td className="py-3 text-right tabular-nums">{pct(r.onTimeRate)}</td>
                      <td className="py-3 text-right tabular-nums">{pct(r.firstTimeRate)}</td>
                      <td className="px-5 py-3 text-right tabular-nums sm:px-6">
                        {r.openNow}
                        {r.blockedNow > 0 && <span className="ml-1.5 rounded-full bg-s-active-soft px-1.5 py-0.5 text-[0.6875rem] text-s-active-ink">{r.blockedNow} blocked</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

        </div>
      )}
    </div>
  );
}

/** A small bar of the sizes someone delivered: lighter for quick work, darker for complex work. */
function SizeMix({ row }: { row: VelocityRow }) {
  if (!row.completed) return <span className="text-xs text-faint">—</span>;
  const parts = TASK_SIZES.filter((z) => row.sizeMix[z] > 0);
  const top = [...parts].sort((a, b) => row.sizeMix[b] - row.sizeMix[a])[0]!;
  const biggest = parts[parts.length - 1]!;
  // "mostly Large" only when one size is more than half; otherwise say how big it got.
  const label = parts.length === 1 ? `all ${SIZE_META[top].label}` : row.sizeMix[top] * 2 > row.completed ? `mostly ${SIZE_META[top].label}` : `mixed, up to ${SIZE_META[biggest].label}`;
  const title = parts.map((z) => `${row.sizeMix[z]} ${SIZE_META[z].label}`).join(' · ');
  return (
    <span className="block w-28" title={title} data-testid="size-mix">
      <span className="flex h-2 w-full gap-px overflow-hidden rounded-full bg-milk-2">
        {parts.map((z) => (
          <span key={z} className={SIZE_SHADE[z]} style={{ width: `${(row.sizeMix[z] / row.completed) * 100}%` }} />
        ))}
      </span>
      <span className="mt-1 block text-[0.6875rem] text-faint">{label}</span>
    </span>
  );
}
