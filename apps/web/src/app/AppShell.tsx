import { isManagerRole, type AppNotification } from '@delegate/shared';
import { Activity, Bell, BarChart3, KanbanSquare, LogOut, Repeat2, Settings, Users } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { Avatar, cx, EASE, FullPageSpinner, Logo, LogoMark } from '../components/ui';
import { useAuth } from '../lib/auth';
import { timeAgo } from '../lib/format';
import { useBoard, useMarkRead, useNotifications, useRealtimeHeartbeat, useWorkspace } from './data';

const NAV = [
  { to: '/app', label: 'Today', icon: KanbanSquare, end: true },
  { to: '/app/activity', label: 'Activity', icon: Activity },
  { to: '/app/insights', label: 'Insights', icon: BarChart3 },
  { to: '/app/playbooks', label: 'Playbooks', icon: Repeat2 },
  { to: '/app/team', label: 'Team', icon: Users },
  { to: '/app/settings', label: 'Settings', icon: Settings },
];

const roleLabel = { owner: 'Owner', manager: 'Manager', member: 'Staff' } as const;

export default function AppShell() {
  const { me, signOut } = useAuth();
  const ws = useWorkspace();
  const board = useBoard();
  const location = useLocation();
  useRealtimeHeartbeat(ws.data?.org.id);

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
  const awaitingAudit = isManagerRole(role) ? (board.data?.tasks.filter((t) => t.status === 'done').length ?? 0) : 0;

  return (
    <div className="min-h-dvh bg-milk lg:grid lg:grid-cols-[240px_1fr]">
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-milk px-4 py-5 lg:flex">
        <div className="flex items-center justify-between px-2">
          <Logo />
          <NotificationBell />
        </div>
        <div className="mt-6 rounded-2xl border border-line bg-paper px-3 py-2.5">
          <p className="truncate text-sm font-medium" data-testid="workspace-name">
            {ws.data.org.name}
          </p>
          <p className="text-xs text-mute">
            {roleLabel[role]} · {ws.data.members.length} people
          </p>
        </div>
        <nav className="mt-5 space-y-0.5" aria-label="Workspace">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => cx('relative flex h-10 items-center gap-3 rounded-xl px-3 text-[14px] transition-colors', isActive ? 'text-ink' : 'text-mute hover:bg-black/[0.03] hover:text-ink')}
            >
              {({ isActive }) => (
                <>
                  {isActive && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-xl border border-line bg-paper shadow-[var(--shadow-card)]" transition={{ duration: 0.35, ease: EASE }} />}
                  <n.icon className="relative size-[17px]" strokeWidth={1.8} />
                  <span className="relative">{n.label}</span>
                  {n.label === 'Activity' && (
                    <span className="relative ml-auto flex size-2">
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-s-done opacity-60" />
                      <span className="relative inline-flex size-2 rounded-full bg-s-done" />
                    </span>
                  )}
                  {n.label === 'Today' && awaitingAudit > 0 && (
                    <span className="relative ml-auto rounded-full bg-s-done-soft px-2 text-[11px] font-medium text-[#1E6B47]" title="Awaiting your audit">
                      {awaitingAudit}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <PlanCard />
        <div className="mt-auto flex items-center gap-3 rounded-2xl px-2 py-2">
          <Avatar name={me.profile.fullName} src={me.profile.avatarUrl} size={34} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium" data-testid="current-user">
              {me.profile.fullName}
            </p>
            <p className="truncate text-xs text-mute">{me.profile.email}</p>
          </div>
          <button onClick={() => signOut()} className="grid size-8 place-items-center rounded-full text-mute hover:bg-black/5 hover:text-ink" aria-label="Sign out" title="Sign out">
            <LogOut className="size-4" />
          </button>
        </div>
      </aside>

      {/* Top bar (mobile) */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-milk/85 px-4 backdrop-blur-xl lg:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <LogoMark className="size-7 shrink-0" />
          <span className="truncate text-[15px] font-medium tracking-[-0.02em]">{ws.data.org.name}</span>
        </div>
        <div className="flex items-center gap-1">
          <NotificationBell />
          <Avatar name={me.profile.fullName} src={me.profile.avatarUrl} size={30} />
        </div>
      </header>

      <main className="min-w-0 pb-24 lg:pb-0">
        <TrialBanner />
        <motion.div key={location.pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }}>
          <Outlet />
        </motion.div>
      </main>

      {/* Bottom tabs (mobile) */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-line bg-milk/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden" aria-label="Workspace">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cx('flex h-14 flex-col items-center justify-center gap-0.5 text-[10px]', isActive ? 'text-ink' : 'text-faint')}>
            <n.icon className="size-[18px]" strokeWidth={1.8} />
            {n.label}
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

  const unread = data?.unread ?? 0;
  const go = (n: AppNotification) => {
    setOpen(false);
    if (!n.readAt) markRead.mutate([n.id]);
    navigate(n.taskId ? `/app?task=${n.taskId}` : n.type === 'billing' ? '/app/settings?tab=billing' : '/app');
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative grid size-9 place-items-center rounded-full text-ink-2 hover:bg-black/5"
        aria-label={unread ? `Notifications (${unread} unread)` : 'Notifications'}
        aria-expanded={open}
        data-testid="bell"
      >
        <Bell className="size-[18px]" strokeWidth={1.8} />
        {unread > 0 && (
          <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-s-open px-1 text-[10px] font-semibold leading-4 text-white" data-testid="bell-count">
            {unread > 9 ? '9+' : unread}
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
            <ul className="max-h-[60vh] overflow-y-auto">
              {(data?.notifications ?? []).length === 0 && <li className="px-4 py-8 text-center text-sm text-faint">You're all caught up.</li>}
              {(data?.notifications ?? []).map((n) => (
                <li key={n.id}>
                  <button onClick={() => go(n)} className={cx('flex w-full gap-3 px-4 py-3 text-left hover:bg-milk', !n.readAt && 'bg-s-approved-soft/40')}>
                    <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-s-approved')} />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium leading-snug">{n.title}</span>
                      <span className="mt-0.5 line-clamp-2 block text-xs text-mute">{n.body}</span>
                      <span className="mt-1 block text-[11px] text-faint">{timeAgo(n.createdAt)}</span>
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
        {subtitle && <p className={title ? 'mt-2 text-sm text-mute' : 'text-sm text-mute'}>{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
