import { ChevronDown, Scale } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { ColumnChart, InlineBar, StatTile } from '../components/charts';
import { Avatar, Card, cx, EASE, Segmented, Spinner } from '../components/ui';
import { pct } from '../lib/format';
import { PageHeader } from './AppShell';
import { useVelocity, useWorkspace } from './data';

/** "≈ 18 h": typical hours of work for the sizes delivered. */
const work = (h: number) => (h <= 0 ? '—' : `≈ ${h < 10 ? String(Math.round(h * 10) / 10) : Math.round(h)} h`);
/** Below this many executed tasks a score is still settling (it starts near the team's). */
const SETTLED = 3;

export default function VelocityPage({ embedded = false }: { embedded?: boolean }) {
  const [days, setDays] = useState<'7' | '14' | '30'>('14');
  const { data, isLoading } = useVelocity(Number(days));
  const ws = useWorkspace().data;
  const [how, setHow] = useState(false);

  return (
    <div>
      {embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-4 sm:px-8">
          <p className="text-sm text-mute">How the team delivers: on time against each task’s own deadline and size, and right the first time.</p>
          <Segmented
            value={days}
            onChange={setDays}
            options={[
              { value: '7', label: '7 days' },
              { value: '14', label: '14 days' },
              { value: '30', label: '30 days' },
            ]}
          />
        </div>
      ) : (
      <PageHeader
        title="Velocity Pulse"
        subtitle="How the team delivers: on time against each task’s own deadline and size, and right the first time."
        actions={
          <Segmented
            value={days}
            onChange={setDays}
            options={[
              { value: '7', label: '7 days' },
              { value: '14', label: '14 days' },
              { value: '30', label: '30 days' },
            ]}
          />
        }
      />
      )}
      {isLoading || !data ? (
        <div className="px-8">
          <Spinner />
        </div>
      ) : (
        <div className="space-y-4 px-4 pb-12 sm:px-8">
          {ws?.me.role === 'owner' && ws.features?.taskSize === false && (
            <p className="rounded-2xl border border-s-active/40 bg-s-active-soft px-4 py-3 text-sm text-s-active-ink" data-testid="size-migration-note">
              Task sizes aren’t being saved yet, so every task counts as Medium. In Supabase → SQL Editor, run <span className="font-mono text-xs">supabase/migrations/20261122000000_task_size.sql</span>.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile label="Executed" value={data.team.completed} hint={`last ${data.windowDays} days`} testId="kpi-completed" />
            <StatTile label="Work done" value={work(data.team.workHours)} hint="typical hours, by task size" testId="kpi-work" />
            <StatTile label="On time" value={pct(data.team.onTimeRate)} hint="by deadline, or fair for its size" />
            <StatTile label="Right first time" value={pct(data.team.firstTimeRate)} hint="approved without changes" />
            <StatTile label="Blocked now" value={data.team.blockedNow} hint="waiting on someone" />
            <StatTile label="Awaiting audit" value={data.team.awaitingAudit} hint="green, not yet blue" />
          </div>

          <Card className="p-5 sm:p-6">
            <h2 className="text-[0.9375rem] font-medium">Tasks executed per day</h2>
            <p className="text-xs text-faint">Submitted with proof, by day</p>
            <div className="mt-6">
              <ColumnChart
                title="Tasks executed per day"
                unit="executed"
                data={data.daily.map((d) => {
                  const date = new Date(`${d.date}T00:00:00Z`);
                  return {
                    label: date.toLocaleDateString('en-GB', { day: 'numeric', timeZone: 'UTC' }),
                    tooltipLabel: date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }),
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
                <p className="text-xs text-faint">Fair score first: everyone judged against their own tasks’ deadlines and sizes</p>
              </div>
              <button onClick={() => setHow((v) => !v)} aria-expanded={how} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-mute transition-colors hover:bg-ink/[0.05] hover:text-ink" data-testid="how-scored">
                <Scale className="size-3.5" /> How it’s scored <ChevronDown className={cx('size-3.5 transition-transform', how && 'rotate-180')} />
              </button>
            </div>
            <AnimatePresence initial={false}>
              {how && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden">
                  <ul className="mx-5 mb-4 space-y-1.5 rounded-2xl bg-milk-2/70 px-4 py-3.5 text-[0.8125rem] leading-relaxed text-ink-2 sm:mx-6" data-testid="how-scored-text">
                    <li><span className="font-medium text-ink">On time (70%).</span> Each task is judged against its own deadline. Without one, against a fair time for its size: a Quick call isn’t measured like a Large video edit.</li>
                    <li><span className="font-medium text-ink">Right first time (30%).</span> Approved at the audit without changes requested.</li>
                    <li><span className="font-medium text-ink">Fair clock.</span> It starts when the task became theirs (reassigned work starts fresh), and time blocked waiting on someone else doesn’t count.</li>
                    <li><span className="font-medium text-ink">Volume isn’t ranked.</span> How much work someone gets depends on what they’re given, so “Work done” is shown but doesn’t change the order.</li>
                    <li><span className="font-medium text-ink">Few tasks, cautious score.</span> With fewer than {SETTLED} tasks, a score starts near the team’s, so one lucky task can’t top the board.</li>
                  </ul>
                </motion.div>
              )}
            </AnimatePresence>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm" data-testid="velocity-table">
                <thead>
                  <tr className="border-y border-line text-left text-xs text-faint">
                    <th className="px-5 py-2.5 font-normal sm:px-6">#</th>
                    <th className="py-2.5 font-normal">Person</th>
                    <th className="w-[28%] py-2.5 font-normal">Fair score</th>
                    <th className="py-2.5 text-right font-normal">Work done</th>
                    <th className="py-2.5 text-right font-normal">On time</th>
                    <th className="py-2.5 text-right font-normal">Right first time</th>
                    <th className="px-5 py-2.5 text-right font-normal sm:px-6">Open now</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r, i) => (
                    <tr key={r.userId} className="border-b border-line last:border-0" data-testid="leaderboard-row" data-user={r.userId}>
                      <td className={cx('px-5 py-3 tabular-nums sm:px-6', i < 3 && r.fairScore !== null ? 'font-semibold' : 'text-faint')}>{r.fairScore === null ? '—' : i + 1}</td>
                      <td className="py-3">
                        <span className="flex items-center gap-2.5">
                          <Avatar name={r.fullName} src={r.avatarUrl} size={26} />
                          <span className="font-medium">{r.fullName}</span>
                          {r.fairScore !== null && r.completed < SETTLED && (
                            <span className="rounded-full bg-milk-2 px-2 py-0.5 text-[0.6875rem] text-mute" title={`Based on ${r.completed} task${r.completed === 1 ? '' : 's'}: the score starts near the team’s until there are ${SETTLED}.`} data-testid="few-tasks">
                              few tasks
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="py-3 pr-6">
                        {r.fairScore === null ? (
                          <span className="text-xs text-faint">Nothing executed yet</span>
                        ) : (
                          <InlineBar value={r.fairScore} max={100} label={String(r.fairScore)} />
                        )}
                      </td>
                      <td className="py-3 text-right tabular-nums">
                        <span className="block">{work(r.workHours)}</span>
                        <span className="block text-[0.6875rem] text-faint">{r.completed} task{r.completed === 1 ? '' : 's'}</span>
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
