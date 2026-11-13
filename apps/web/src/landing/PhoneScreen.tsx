import { Activity, BarChart3, Check, ChevronLeft, FileText, LayoutGrid, Sparkles, Users } from 'lucide-react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * The Delegate app as it looks on a phone, drawn at a phone's logical size (380 x 828) and
 * scaled onto the photo's glass by PhotoPhone. It is a faithful miniature of the real product
 * (same statuses, colours and copy), animated to tell the landing page's story:
 *
 *   login  — the sign-in screen types an email, the button is tapped, the board loads
 *   task   — one ticket walks Open → In motion → Executed → Audited (driven by `step`)
 *   feed   — the live activity feed
 *   board  — today's board, quietly updating
 *   done   — everything audited
 */

export type PhoneScene = 'login' | 'task' | 'feed' | 'board' | 'done';
export const SCREEN_W = 380;
export const SCREEN_H = 828; // the photo's glass is 349.6 x 761.6 px: same aspect

const EASE = [0.22, 1, 0.36, 1] as const;
const C = {
  open: '#e5484d',
  active: '#e8a317',
  done: '#2f9e6a',
  approved: '#2b7fff',
};
/** rgba() version of a hex colour (motion animates between rgba strings reliably). */
const soft = (hex: string, a: number) => `rgba(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}, ${a})`;

/* ------------------------------------------------------------------------------ chrome */

function StatusBar() {
  return (
    <div className="absolute inset-x-0 top-0 z-20 flex h-[50px] items-center justify-between px-[28px] pt-[4px] text-[15px] font-semibold text-ink">
      <span className="w-[64px] tracking-[-0.01em]">9:41</span>
      {/* Dynamic Island */}
      <span className="absolute left-1/2 top-[11px] h-[32px] w-[108px] -translate-x-1/2 rounded-full bg-black" />
      <span className="flex w-[64px] items-center justify-end gap-[5px]">
        <svg width="18" height="12" viewBox="0 0 18 12" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <rect key={i} x={i * 4.6} y={9 - i * 3} width="3.2" height={3 + i * 3} rx="0.8" fill="currentColor" />
          ))}
        </svg>
        <svg width="16" height="12" viewBox="0 0 16 12" aria-hidden>
          <path d="M8 11.2 5.6 8.6a3.4 3.4 0 0 1 4.8 0L8 11.2Z" fill="currentColor" />
          <path d="M3.6 6.6a6.2 6.2 0 0 1 8.8 0l-1.3 1.3a4.4 4.4 0 0 0-6.2 0L3.6 6.6Z" fill="currentColor" />
          <path d="M1.4 4.4a9.3 9.3 0 0 1 13.2 0l-1.3 1.3a7.5 7.5 0 0 0-10.6 0L1.4 4.4Z" fill="currentColor" />
        </svg>
        <svg width="27" height="13" viewBox="0 0 27 13" aria-hidden>
          <rect x="0.5" y="0.5" width="23" height="12" rx="3.5" fill="none" stroke="currentColor" strokeOpacity="0.4" />
          <rect x="2" y="2" width="20" height="9" rx="2.2" fill="currentColor" />
          <path d="M25 4.5v4a2 2 0 0 0 0-4Z" fill="currentColor" fillOpacity="0.45" />
        </svg>
      </span>
    </div>
  );
}

function HomeIndicator() {
  return <span className="absolute bottom-[8px] left-1/2 z-20 h-[5px] w-[124px] -translate-x-1/2 rounded-full bg-ink" />;
}

function TabBar({ active }: { active: 'today' | 'activity' }) {
  const tabs = [
    { id: 'today', label: 'Today', icon: LayoutGrid },
    { id: 'activity', label: 'Activity', icon: Activity },
    { id: 'insights', label: 'Insights', icon: BarChart3 },
    { id: 'team', label: 'Team', icon: Users },
  ];
  return (
    <div className="absolute inset-x-0 bottom-0 z-10 flex h-[80px] justify-around border-t border-line bg-milk/95 px-[12px] pt-[10px] backdrop-blur">
      {tabs.map((t) => (
        <span key={t.id} className={`flex w-[72px] flex-col items-center gap-[3px] text-[11.5px] ${t.id === active ? 'text-ink' : 'text-faint'}`}>
          <t.icon size={24} strokeWidth={t.id === active ? 2.1 : 1.7} />
          {t.label}
        </span>
      ))}
    </div>
  );
}

