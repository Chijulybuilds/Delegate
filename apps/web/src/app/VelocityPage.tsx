import { useState } from 'react';
import { ColumnChart, InlineBar, StatTile } from '../components/charts';
import { Avatar, Card, cx, Segmented, Spinner } from '../components/ui';
import { hours, pct } from '../lib/format';
import { PageHeader } from './AppShell';
import { useVelocity } from './data';

export default function VelocityPage({ embedded = false }: { embedded?: boolean }) {
  const [days, setDays] = useState<'7' | '14' | '30'>('14');
  const { data, isLoading } = useVelocity(Number(days));

  const maxHours = Math.max(1, ...(data?.rows.map((r) => r.avgHoursToGreen ?? 0) ?? [1]));

  return (
    <div>
      {embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-4 sm:px-8">
          <p className="text-sm text-mute">Time-to-impact: how fast work moves from red (assigned) to green (executed with proof).</p>
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
        subtitle="Time-to-impact: how fast work moves from red (assigned) to green (executed with proof)."
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
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatTile label="Executed" value={data.team.completed} hint={`last ${data.windowDays} days`} testId="kpi-completed" />
            <StatTile label="Avg. red → green" value={hours(data.team.avgHoursToGreen)} hint="assignment to proof" />
            <StatTile label="On time" value={pct(data.team.onTimeRate)} hint="submitted before due" />
            <StatTile label="Blocked now" value={data.team.blockedNow} hint="waiting on someone" />
            <StatTile label="Awaiting audit" value={data.team.awaitingAudit} hint="green, not yet blue" />
          </div>

          <Card className="p-5 sm:p-6">
            <h2 className="text-[15px] font-medium">Tasks executed per day</h2>
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
            <div className="flex items-end justify-between px-5 pb-3 pt-5 sm:px-6">
              <div>
                <h2 className="text-[15px] font-medium">Operator leaderboard</h2>
                <p className="text-xs text-faint">Fastest average time to green first</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm" data-testid="velocity-table">
                <thead>
                  <tr className="border-y border-line text-left text-xs text-faint">
                    <th className="px-5 py-2.5 font-normal sm:px-6">#</th>
                    <th className="py-2.5 font-normal">Operator</th>
                    <th className="w-[34%] py-2.5 font-normal">Avg. red → green</th>
                    <th className="py-2.5 text-right font-normal">Executed</th>
                    <th className="py-2.5 text-right font-normal">On time</th>
                    <th className="px-5 py-2.5 text-right font-normal sm:px-6">Open now</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r, i) => (
                    <tr key={r.userId} className="border-b border-line last:border-0">
                      <td className={cx('px-5 py-3 tabular-nums sm:px-6', i < 3 && r.completed > 0 ? 'font-semibold' : 'text-faint')}>{i + 1}</td>
                      <td className="py-3">
                        <span className="flex items-center gap-2.5">
                          <Avatar name={r.fullName} src={r.avatarUrl} size={26} />
                          <span className="font-medium">{r.fullName}</span>
                        </span>
                      </td>
                      <td className="py-3 pr-6">
                        <InlineBar value={r.avgHoursToGreen} max={maxHours} label={hours(r.avgHoursToGreen)} />
                      </td>
                      <td className="py-3 text-right tabular-nums">{r.completed}</td>
                      <td className="py-3 text-right tabular-nums">{pct(r.onTimeRate)}</td>
                      <td className="px-5 py-3 text-right tabular-nums sm:px-6">
                        {r.openNow}
                        {r.blockedNow > 0 && <span className="ml-1.5 rounded-full bg-s-active-soft px-1.5 py-0.5 text-[11px] text-[#8A5A00]">{r.blockedNow} blocked</span>}
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
