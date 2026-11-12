import type { StandupBrief } from '@delegate/shared';
import { Copy, Printer } from 'lucide-react';
import { useToast } from '../components/Toast';
import { Button, Card, Spinner } from '../components/ui';
import { PageHeader } from './AppShell';
import { useStandup } from './data';

type Row = StandupBrief['newToday'][number] & { waitingOn?: string | null };

function Block({ title, tone, rows, empty, render }: { title: string; tone: string; rows: Row[]; empty: string; render?: (r: Row) => React.ReactNode }) {
  return (
    <section className="break-inside-avoid">
      <h2 className="flex items-center gap-2 text-sm font-medium">
        <span className={`size-2 rounded-full ${tone}`} />
        {title}
        <span className="text-faint">{rows.length}</span>
      </h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-faint">{empty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {rows.map((r) => (
            <li key={r.task.id} className="py-2.5 text-[14.5px]">
              <span className="font-medium">{r.task.title}</span> <span className="text-mute">— {r.assignee}</span>
              {render?.(r)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function StandupPage({ embedded = false }: { embedded?: boolean }) {
  const { data, isLoading } = useStandup();
  const toast = useToast();

  const copy = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.text);
      toast.success('Standup copied — paste it anywhere');
    } catch {
      toast.error('Copy is blocked in this browser');
    }
  };

  return (
    <div>
      <div className="no-print">
        <PageHeader
          title={embedded ? '' : 'Standup-in-a-Box'}
          subtitle={embedded ? 'Compiled from the ledger. Sent every morning to Slack/Teams, WhatsApp and email when connected.' : 'Compiled automatically from the ledger. Emailed to managers at 8:00 AM when email is configured.'}
          actions={
            <>
              <Button variant="outline" onClick={copy} disabled={!data}>
                <Copy className="size-4" /> Copy text
              </Button>
              <Button variant="ghost" onClick={() => window.print()} disabled={!data}>
                <Printer className="size-4" /> Print
              </Button>
            </>
          }
        />
      </div>
      <div className="px-4 pb-12 sm:px-8">
        {isLoading || !data ? (
          <Spinner />
        ) : (
          <Card className="mx-auto max-w-3xl p-6 sm:p-10" data-testid="standup-brief">
            <p className="text-xs uppercase tracking-[0.16em] text-faint">{data.brief.orgName}</p>
            <h2 className="mt-2 text-[2rem] font-medium leading-none tracking-display">Standup · {data.brief.date}</h2>
            <p className="mt-2 text-sm text-mute">
              {data.brief.completedYesterday.length} shipped yesterday · {data.brief.newToday.length} new today · {data.brief.blockers.length} blocked · {data.brief.awaitingAudit.length} awaiting audit
            </p>
            <div className="mt-8 space-y-8">
              <Block title="Shipped yesterday" tone="bg-s-done" rows={data.brief.completedYesterday} empty="Nothing shipped yesterday." />
              <Block title="New today" tone="bg-s-open" rows={data.brief.newToday} empty="No tickets assigned yet today." />
              <Block
                title="Blockers"
                tone="bg-s-active"
                rows={data.brief.blockers}
                empty="No blockers. Clear runway."
                render={(r) => (
                  <p className="mt-0.5 text-sm text-[#6b4700]">
                    {r.waitingOn ? `Waiting on ${r.waitingOn}: ` : ''}
                    {r.task.blockedReason}
                  </p>
                )}
              />
              <Block title="Overdue" tone="bg-s-open" rows={data.brief.overdue} empty="Nothing overdue." />
              <Block title="Awaiting your audit" tone="bg-s-approved" rows={data.brief.awaitingAudit} empty="Inbox zero on audits." />
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