function Mark({ size = 34, color = '#111' }: { size?: number; color?: string }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-full" style={{ width: size, height: size, background: color }}>
      <Check size={size * 0.56} strokeWidth={3} color="#fff" />
    </span>
  );
}

function Avatar({ initials, tone = '#e2e2de' }: { initials: string; tone?: string }) {
  return (
    <span className="grid size-[30px] shrink-0 place-items-center rounded-full text-[11.5px] font-semibold text-ink-2" style={{ background: tone }}>
      {initials}
    </span>
  );
}

const Pane = ({ children, k }: { children: ReactNode; k: string }) => (
  <motion.div key={k} className="absolute inset-0 bg-milk" initial={{ opacity: 0, x: 36 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -36 }} transition={{ duration: 0.5, ease: EASE }}>
    {children}
  </motion.div>
);

/* ------------------------------------------------------------------------------ login */

const EMAIL = 'ada@lumen.co';

function LoginView({ typed, phase }: { typed: number; phase: 'idle' | 'typing' | 'tap' | 'loading' }) {
  return (
    <div className="flex h-full flex-col px-[26px] pt-[96px]" data-testid="phone-login">
      <div className="flex items-center gap-[10px]">
        <Mark size={38} />
        <span className="text-[24px] font-semibold tracking-[-0.03em]">Delegate</span>
      </div>
      <p className="mt-[40px] text-[34px] font-medium leading-[1.05] tracking-[-0.035em]">Welcome back</p>
      <p className="mt-[10px] text-[17px] text-mute">Sign in to your workspace.</p>

      <p className="mt-[30px] text-[14px] font-medium text-ink-2">Work email</p>
      <div className={`mt-[8px] flex h-[56px] items-center rounded-[16px] border bg-paper px-[16px] text-[18px] ${phase === 'idle' || phase === 'typing' ? 'border-ink' : 'border-line'}`}>
        <span>{EMAIL.slice(0, typed)}</span>
        {(phase === 'idle' || phase === 'typing') && <span className="ml-[1px] inline-block h-[24px] w-[2px] animate-pulse bg-ink" />}
        {!typed && phase === 'idle' && <span className="text-faint">you@company.com</span>}
      </div>

      <div className="relative mt-[18px]">
        <motion.div
          className="flex h-[56px] items-center justify-center gap-[10px] rounded-full bg-ink text-[18px] font-medium text-milk"
          animate={{ scale: phase === 'tap' ? 0.96 : 1 }}
          transition={{ duration: 0.18 }}
        >
          {phase === 'loading' ? (
            <>
              <motion.span
                className="inline-block size-[18px] rounded-full border-[2.5px] border-milk/30 border-t-milk"
                animate={{ rotate: 360 }}
                transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
              />
              Signing in…
            </>
          ) : (
            'Continue'
          )}
        </motion.div>
        {/* the tap */}
        <AnimatePresence>
          {phase === 'tap' && (
            <motion.span
              className="pointer-events-none absolute left-1/2 top-1/2 size-[64px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/50"
              initial={{ scale: 0.3, opacity: 0.9 }}
              animate={{ scale: 2.2, opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.55, ease: 'easeOut' }}
            />
          )}
        </AnimatePresence>
      </div>

      <div className="my-[20px] flex items-center gap-[12px] text-[13px] text-faint">
        <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
      </div>
      <div className="flex h-[56px] items-center justify-center gap-[12px] rounded-full border border-line-2 bg-paper text-[17px] font-medium">
        <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden>
          <path
            fill="#FFC107"
            d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
          />
          <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
        </svg>
        Continue with Google
      </div>
      <p className="mt-auto pb-[40px] text-center text-[13px] text-faint">Your board is ready at 8:00 AM.</p>
    </div>
  );
}

