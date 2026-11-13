import { useLayoutEffect, useSyncExternalStore } from 'react';

/**
 * Light / dark / system theme for the dashboard (/app) only — the landing page and sign-in always
 * stay light. The choice is a per-browser preference (localStorage); public/theme-init.js applies it
 * before the first paint so a dark dashboard never flashes white.
 */

export type ThemePref = 'light' | 'dark' | 'system';
const KEY = 'delegate.theme';

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'dark' || v === 'system' ? v : 'light';
  } catch {
    return 'light';
  }
}

let pref: ThemePref = typeof window === 'undefined' ? 'light' : read();
let inDashboard = false;
const listeners = new Set<() => void>();
const media = typeof window === 'undefined' ? null : window.matchMedia('(prefers-color-scheme: dark)');

export const resolveTheme = (p: ThemePref): 'light' | 'dark' => (p === 'system' ? (media?.matches ? 'dark' : 'light') : p);

function apply() {
  const root = document.documentElement;
  if (inDashboard && resolveTheme(pref) === 'dark') root.setAttribute('data-theme', 'dark');
  else root.removeAttribute('data-theme');
}

function emit() {
  apply();
  listeners.forEach((l) => l());
}

media?.addEventListener('change', () => pref === 'system' && emit());
// Another tab changed the theme: follow it.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    pref = read();
    emit();
  });
}

/** Change the theme. `origin` (a click position) is where the new theme sweeps in from. */
export function setThemePref(next: ThemePref, origin?: { x: number; y: number }) {
  if (next === pref) return;
  const before = resolveTheme(pref);
  pref = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* private mode: the choice lasts for this visit */
  }
  if (!inDashboard || before === resolveTheme(next)) return emit();

  const root = document.documentElement;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const doc = document as Document & { startViewTransition?: (update: () => void) => { ready: Promise<void> } };
  if (doc.startViewTransition && !reduced) {
    // A circle of the new theme grows out from where you clicked.
    const { x, y } = origin ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    doc
      .startViewTransition(emit)
      .ready.then(() =>
        root.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] }, { duration: 620, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', pseudoElement: '::view-transition-new(root)' }),
      )
      .catch(() => {});
    return;
  }
  root.classList.add('theme-switching');
  emit();
  window.setTimeout(() => root.classList.remove('theme-switching'), 400);
}

export function useThemePref(): { pref: ThemePref; resolved: 'light' | 'dark' } {
  const p = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => pref,
    () => 'light' as ThemePref,
  );
  return { pref: p, resolved: resolveTheme(p) };
}

/** Call once at the top of the router: the theme applies inside /app and nowhere else. */
export function useThemeScope(pathname: string) {
  useLayoutEffect(() => {
    const entering = !inDashboard && (pathname === '/app' || pathname.startsWith('/app/'));
    inDashboard = pathname === '/app' || pathname.startsWith('/app/');
    if (entering) pref = read(); // pick up a choice saved since this page loaded
    emit();
  }, [pathname]);
}
