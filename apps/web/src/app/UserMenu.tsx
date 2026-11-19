import { isManagerRole } from '@delegate/shared';
import { BellRing, BellOff, ChevronsUpDown, CreditCard, DoorOpen, LogOut, Monitor, Moon, Settings, Sun, UserRound, type LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { useCallback, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { Popover } from '../components/Popover';
import { Avatar, cx } from '../components/ui';
import { useAuth } from '../lib/auth';
import { setSoundOn, useSoundOn } from '../lib/sound';
import { setThemePref, useThemePref, type ThemePref } from '../lib/theme';
import type { WorkspaceData } from './data';

const THEMES: Array<{ value: ThemePref; label: string; icon: LucideIcon }> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];
const ROLE = { owner: 'Owner', manager: 'Manager', member: 'Staff' } as const;

/**
 * Your avatar opens this menu: who you're signed in as, the dashboard's appearance (light, dark or
 * following the device), quick links and sign out. `variant="sidebar"` is the desktop footer block,
 * `variant="avatar"` the round avatar in the phone header.
 */
export function UserMenu({ ws, variant }: { ws: WorkspaceData; variant: 'sidebar' | 'avatar' }) {
  const { me, signOut } = useAuth();
  const { pref } = useThemePref();
  const sound = useSoundOn();
  const navigate = useNavigate();
  const uid = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const close = useCallback(() => setOpen(false), []);
  if (!me) return null;
  const manager = isManagerRole(ws.me.role);

  const items: Array<{ id: string; label: string; icon: LucideIcon; run: () => void; danger?: boolean }> = [
    { id: 'account', label: 'Account & WhatsApp', icon: UserRound, run: () => navigate('/app/settings?tab=account') },
    { id: 'settings', label: 'Workspace settings', icon: Settings, run: () => navigate('/app/settings') },
    ...(manager ? [{ id: 'billing', label: 'Plan & billing', icon: CreditCard, run: () => navigate('/app/settings?tab=billing') }] : []),
    { id: 'leave', label: 'Leave or delete account', icon: DoorOpen, run: () => navigate('/app/settings?tab=account&danger=show') },
    { id: 'signout', label: 'Sign out', icon: LogOut, run: () => void signOut(), danger: true },
  ];

  // ↑/↓ move between the menu's buttons; Esc closes and returns focus to the avatar.
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
  };

  return (
    <>
      {variant === 'sidebar' ? (
        <button
          ref={trigger}
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? uid : undefined}
          className={cx('group flex w-full items-center gap-3 rounded-2xl border px-2 py-2 text-left transition-colors', open ? 'border-line bg-paper' : 'border-transparent hover:border-line hover:bg-paper')}
          data-testid="user-menu"
        >
          <Avatar name={me.profile.fullName} src={me.profile.avatarUrl} size={34} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium" data-testid="current-user">
              {me.profile.fullName}
            </span>
            <span className="block truncate text-xs text-mute">{me.profile.email}</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-faint transition-colors group-hover:text-ink" />
        </button>
      ) : (
        <motion.button
          ref={trigger}
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Account and appearance"
          whileTap={{ scale: 0.92 }}
          className={cx('rounded-full transition-shadow', open && 'ring-2 ring-ink/80 ring-offset-2 ring-offset-milk')}
          data-testid="user-menu-avatar"
        >
          <Avatar name={me.profile.fullName} src={me.profile.avatarUrl} size={30} />
        </motion.button>
      )}

      <Popover anchor={trigger} open={open} onClose={close} placement={variant === 'sidebar' ? 'top-start' : 'bottom-end'} matchWidth={variant === 'sidebar'} className="w-[280px]" id={uid} label="Account menu">
        <div role="menu" aria-label="Account menu" onKeyDown={onKey} data-testid="user-menu-panel">
          <div className="flex items-center gap-3 px-2.5 pb-3 pt-2">
            <Avatar name={me.profile.fullName} src={me.profile.avatarUrl} size={38} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{me.profile.fullName}</p>
              <p className="truncate text-xs text-mute">{me.profile.email}</p>
            </div>
            <span className="shrink-0 rounded-full bg-milk-2 px-2 py-0.5 text-[11px] font-medium text-ink-2">{ROLE[ws.me.role]}</span>
          </div>

          <div className="mx-1 rounded-xl bg-milk p-2.5">
            <p className="px-0.5 text-[11px] font-medium uppercase tracking-[0.14em] text-faint">Appearance</p>
            <div className="mt-2 grid grid-cols-3 gap-1 rounded-xl bg-milk-2 p-1" role="group" aria-label="Theme">
              {THEMES.map((t) => {
                const on = pref === t.value;
                return (
                  <motion.button
                    key={t.value}
                    role="menuitemradio"
                    aria-checked={on}
                    onClick={(e) => setThemePref(t.value, { x: e.clientX, y: e.clientY })}
                    whileTap={{ scale: 0.94 }}
                    className={cx('relative flex flex-col items-center gap-1 rounded-lg py-2 text-[12px] font-medium outline-none transition-colors', on ? 'text-ink' : 'text-mute hover:text-ink')}
                    data-testid={`theme-${t.value}`}
                  >
                    {on && <motion.span layoutId={`${uid}-theme`} className="absolute inset-0 rounded-lg bg-paper shadow-[var(--shadow-card)]" transition={{ type: 'spring', stiffness: 520, damping: 34 }} />}
                    <motion.span className="relative" animate={on ? { rotate: [0, -14, 10, 0], scale: [1, 1.15, 1] } : { rotate: 0, scale: 1 }} transition={{ duration: 0.5 }}>
                      <t.icon className="size-[17px]" strokeWidth={1.9} />
                    </motion.span>
                    <span className="relative">{t.label}</span>
                  </motion.button>
                );
              })}
            </div>
          </div>

          <button
            role="menuitemcheckbox"
            aria-checked={sound}
            onClick={() => setSoundOn(!sound)}
            className="mx-1 mt-1.5 flex w-[calc(100%-8px)] items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm text-ink-2 outline-none transition-colors hover:bg-ink/[0.05] hover:text-ink focus-visible:bg-ink/[0.05]"
            data-testid="sound-toggle"
          >
            {sound ? <BellRing className="size-4" /> : <BellOff className="size-4 text-faint" />}
            <span className="flex-1">Notification sound</span>
            <span className={cx('relative h-5 w-9 rounded-full transition-colors duration-300', sound ? 'bg-ink' : 'bg-line-2')}>
              <motion.span className="absolute top-0.5 size-4 rounded-full bg-paper shadow" animate={{ left: sound ? 18 : 2 }} transition={{ type: 'spring', stiffness: 600, damping: 32 }} />
            </span>
          </button>

          <div className="mt-1.5 border-t border-line pt-1.5" onMouseLeave={() => setHover(null)}>
            {items.map((it) => (
              <button
                key={it.id}
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  it.run();
                }}
                onMouseEnter={() => setHover(it.id)}
                onFocus={() => setHover(it.id)}
                className={cx('relative flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm outline-none', it.danger ? 'text-s-open-ink' : 'text-ink-2 hover:text-ink')}
                data-testid={`user-menu-${it.id}`}
              >
                {hover === it.id && (
                  <motion.span
                    layoutId={`${uid}-hl`}
                    className={cx('absolute inset-0 rounded-xl', it.danger ? 'bg-s-open-soft' : 'bg-ink/[0.06]')}
                    transition={{ type: 'spring', stiffness: 700, damping: 45 }}
                  />
                )}
                <it.icon className="relative size-4 shrink-0" strokeWidth={1.9} />
                <span className="relative">{it.label}</span>
              </button>
            ))}
          </div>
        </div>
      </Popover>
    </>
  );
}
