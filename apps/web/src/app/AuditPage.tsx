import { taskRef, type Task } from '@delegate/shared';
import { ClipboardCheck } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { Avatar, EmptyState, Spinner } from '../components/ui';
import { clock } from '../lib/format';
import { PageHeader } from './AppShell';
import { memberName, useAllAudits, useWorkspace } from './data';

export default function AuditPage() {
  const ws = useWorkspace();
  const audits = useAllAudits();
  const [, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const tasks = (audits.data?.tasks ?? []).filter((t) => `${t.title} ${taskRef(t.seq)}`.toLowerCase().includes(query.toLowerCase()));
  return <div>
    <PageHeader title="All-time audit" subtitle="Every task approved in this workspace, newest audit first." actions={<label className="sr-only" htmlFor="audit-search">Search audits</label>} />
    <div className="max-w-4xl px-4 pb-12 sm:px-8">
      <input id="audit-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search audited tasks" className="mb-4 h-10 w-full rounded-xl border border-line bg-paper px-3 text-sm outline-none focus:border-line-2 sm:max-w-sm" />
      {audits.isLoading || !ws.data ? <Spinner /> : tasks.length === 0 ? <EmptyState title={query ? 'No matching audits' : 'No audits yet'} body={query ? 'Try another task title or reference.' : 'Approved tasks will be collected here as they are audited.'} /> :
        <ul className="overflow-hidden rounded-2xl border border-line bg-paper">
          {tasks.map((task) => <AuditRow key={task.id} task={task} ws={ws.data} onOpen={() => setParams({ task: task.id })} />)}
        </ul>}
    </div>
  </div>;
}

function AuditRow({ task, ws, onOpen }: { task: Task; ws: NonNullable<ReturnType<typeof useWorkspace>['data']>; onOpen: () => void }) {
  return <li className="border-b border-line last:border-0"><button onClick={onOpen} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-milk">
    <ClipboardCheck className="size-4 shrink-0 text-s-approved" />
    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{task.title}</span><span className="mt-0.5 block text-xs text-mute">{taskRef(task.seq)} · Assigned to {memberName(ws.members, task.assigneeId)}</span></span>
    <Avatar name={memberName(ws.members, task.assigneeId)} size={26} />
    <span className="shrink-0 text-xs text-mute">{clock(task.approvedAt ?? task.updatedAt)}</span>
  </button></li>;
}
