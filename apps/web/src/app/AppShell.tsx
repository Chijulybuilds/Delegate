import { isManagerRole, type AppNotification } from '@delegate/shared';
import { Activity, Bell, BarChart3, Hourglass, KanbanSquare, Repeat2, Settings, ShieldCheck, Users } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { Avatar, cx, EASE, FullPageSpinner, Logo, LogoMark } from '../components/ui';
import { useAuth } from '../lib/auth';
import { timeAgo } from '../lib/format';
import { playNotificationSound, primeSound } from '../lib/sound';
import { useBoard, useMarkRead, useNotifications, useRealtimeHeartbeat, useWorkspace } from './data';
import { UserMenu } from './UserMenu';

const NAV = [
  { to: '/app', label: 'Today', icon: KanbanSquare, end: true },
  { to: '/app/waiting', label: 'History', icon: Hourglass, ownerOnly: true },
  { to: '/app/audits', label: 'Audits', icon: ShieldCheck, ownerOnly: true },
  { to: '/app/activity', label: 'Activity', icon: Activity },
  { to: '/app/insights', label: 'Insights', icon: BarChart3 },
  { to: '/app/playbooks', label: 'Playbooks', icon: Repeat2 },
  { to: '/app/team', label: 'Team', icon: Users },
  { to: '/app/settings', label: 'Settings', icon: Settings },
];

/** Test id for a menu item: /app → today, /app/waiting → waiting… */
const navId = (to: string) => (to === '/app' ? 'today' : to.split('/').pop()!);

/** Plays Delegate's chime whenever a new notification arrives (never for what was already there). */
function useNotificationSound() {
  const latest = useNotifications().data?.latest;
  const seen = useRef<string | null>(null);
  useEffect(() => primeSound(), []);
  useEffect(() => {
    if (latest === undefined) return;
    const at = latest?.createdAt ?? null;
    if (seen.current === null) {
      seen.current = at ?? '';
      return;
    }
    if (at && at > seen.current) void playNotificationSound();
    if (at && at > seen.current) seen.current = at;
  }, [latest]);
}

const roleLabel = { owner: 'Owner', manager: 'Manager', member: 'Staff' } as const;