/* ------------------------------------------------------------------------------ board */

type Status = 'open' | 'active' | 'done' | 'approved';
const LABEL: Record<Status, string> = {
  open: 'Open',
  active: 'In motion',
  done: 'Executed',
  approved: 'Audited ✓',
};
interface Card {
  ref: string;
  title: string;
  who: string;
  status: Status;
  meta: string;
  via?: string;
}

const BOARD: Card[] = [
  {
    ref: 'DLG-24',
    title: 'Renew the SSL certificate',
    who: 'TB',
    status: 'open',
    meta: 'Due 17:00',
  },
  {
    ref: 'DLG-23',
    title: 'Reconcile petty cash',
    who: 'MC',
    status: 'active',
    meta: 'Started 08:41',
  },
  {
    ref: 'DLG-21',
    title: 'Send Q4 vendor summary',
    who: 'KA',
    status: 'done',
    meta: 'Proof attached',
  },
  {
    ref: 'DLG-19',
    title: 'Finalize Q4 board deck',
    who: 'TB',
    status: 'approved',
    meta: 'Approved 15:12',
  },
];
// Small live changes, played one after another while the board is on screen.
const LIVE: Array<(cards: Card[]) => Card[]> = [
  (c) => [
    {
      ref: 'DLG-25',
      title: 'Book the venue for the offsite',
      who: 'LM',
      status: 'open',
      meta: 'New · from WhatsApp',
      via: 'WhatsApp',
    },
    ...c,
  ],
  (c) => c.map((x) => (x.ref === 'DLG-24' ? { ...x, status: 'active', meta: 'Started just now' } : x)),
  (c) => c.map((x) => (x.ref === 'DLG-23' ? { ...x, status: 'done', meta: 'Proof attached' } : x)),
  (c) => c.map((x) => (x.ref === 'DLG-21' ? { ...x, status: 'approved', meta: 'Approved just now' } : x)),
];

function StatusChip({ status }: { status: Status }) {
  return (
    <motion.span
      layout
      className="inline-flex items-center gap-[6px] rounded-full px-[10px] py-[3px] text-[12.5px] font-semibold"
      animate={{ backgroundColor: soft(C[status], 0.12), color: C[status] }}
      transition={{ duration: 0.4 }}
    >
      <motion.span className="size-[7px] rounded-full" animate={{ backgroundColor: C[status] }} />
      {LABEL[status]}
    </motion.span>
  );
}

