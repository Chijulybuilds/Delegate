import { isManagerRole } from '@delegate/shared';
import { Activity, Gauge, KanbanSquare, LogOut, Newspaper, Settings, Users } from 'lucide-react';
import { motion } from 'motion/react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { Avatar, cx, EASE, FullPageSpinner, Logo, LogoMark } from '../components/ui';
import { useAuth } from '../lib/auth';
import { useBoard, useRealtimeHeartbeat, useWorkspace } from './data';

const NAV = [
  { to: '/app', label: 'Board', icon: KanbanSquare, end: true },
  { to: '/app/heartbeat', label: 'Heartbeat', icon: Activity },
  { to: '/app/velocity', label: 'Velocity', icon: Gauge },
  { to: '/app/standup', label: 'Standup', icon: Newspaper },
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
  if (!me || ws.isLoading) return <FullPageSpinner />;
  const role = ws.data?.me.role ?? me.membership?.role ?? 'member';
  const awaitingAudit = isManagerRole(role) ? (board.data?.tasks.filter((t) => t.status === 'done').length ?? 0) : 0;

  return (
    <div className="min-h-dvh bg-milk lg:grid lg:grid-cols-[248px_1fr]">
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-milk px-4 py-5 lg:flex">
        <Logo className="px-2" />
        <div className="mt-6 rounded-2xl border border-line bg-paper px-3 py-2.5">
          <p className="truncate text-sm font-medium" data-testid="workspace-name">
            {ws.data?.org.name}
          </p>
          <p className="text-xs text-mute">
            {roleLabel[role]} · {ws.data?.members.length ?? 0} people
          </p>
        </div>
        <nav className="mt-5 space-y-0.5" aria-label="Workspace">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                cx('relative flex h-10 items-center gap-3 rounded-xl px-3 text-[14px] transition-colors', isActive ? 'text-ink' : 'text-mute hover:bg-black/[0.03] hover:text-ink')
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-xl border border-line bg-paper shadow-[var(--shadow-card)]" transition={{ duration: 0.35, ease: EASE }} />}
                  <n.icon className="relative size-[17px]" strokeWidth={1.8} />
                  <span className="relative">{n.label}</span>
                  {n.label === 'Heartbeat' && (
                    <span className="relative ml-auto flex size-2">
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-s-done opacity-60" />
                      <span className="relative inline-flex size-2 rounded-full bg-s-done" />
                    </span>
                  )}
                  {n.label === 'Board' && awaitingAudit > 0 && (
                    <span className="relative ml-auto rounded-full bg-s-done-soft px-2 text-[11px] font-medium text-[#1E6B47]" title="Awaiting your audit">
                      {awaitingAudit}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>
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
        <div className="flex items-center gap-2">
          <LogoMark className="size-7" />
          <span className="truncate text-[15px] font-medium tracking-[-0.02em]">{ws.data?.org.name}</span>
        </div>
        <Avatar name={me.profile.fullName} src={me.profile.avatarUrl} size={30} />
      </header>

      <main className="min-w-0 pb-24 lg:pb-0">
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

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 px-4 pb-5 pt-6 sm:px-8 lg:pt-9">
      <div>
        <h1 className="text-[1.9rem] font-medium leading-none tracking-display sm:text-[2.3rem]">{title}</h1>
        {subtitle && <p className="mt-2 text-sm text-mute">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