export default function AppShell() {
  const { me, signOut } = useAuth();
  const ws = useWorkspace();
  const board = useBoard();
  const notes = useNotifications().data;
  const location = useLocation();
  useRealtimeHeartbeat(ws.data?.org.id);
  useNotificationSound();

  if (ws.error) {
    return (
      <div className="grid min-h-dvh place-items-center px-6 text-center" data-testid="workspace-unavailable">
        <div>
          <LogoMark className="mx-auto size-10" />
          <h1 className="mt-5 text-2xl font-medium tracking-[-0.03em]">This workspace is unavailable</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm text-mute">{ws.error.message}</p>
          <button onClick={() => signOut()} className="mt-6 text-sm font-medium underline underline-offset-4">
            Sign out
          </button>
        </div>
      </div>
    );
  }
  if (!me || ws.isLoading || !ws.data) return <FullPageSpinner />;
  const role = ws.data.me.role;
  const nav = NAV.filter((n) => !n.ownerOnly || role === 'owner');
  // Red counts in the menu: tasks with news, on today's board and in earlier days.
  const todayIds = new Set((board.data?.tasks ?? []).map((t) => t.id));
  const newsIds = Object.keys(notes?.tasks ?? {});
  const newsToday = newsIds.filter((id) => todayIds.has(id)).length;
  const newsEarlier = board.data ? newsIds.length - newsToday : 0;
  const badge: Record<string, number> = { Today: newsToday, History: role === 'owner' ? newsEarlier : 0 };

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[256px_1fr]">
      {/* Sidebar (desktop): a solid 3D panel */}
      <aside className="slab-side sticky top-0 z-40 hidden h-dvh flex-col px-4 py-5 lg:top-[14px] lg:flex lg:h-[calc(100dvh-36px)]">
        <div className="flex items-center justify-between px-2">
          <Logo />
          <NotificationBell />
        </div>
        <div className="surface mt-6 rounded-2xl px-3 py-2.5">
          <p className="truncate text-sm font-medium" data-testid="workspace-name">
            {ws.data.org.name}
          </p>
          <p className="text-xs text-mute">
            {roleLabel[role]} · {ws.data.members.length} people
          </p>
        </div>
        <nav className="mt-5 space-y-0.5" aria-label="Workspace">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                cx('relative flex h-11 items-center gap-3 rounded-xl px-3 text-[0.875rem] transition-colors duration-300', isActive ? 'font-medium text-milk' : 'text-ink-2/80 hover:bg-ink/[0.05] hover:text-ink')
              }
              data-testid={`nav-${navId(n.to)}`}
            >
              {({ isActive }) => (
                <>
                  {/* The current page: a black pill that glides between items */}
                  {isActive && <motion.span layoutId="nav-active" className="obsidian absolute inset-0 rounded-xl" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />}
                  <n.icon className="relative size-[17px]" strokeWidth={1.8} />
                  <span className="relative">{n.label}</span>
                  {n.label === 'Activity' && (
                    <span className="relative ml-auto flex size-2 text-s-done">
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-s-done opacity-60" />
                      <span className="glow relative inline-flex size-2 rounded-full" />
                    </span>
                  )}
                  {(badge[n.label] ?? 0) > 0 && (
                    <motion.span
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="relative ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-s-open px-1.5 text-[0.6875rem] font-semibold tabular-nums text-white"
                      title="Tasks with new messages or updates"
                      data-testid={`nav-news-${navId(n.to)}`}
                    >
                      {badge[n.label]}
                    </motion.span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <PlanCard />
        <div className="mt-auto">
          <UserMenu ws={ws.data} variant="sidebar" />
        </div>
      </aside>

      {/* Top bar (mobile) */}
      <header className="bar sticky top-0 z-30 flex h-14 items-center justify-between border-b border-[var(--edge)] px-4 shadow-[0_6px_16px_-8px_rgb(15_23_42/0.22)] lg:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <LogoMark className="size-7 shrink-0" />
          <span className="truncate text-[0.9375rem] font-medium tracking-[-0.02em]">{ws.data.org.name}</span>
        </div>
        <div className="flex items-center gap-1">
          <NotificationBell />
          <UserMenu ws={ws.data} variant="avatar" />
        </div>
      </header>

      {/* The board: a solid 3D panel coming out of the screen (wide screens) */}
      <main className="shell min-w-0 pb-24 lg:pb-0">
        <TrialBanner />
        <motion.div key={location.pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }}>
          <Outlet />
        </motion.div>
      </main>

      {/* Bottom tabs (mobile) */}
      <nav className="scrollbar-none fixed inset-x-0 bottom-0 z-30 flex overflow-x-auto border-t border-[var(--edge)] bar pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_20px_-10px_rgb(15_23_42/0.25)] lg:hidden" aria-label="Workspace">
        {nav.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) => cx('relative flex h-14 min-w-[76px] flex-1 flex-col items-center justify-center gap-0.5 whitespace-nowrap text-[0.625rem]', isActive ? 'font-medium text-ink' : 'text-faint')}
          >
            {({ isActive }) => (
              <>
                <span className={cx('grid h-7 w-11 place-items-center rounded-full transition-colors', isActive && 'obsidian')}>
                  <n.icon className="size-[17px]" strokeWidth={1.8} />
                </span>
                {n.label}
                {(badge[n.label] ?? 0) > 0 && <span className="absolute right-[calc(50%-22px)] top-1.5 size-2 rounded-full bg-s-open ring-2 ring-milk" />}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

/** Small, honest plan indicator in the sidebar. */
function PlanCard() {
  const ws = useWorkspace();
  const ent = ws.data?.entitlements;
  // Staff never deal with billing — keep their sidebar quiet.
  if (!ent || !isManagerRole(ws.data?.me.role)) return null;
  const label = ent.status === 'trialing' ? `Team trial · ${ent.trialDaysLeft}d left` : ent.effectivePlan === 'starter' ? 'Starter (free)' : `${ent.plan[0]!.toUpperCase()}${ent.plan.slice(1)} plan`;
  return (
    <Link to="/app/settings?tab=billing" className="mt-6 block rounded-2xl border border-dashed border-line-2 px-3 py-2.5 text-xs text-mute transition-colors hover:border-ink hover:text-ink" data-testid="plan-card">
      <span className="font-medium text-ink-2">{label}</span>
      {ent.effectivePlan === 'starter' && <span className="mt-0.5 block">Upgrade for WhatsApp, escalations & auto-proof →</span>}
    </Link>
  );
}

function TrialBanner() {
  const ws = useWorkspace();
  const ent = ws.data?.entitlements;
  if (!ent || ws.data?.me.role !== 'owner') return null;
  let text: string | null = null;
  if (ent.status === 'trialing' && (ent.trialDaysLeft ?? 99) <= 7) text = `Your Team trial ends in ${ent.trialDaysLeft} day${ent.trialDaysLeft === 1 ? '' : 's'}.`;
  if (ent.status === 'past_due') text = 'Your last payment failed — update your card to keep Team features.';
  if (ent.status === 'trialing' && ent.trialDaysLeft === 0) text = 'Your Team trial has ended. You are on Starter.';
  if (!text) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-paper px-4 py-2.5 text-sm sm:px-8" data-testid="trial-banner">
      <span className="text-ink-2">{text}</span>
      <Link to="/app/settings?tab=billing" className="font-medium underline underline-offset-4">
        Choose a plan
      </Link>
    </div>
  );
}

function NotificationBell() {
  const { data } = useNotifications();
  const markRead = useMarkRead();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const board = useBoard();
  const role = useWorkspace().data?.me.role;
  const unread = data?.unread ?? 0;
  const todayIds = new Set((board.data?.tasks ?? []).map((t) => t.id));
  const allTaskNews = Object.entries(data?.tasks ?? {});
  // Today's cards carry their own red badge. News on earlier tasks is listed here, so everyone can
  // still reach it (the owner also finds those tasks under "History").
  const earlierNews = board.data ? allTaskNews.filter(([id]) => !todayIds.has(id)).sort((a, b) => b[1].latest.createdAt.localeCompare(a[1].latest.createdAt)) : [];
  const taskNews = allTaskNews.length - earlierNews.length;
  const bellCount = unread + earlierNews.length;
  const go = (n: AppNotification) => {
    setOpen(false);
    if (!n.readAt) markRead.mutate([n.id]);
    navigate(n.taskId ? `/app?task=${n.taskId}` : n.type === 'billing' ? '/app/settings?tab=billing' : '/app');
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative grid size-9 place-items-center rounded-full text-ink-2 hover:bg-ink/5"
        aria-label={bellCount ? `Notifications (${bellCount} unread)` : 'Notifications'}
        aria-expanded={open}
        data-testid="bell"
      >
        <Bell className="size-[18px]" strokeWidth={1.8} />
        {bellCount > 0 && (
          <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-s-open px-1 text-[0.625rem] font-semibold leading-4 tabular-nums text-white" data-testid="bell-count">
            {bellCount > 9 ? '9+' : bellCount}
          </span>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.2, ease: EASE }}
            className="absolute right-0 z-50 mt-2 w-[min(360px,calc(100vw-24px))] overflow-hidden rounded-2xl border border-line bg-paper shadow-[var(--shadow-float)] lg:left-0 lg:right-auto"
            data-testid="bell-panel"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <p className="text-sm font-medium">Notifications</p>
              {unread > 0 && (
                <button className="text-xs text-mute hover:text-ink" onClick={() => markRead.mutate('all')}>
                  Mark all read
                </button>
              )}
            </div>
            {earlierNews.length > 0 && (
              <div className="border-b border-line" data-testid="bell-earlier">
                <p className="px-4 pb-1 pt-2.5 text-[0.6875rem] font-medium uppercase tracking-[0.12em] text-faint">Earlier tasks</p>
                {earlierNews.slice(0, 8).map(([taskId, n]) => (
                  <button
                    key={taskId}
                    onClick={() => {
                      setOpen(false);
                      navigate(role === 'owner' ? `/app/waiting?task=${taskId}` : `/app?task=${taskId}`);
                    }}
                    className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-milk"
                    data-testid="bell-earlier-item"
                  >
                    <span className="mt-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-s-open px-1.5 text-[0.6875rem] font-semibold text-white">{n.count}</span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium leading-snug">{n.latest.title}</span>
                      <span className="mt-0.5 line-clamp-1 block text-xs text-mute">{n.latest.body}</span>
                      <span className="mt-0.5 block text-[0.6875rem] tabular-nums text-faint">{timeAgo(n.latest.createdAt)}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
            {taskNews > 0 && (
              <button
                onClick={() => {
                  setOpen(false);
                  navigate('/app');
                }}
                className="flex w-full items-center gap-2.5 border-b border-line bg-s-open-soft/50 px-4 py-2.5 text-left text-xs text-ink-2 hover:bg-s-open-soft"
                data-testid="bell-task-news"
              >
                <span className="grid h-5 min-w-5 place-items-center rounded-full bg-s-open px-1.5 text-[0.6875rem] font-semibold text-white">{taskNews}</span>
                {taskNews === 1 ? 'A task on today’s board has' : `${taskNews} tasks on today’s board have`} new messages or updates: look for the red badge on the card.
              </button>
            )}
            <ul className="max-h-[60vh] overflow-y-auto">
              {(data?.notifications ?? []).length === 0 && <li className="px-4 py-8 text-center text-sm text-faint">Nothing else for you right now.</li>}
              {(data?.notifications ?? []).map((n) => (
                <li key={n.id}>
                  <button onClick={() => go(n)} className={cx('flex w-full gap-3 px-4 py-3 text-left hover:bg-milk', !n.readAt && 'bg-s-approved-soft/40')}>
                    <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-s-approved')} />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium leading-snug">{n.title}</span>
                      <span className="mt-0.5 line-clamp-2 block text-xs text-mute">{n.body}</span>
                      <span className="mt-1 block text-[0.6875rem] tabular-nums text-faint">{timeAgo(n.createdAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 px-4 pb-5 pt-6 sm:px-8 lg:pt-9">
      <div>
        {title && <h1 className="text-[1.9rem] font-medium leading-none tracking-display sm:text-[2.3rem]">{title}</h1>}
        {subtitle && <p className={title ? 'mt-2 text-sm text-slate' : 'text-sm text-slate'}>{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
