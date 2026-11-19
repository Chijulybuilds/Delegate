import { taskRef, type AuditRow } from '@delegate/shared';
import { ChevronLeft, ChevronRight, Download, ShieldCheck } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { dayKey } from '../components/DateRangePicker';
import { useToast } from '../components/Toast';
import { Avatar, Button, cx, EASE, EmptyState, PriorityTag, Spinner } from '../components/ui';
import { request } from '../lib/api';
import { PageHeader } from './AppShell';
import { auditsExportPath, useAudits, useWorkspace } from './data';
import { FilterBar, isFiltered, toApiFilters, useFilterParams } from './TaskFilters';
import { TaskDrawer } from './TaskDrawer';

/**
 * Audits (owner only): every task ever audited in the workspace, newest audit first. Search by
 * title, DLG number or name; filter by person, priority and when it was audited; download the
 * result as a spreadsheet.
 */
export default function AuditsPage() {
  const ws = useWorkspace();
  const isOwner = ws.data?.me.role === 'owner';
  const { state, page, set } = useFilterParams();
  const [params, setParams] = useSearchParams();
  const filters = toApiFilters(state, false);
  const audits = useAudits(filters, page, isOwner);
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);
  const openTaskId = params.get('task');
  const openTask = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('task', id);
    else next.delete('task');
    setParams(next, { replace: !id });
  };

  if (!ws.data) return <Spinner className="m-8" />;
  if (!isOwner) return <Navigate to="/app" replace />;
  const data = audits.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const timed = (data?.rows ?? []).map((r) => r.hoursToGreen).filter((h): h is number => h !== null);
  const avg = timed.length ? timed.reduce((a, b) => a + b, 0) / timed.length : null;

  const download = async () => {
    setDownloading(true);
    try {
      const blob = await request<Blob>(auditsExportPath(filters));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `delegate-audits-${dayKey(new Date())}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      toast.error(e);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Audits"
        subtitle="Every audited task, all time. Only you, the owner, can see this page."
        actions={
          <Button variant="outline" onClick={download} loading={downloading} disabled={!data?.total} data-testid="audits-download">
            <Download className="size-4" /> Download CSV
          </Button>
        }
      />
      <div className="z-20 border-b border-[var(--edge)] bg-milk/90 px-4 py-3 backdrop-blur-xl sm:px-8 lg:sticky lg:top-0 lg:bg-panel/85">
        <FilterBar value={state} onChange={set} ws={ws.data} show={{ person: true, status: false }} testId="audit-filters" />
      </div>

      <div className="px-4 pb-14 pt-5 sm:px-8">
        <div className="mb-4 grid grid-cols-2 gap-2 sm:max-w-md">
          <Stat label={isFiltered(state) ? 'Audited (matching)' : 'Audited, all time'} value={data ? String(data.total) : '—'} testId="audits-total" />
          <Stat label="Avg. time to green (this page)" value={avg === null ? '—' : avg < 24 ? `${avg.toFixed(1)} h` : `${(avg / 24).toFixed(1)} d`} />
        </div>

        {audits.isLoading ? (
          <Spinner />
        ) : !data || data.total === 0 ? (
          <EmptyState
            title={isFiltered(state) ? 'No audits match these filters' : 'No audits yet'}
            body={isFiltered(state) ? 'Try a wider date range or clear a filter.' : 'When you approve a task, it’s sealed here for good.'}
          />
        ) : (
          <>
            {/* Desktop: a table */}
            <div className={cx('hidden overflow-hidden rounded-2xl border border-line bg-paper shadow-[var(--shadow-card)] transition-opacity md:block', audits.isPlaceholderData && 'opacity-60')}>
              <table className="w-full text-left text-sm" data-testid="audits-table">
                <thead className="border-b border-line bg-milk/60 text-xs text-mute">
                  <tr>
                    <th className="px-4 py-3 font-medium">Task</th>
                    <th className="px-4 py-3 font-medium">Done by</th>
                    <th className="px-4 py-3 font-medium">Priority</th>
                    <th className="px-4 py-3 font-medium">Audited</th>
                    <th className="px-4 py-3 font-medium">Audited by</th>
                    <th className="px-4 py-3 text-right font-medium">Time to green</th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence initial={false}>
                    {data.rows.map((r, i) => (
                      <motion.tr
                        key={r.task.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.3, ease: EASE, delay: Math.min(i, 12) * 0.02 }}
                        onClick={() => openTask(r.task.id)}
                        className="cursor-pointer border-b border-line last:border-0 hover:bg-milk/70"
                        data-testid="audit-row"
                        data-task-title={r.task.title}
                      >
                        <td className="max-w-[340px] px-4 py-3">
                          <span className="font-mono text-[0.6875rem] text-faint">{taskRef(r.task.seq)}</span>
                          <p className="truncate font-medium">{r.task.title}</p>
                          {r.departmentName && <p className="text-xs text-faint">{r.departmentName}</p>}
                        </td>
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-2">
                            <Avatar name={r.assigneeName} size={24} />
                            <span className="truncate">{r.assigneeName}</span>
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <PriorityTag priority={r.task.priority} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-ink-2">{when(r)}</td>
                        <td className="px-4 py-3 text-ink-2">{r.auditorName ?? '—'}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-ink-2">{hours(r.hoursToGreen)}</td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>

            {/* Phones: cards */}
            <ol className="space-y-2 md:hidden">
              {data.rows.map((r) => (
                <li key={r.task.id}>
                  <button onClick={() => openTask(r.task.id)} className="w-full rounded-2xl border border-line bg-paper p-3.5 text-left shadow-[var(--shadow-card)]" data-testid="audit-card">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="size-3.5 text-s-approved-ink" />
                      <span className="font-mono text-[0.6875rem] text-faint">{taskRef(r.task.seq)}</span>
                      <PriorityTag priority={r.task.priority} />
                      <span className="ml-auto text-[0.6875rem] text-faint">{when(r)}</span>
                    </div>
                    <p className="mt-1.5 font-medium">{r.task.title}</p>
                    <p className="mt-1 text-xs text-mute">
                      {r.assigneeName} · audited by {r.auditorName ?? '—'} · {hours(r.hoursToGreen)}
                    </p>
                  </button>
                </li>
              ))}
            </ol>

            {pages > 1 && (
              <div className="flex items-center justify-center gap-2 pt-5">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => set({ page: page - 1 })}>
                  <ChevronLeft className="size-4" /> Newer
                </Button>
                <span className="px-2 text-sm text-mute">
                  Page {page} of {pages}
                </span>
                <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => set({ page: page + 1 })}>
                  Older <ChevronRight className="size-4" />
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <TaskDrawer taskId={openTaskId} intent={null} onClose={() => openTask(null)} ws={ws.data} />
    </div>
  );
}

function Stat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-paper px-4 py-3 shadow-[var(--shadow-card)]">
      <p className="text-xs text-mute">{label}</p>
      <p className={cx('mt-1 text-2xl font-medium tracking-display')} data-testid={testId}>
        {value}
      </p>
    </div>
  );
}

const when = (r: AuditRow) => {
  const at = r.task.approvedAt ?? r.task.updatedAt;
  return new Date(at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: new Date(at).getFullYear() === new Date().getFullYear() ? undefined : 'numeric', hour: '2-digit', minute: '2-digit' });
};
const hours = (h: number | null) => (h === null ? '—' : h < 24 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} d`);
