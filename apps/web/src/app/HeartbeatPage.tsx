import { isManagerRole, STATUS_META, type LedgerEvent } from '@delegate/shared';
import { Users } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Avatar, cx, EASE, EmptyState, Select, Spinner } from '../components/ui';
import { clock, timeAgo } from '../lib/format';
import { PageHeader } from './AppShell';
import { memberName, useFeed, useWorkspace } from './data';
import { memberOptions } from './options';
import { describeEvent } from './TaskDrawer';

const toneDot: Record<string, string> = { red: 'bg-s-open', amber: 'bg-s-active', green: 'bg-s-done', blue: 'bg-s-approved' };

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
}

export default function HeartbeatPage() {
  const ws = useWorkspace();
  const feed = useFeed(80);
  const [person, setPerson] = useState('all');

  const groups = useMemo(() => {
    const events = (feed.data?.events ?? []).filter((e) => person === 'all' || e.actorId === person);
    const out: Array<{ day: string; events: LedgerEvent[] }> = [];
    for (const e of events) {
      const day = dayLabel(e.createdAt);
      const last = out[out.length - 1];
      if (last?.day === day) last.events.push(e);
      else out.push({ day, events: [e] });
    }
    return out;
  }, [feed.data, person]);

  return (
    <div>
      <PageHeader
        title="Activity"
        subtitle={ws.data?.me.role === 'owner' ? 'Everything that happened — assignments, starts, blockers, proof and audits, live.' : 'What happened on your tasks — assignments, starts, blockers, proof and audits, live.'}
        actions={
          <>
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-paper px-3 py-1.5 text-xs text-mute">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-s-done opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-s-done" />
              </span>
              Live
            </span>
            {isManagerRole(ws.data?.me.role) && (
            <Select
              size="sm"
              align="end"
              value={person}
              onChange={setPerson}
              options={[{ value: 'all', label: 'Everyone', icon: <Users className="size-4 text-mute" /> }, ...memberOptions(ws.data?.members ?? [], { departments: ws.data?.departments })]}
              aria-label="Filter by person"
            />
            )}
          </>
        }
      />
      <div className="max-w-3xl px-4 pb-12 sm:px-8">
        {feed.isLoading || !ws.data ? (
          <Spinner />
        ) : groups.length === 0 ? (
          <EmptyState title="Quiet so far" body="Activity shows up here the moment anyone moves a ticket." />
        ) : (
          groups.map((g) => (
            <section key={g.day} className="mb-8">
              <h2 className="sticky top-14 z-10 -mx-1 mb-3 bg-milk/90 px-1 py-1 text-xs font-medium uppercase tracking-[0.14em] text-faint backdrop-blur lg:top-0">{g.day}</h2>
              <ol className="relative space-y-2" data-testid="heartbeat-list">
                <AnimatePresence initial={false}>
                  {g.events.map((e) => {
                    const tone = e.toStatus ? STATUS_META[e.toStatus].tone : null;
                    const blocked = e.type === 'task.blocked';
                    return (
                      <motion.li
                        key={e.id}
                        layout
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4, ease: EASE }}
                        className={cx('flex items-start gap-3 rounded-2xl border bg-paper px-4 py-3', blocked ? 'border-s-active/50' : 'border-line')}
                      >
                        <Avatar name={memberName(ws.data.members, e.actorId)} size={30} />
                        <div className="min-w-0 flex-1">
                          <p className="text-[0.9062rem] leading-snug">
                            {e.taskId ? (
                              <Link to={`/app?task=${e.taskId}`} className="hover:underline">
                                {describeEvent(e, ws.data, true)}
                              </Link>
                            ) : (
                              describeEvent(e, ws.data, true)
                            )}
                          </p>
                          {blocked && typeof e.meta.reason === 'string' && <p className="mt-1 text-sm text-s-active-ink">“{e.meta.reason}”</p>}
                          {e.type === 'task.changes_requested' && typeof e.meta.comment === 'string' && <p className="mt-1 text-sm text-mute">“{e.meta.comment}”</p>}
                          <p className="mt-1 text-xs text-faint">
                            {clock(e.createdAt)} · {timeAgo(e.createdAt)}
                          </p>
                        </div>
                        {tone && (
                          <span className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-mute">
                            <span className={cx('size-2 rounded-full', toneDot[tone])} />
                            {STATUS_META[e.toStatus!].label}
                          </span>
                        )}
                      </motion.li>
                    );
                  })}
                </AnimatePresence>
              </ol>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
