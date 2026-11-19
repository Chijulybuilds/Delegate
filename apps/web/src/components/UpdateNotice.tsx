import { RefreshCw } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { EASE } from './util';

const CHECK_EVERY = 5 * 60_000;
const RELOADED_AT = 'delegate.reloadedForUpdate';

/**
 * "Delegate has been updated · Refresh". A tab opened before a deploy keeps running the old app
 * until it's reloaded. This checks /version.json when the tab comes back into view (and every few
 * minutes) and, if a newer build is live, asks to refresh. If the old app can't load one of its
 * screens because the deploy replaced it, it reloads by itself (at most once every 30 seconds).
 */
export function UpdateNotice() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (import.meta.env.DEV) return;
    let alive = true;
    const check = async () => {
      try {
        const res = await fetch('/version.json', { cache: 'no-store' });
        if (!res.ok) return;
        const { build } = (await res.json()) as { build?: string };
        if (alive && build && build !== __APP_BUILD__) setReady(true);
      } catch {
        /* offline: try again later */
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    const onChunkError = (e: Event) => {
      let last = 0;
      try {
        last = Number(sessionStorage.getItem(RELOADED_AT) ?? 0);
        if (Date.now() - last < 30_000) return; // already tried: show the notice instead of looping
        sessionStorage.setItem(RELOADED_AT, String(Date.now()));
      } catch {
        /* storage blocked: still reload once */
      }
      e.preventDefault();
      window.location.reload();
    };

    void check();
    const id = window.setInterval(check, CHECK_EVERY);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('vite:preloadError', onChunkError);
    return () => {
      alive = false;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('vite:preloadError', onChunkError);
    };
  }, []);

  return (
    <AnimatePresence>
      {ready && (
        <motion.div
          className="fixed inset-x-0 top-4 z-[95] flex justify-center px-4"
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.4, ease: EASE }}
        >
          <div className="flex max-w-md items-center gap-3 rounded-full bg-ink py-2 pl-4 pr-2 text-sm text-milk shadow-[var(--shadow-float)]" role="status" data-testid="update-notice">
            <span>Delegate has been updated.</span>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-1.5 rounded-full bg-milk px-3.5 py-1.5 text-[0.8125rem] font-medium text-ink transition-transform active:scale-95"
              data-testid="update-refresh"
            >
              <RefreshCw className="size-3.5" /> Refresh
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