function BoardView({ live }: { live: boolean }) {
  const [cards, setCards] = useState(BOARD);
  useEffect(() => {
    if (!live) return;
    let i = 0;
    const id = setInterval(() => {
      if (i >= LIVE.length) return clearInterval(id);
      setCards((c) => LIVE[i++]!(c));
    }, 2300);
    return () => clearInterval(id);
  }, [live]);
  const count = (s: Status) => cards.filter((c) => c.status === s).length;

  return (
    <div className="h-full px-[18px] pt-[62px]" data-testid="phone-board">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[12px] font-medium uppercase tracking-[0.12em] text-faint">Thursday 13 November</p>
          <p className="mt-[4px] text-[30px] font-medium leading-none tracking-[-0.035em]">Today’s board</p>
        </div>
        <Avatar initials="AO" tone="#dfe7f7" />
      </div>
      <div className="mt-[16px] grid grid-cols-4 gap-[7px]">
        {(['open', 'active', 'done', 'approved'] as Status[]).map((s) => (
          <div key={s} className="rounded-[14px] border border-line bg-paper px-[9px] py-[9px]">
            <span className="block size-[8px] rounded-full" style={{ background: C[s] }} />
            <motion.p key={count(s)} initial={{ y: -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="mt-[8px] text-[24px] font-medium leading-none tracking-[-0.03em]">
              {count(s)}
            </motion.p>
            <p className="mt-[4px] truncate text-[11px] text-mute">{LABEL[s].replace(' ✓', '')}</p>
          </div>
        ))}
      </div>
      <LayoutGroup>
        <div className="mt-[14px] space-y-[9px]">
          <AnimatePresence initial={false}>
            {cards.slice(0, 4).map((c) => (
              <motion.div
                key={c.ref}
                layout
                initial={{ opacity: 0, y: -18, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5, ease: EASE }}
                className="rounded-[18px] border border-line bg-paper p-[13px] shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[12px] text-faint">{c.ref}</span>
                  {c.via ? <span className="rounded-full bg-[#e7f8ee] px-[8px] py-[2px] text-[11px] font-semibold text-[#1d7a45]">{c.via}</span> : <StatusChip status={c.status} />}
                </div>
                <p className="mt-[6px] text-[17px] font-medium leading-snug tracking-[-0.015em]">{c.title}</p>
                <div className="mt-[10px] flex items-center justify-between">
                  <Avatar initials={c.who} />
                  <span className="text-[13px] text-mute">{c.meta}</span>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </LayoutGroup>
      <TabBar active="today" />
    </div>
  );
}

/* ------------------------------------------------------------------------------ one ticket */

const STEPS: Array<{ status: Status; when: string }> = [
  { status: 'open', when: 'Assigned by Ada · 08:02' },
  { status: 'active', when: 'Started · 08:41' },
  { status: 'done', when: 'Proof submitted · 14:20' },
  { status: 'approved', when: 'Audited by Ada · 15:12' },
];

function TaskView({ step }: { step: number }) {
  const i = Math.min(3, Math.max(0, step - 1));
  const status = STEPS[i]!.status;
  return (
    <div className="h-full px-[20px] pt-[60px]" data-testid="phone-task">
      <div className="flex items-center gap-[6px] text-[16px] text-mute">
        <ChevronLeft size={22} /> Today
      </div>
      <div className="mt-[20px] flex items-center justify-between">
        <span className="font-mono text-[14px] text-faint">DLG-412</span>
        <span data-testid="phone-status">
          <StatusChip status={status} />
        </span>
      </div>
      <p className="mt-[8px] text-[29px] font-medium leading-[1.08] tracking-[-0.03em]">Finalize Q4 board deck</p>
      <div className="mt-[16px] flex items-center gap-[10px] text-[14px] text-mute">
        <Avatar initials="TB" /> Tunde Bakare · Due today 17:00
      </div>

      {/* the ticket's colour bar */}
      <motion.div className="mt-[18px] h-[8px] rounded-full" animate={{ backgroundColor: C[status] }} transition={{ duration: 0.5 }} />

      {/* timeline */}
      <ol className="relative mt-[22px] space-y-[14px]">
        <span className="absolute bottom-[10px] left-[11px] top-[10px] w-[2px] bg-line" />
        <motion.span className="absolute left-[11px] top-[10px] w-[2px] origin-top" animate={{ height: `${(i / 3) * 86}%`, backgroundColor: C[status] }} transition={{ duration: 0.6, ease: EASE }} />
        {STEPS.map((s, n) => (
          <li key={s.status} className="relative flex items-center gap-[14px]">
            <motion.span
              className="relative z-10 grid size-[24px] place-items-center rounded-full border-[2px]"
              animate={{
                backgroundColor: n <= i ? C[s.status] : '#f3f3f1',
                borderColor: n <= i ? C[s.status] : '#d4d4cf',
                scale: n === i ? 1.12 : 1,
              }}
              transition={{ duration: 0.4 }}
            >
              {n < i && <Check size={13} strokeWidth={3.2} color="#fff" />}
            </motion.span>
            <span className={n <= i ? 'text-ink' : 'text-faint'}>
              <span className="block text-[16px] font-medium">{LABEL[s.status]}</span>
              <span className="block text-[13px] text-mute">{n <= i ? s.when : 'Waiting'}</span>
            </span>
          </li>
        ))}
      </ol>

      {/* what this step looks like in the app */}
      <div className="mt-[20px]">
        <AnimatePresence mode="wait">
          <motion.div key={status} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.35, ease: EASE }}>
            {status === 'open' && <div className="flex h-[56px] items-center justify-center rounded-full bg-ink text-[18px] font-medium text-milk">Start task</div>}
            {status === 'active' && (
              <div className="rounded-[18px] border border-line bg-paper p-[14px]">
                <p className="text-[14px] text-mute">In motion for 2 h 14 min</p>
                <div className="mt-[10px] h-[8px] overflow-hidden rounded-full bg-milk-2">
                  <motion.div className="h-full rounded-full" style={{ background: C.active }} initial={{ width: '18%' }} animate={{ width: '64%' }} transition={{ duration: 2.4, ease: EASE }} />
                </div>
              </div>
            )}
            {status === 'done' && (
              <div className="rounded-[18px] border border-line bg-paper p-[14px]">
                <div className="flex items-center gap-[12px]">
                  <span className="grid size-[42px] place-items-center rounded-[12px] bg-milk-2">
                    <FileText size={22} />
                  </span>
                  <span className="text-[15px]">
                    <span className="block font-medium">board-deck-q4.pdf</span>
                    <span className="block text-[13px] text-mute">2.4 MB · proof of work</span>
                  </span>
                </div>
                <p className="mt-[12px] flex items-center gap-[8px] rounded-[12px] bg-[#e6f4ec] px-[12px] py-[8px] text-[14px] font-medium text-[#1e6b47]">
                  <Sparkles size={16} /> AI check: looks complete
                </p>
              </div>
            )}
            {status === 'approved' && (
              <div className="flex items-center gap-[14px] rounded-[18px] bg-[#e7f0ff] p-[16px]">
                <motion.span initial={{ scale: 0.4, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 16 }}>
                  <Mark size={44} color={C.approved} />
                </motion.span>
                <span className="text-[15px] text-[#1a4fb0]">
                  <span className="block font-semibold">Audited and sealed</span>
                  <span className="block text-[13px]">Ledger entry #0412 · can’t be edited</span>
                </span>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------ feed */

const FEED = [
  {
    who: 'TB',
    text: 'Tunde started “Renew the SSL certificate”',
    color: C.active,
  },
  {
    who: 'MC',
    text: 'Maya submitted proof for “Reconcile petty cash”',
    color: C.done,
  },
  {
    who: 'AO',
    text: 'Ada audited “Send Q4 vendor summary”',
    color: C.approved,
  },
  {
    who: 'KA',
    text: 'Kemi is blocked — waiting on Leo for the PO',
    color: C.open,
  },
  { who: 'LM', text: 'Leo merged a PR · DLG-18 turned green', color: C.done },
  { who: 'AO', text: 'Ada assigned “Book the venue” to Leo', color: C.open },
];

function FeedView({ live }: { live: boolean }) {
  const [n, setN] = useState(5);
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setN((x) => x + 1), 1900);
    return () => clearInterval(id);
  }, [live]);
  const items = Array.from({ length: Math.min(n, 6) }, (_, k) => {
    const idx = n - 1 - k;
    return {
      ...FEED[idx % FEED.length]!,
      id: idx,
      ago: k === 0 ? 'now' : `${k * 3} min`,
    };
  });
  return (
    <div className="h-full px-[18px] pt-[62px]" data-testid="phone-feed">
      <p className="text-[30px] font-medium leading-none tracking-[-0.035em]">Activity</p>
      <p className="mt-[8px] flex items-center gap-[8px] text-[14px] text-mute">
        <span className="relative flex size-[9px]">
          <span className="absolute inset-0 animate-ping rounded-full bg-s-done opacity-60" />
          <span className="relative size-[9px] rounded-full bg-s-done" />
        </span>
        Live · Lumen &amp; Co.
      </p>
      <div className="mt-[16px] space-y-[9px]">
        <AnimatePresence initial={false}>
          {items.map((it) => (
            <motion.div
              key={it.id}
              layout
              initial={{ opacity: 0, y: -16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.45, ease: EASE }}
              className="flex items-start gap-[12px] rounded-[18px] border border-line bg-paper p-[12px]"
            >
              <Avatar initials={it.who} />
              <span className="flex-1 text-[14.5px] leading-snug">{it.text}</span>
              <span className="mt-[6px] size-[8px] shrink-0 rounded-full" style={{ background: it.color }} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <TabBar active="activity" />
    </div>
  );
}

/* ------------------------------------------------------------------------------ done */

function DoneView() {
  return (
    <div className="flex h-full flex-col items-center px-[24px] pt-[112px] text-center" data-testid="phone-done">
      <motion.span initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.1 }}>
        <Mark size={84} color={C.approved} />
      </motion.span>
      <p className="mt-[24px] text-[32px] font-medium leading-[1.05] tracking-[-0.035em]">All caught up</p>
      <p className="mt-[12px] text-[17px] text-mute">12 tasks audited today. No blockers.</p>
      <div className="mt-[26px] grid w-full grid-cols-2 gap-[9px] text-left">
        {(
          [
            ['Audited', '12', C.approved],
            ['On time', '94%', C.done],
            ['Red → green', '3.1 h', C.active],
            ['Blockers', '0', C.open],
          ] as const
        ).map(([label, value, color]) => (
          <div key={label} className="rounded-[18px] border border-line bg-paper p-[14px]">
            <span className="block size-[8px] rounded-full" style={{ background: color }} />
            <p className="mt-[10px] text-[26px] font-medium leading-none tracking-[-0.03em]">{value}</p>
            <p className="mt-[6px] text-[13px] text-mute">{label}</p>
          </div>
        ))}
      </div>
      <div className="mt-[22px] flex h-[54px] w-full items-center justify-center rounded-full bg-ink text-[17px] font-medium text-milk">Open Delegate</div>
    </div>
  );
}

/* ------------------------------------------------------------------------------ screen */

/**
 * `scene` comes from the scroll position; the login scene plays its own little timeline
 * (type → tap → sign in → board) every time it comes back into view.
 */
export function PhoneScreen({ scene, step, animate = true, onTap }: { scene: PhoneScene; step: number; animate?: boolean; onTap?: () => void }) {
  const [typed, setTyped] = useState(animate ? 0 : EMAIL.length);
  const [phase, setPhase] = useState<'idle' | 'typing' | 'tap' | 'loading' | 'in'>(animate ? 'idle' : 'in');
  const tapRef = useRef(onTap);
  tapRef.current = onTap;

  useEffect(() => {
    if (scene !== 'login' || !animate) return;
    setTyped(0);
    setPhase('idle');
    const timers: number[] = [];
    const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
    const start = 1400; // let the hand rise into view first
    at(start, () => setPhase('typing'));
    for (let c = 1; c <= EMAIL.length; c++) at(start + c * 95 + (c > 4 ? 60 : 0), () => setTyped(c));
    const typedAt = start + EMAIL.length * 95 + 60;
    at(typedAt + 450, () => {
      setPhase('tap');
      tapRef.current?.();
    });
    at(typedAt + 750, () => setPhase('loading'));
    at(typedAt + 1700, () => setPhase('in'));
    return () => timers.forEach(clearTimeout);
  }, [scene, animate]);

  const view = scene === 'login' ? (phase === 'in' ? 'board' : 'login') : scene;

  return (
    <div className="relative overflow-hidden bg-milk font-sans text-ink" style={{ width: SCREEN_W, height: SCREEN_H }} data-testid="phone-screen" data-view={view}>
      <StatusBar />
      <AnimatePresence initial={false}>
        {view === 'login' && (
          <Pane key="login" k="login">
            <LoginView typed={typed} phase={phase === 'in' ? 'loading' : phase} />
          </Pane>
        )}
        {view === 'board' && (
          <Pane key="board" k="board">
            <BoardView live={animate} />
          </Pane>
        )}
        {view === 'task' && (
          <Pane key="task" k="task">
            <TaskView step={step} />
          </Pane>
        )}
        {view === 'feed' && (
          <Pane key="feed" k="feed">
            <FeedView live={animate} />
          </Pane>
        )}
        {view === 'done' && (
          <Pane key="done" k="done">
            <DoneView />
          </Pane>
        )}
      </AnimatePresence>
      <HomeIndicator />
    </div>
  );
}
