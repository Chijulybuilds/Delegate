import { LayoutGroup, motion, useInView } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { cx, EASE } from '../components/ui';

const COLS = [
  { id: 0, label: 'Open', dot: 'bg-s-open' },
  { id: 1, label: 'In motion', dot: 'bg-s-active' },
  { id: 2, label: 'Executed', dot: 'bg-s-done' },
  { id: 3, label: 'Audited', dot: 'bg-s-approved' },
];

const STATIC: Array<{ col: number; title: string; who: string; tag: string }> = [
  { col: 0, title: 'Write job post for ops associate', who: 'MC', tag: 'Ops' },
  { col: 0, title: 'Audit SOC 2 access reviews', who: 'LM', tag: 'Eng' },
  { col: 1, title: 'Ship onboarding emails v2', who: 'TB', tag: 'Eng' },
  { col: 1, title: 'Courier contract renewal', who: 'MC', tag: 'Blocked' },
  { col: 2, title: 'QA release 3.4 on Android', who: 'LM', tag: 'AI ✓' },
  { col: 3, title: 'Reconcile vendor invoices', who: 'MC', tag: 'Ops' },
  { col: 3, title: 'Fix checkout timeout', who: 'TB', tag: 'Eng' },
];

/** A miniature, self-playing Delegate board. The hero card walks Red → Amber → Green → Blue. */
export function BoardPreview() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.4 });
  const [col, setCol] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const id = setInterval(() => setCol((c) => (c + 1) % 4), 1700);
    return () => clearInterval(id);
  }, [inView]);

  return (
    <div ref={ref} className="overflow-hidden rounded-[28px] border border-line bg-paper shadow-[var(--shadow-float)]">
      <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
        <span className="size-2.5 rounded-full bg-line-2" />
        <span className="size-2.5 rounded-full bg-line-2" />
        <span className="size-2.5 rounded-full bg-line-2" />
        <span className="ml-3 text-xs text-faint">app.delegate — Today · Lumen & Co.</span>
        <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-mute">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-s-done opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-s-done" />
          </span>
          Live
        </span>
      </div>
      <LayoutGroup>
        <div className="grid grid-cols-2 gap-3 bg-milk/60 p-3 sm:p-4 md:grid-cols-4">
          {COLS.map((c) => (
            <div key={c.id} className="min-h-[220px] rounded-2xl bg-milk p-2.5 sm:min-h-[260px]">
              <div className="mb-2.5 flex items-center gap-2 px-1 text-[13px] font-medium">
                <span className={cx('size-2 rounded-full', c.dot)} />
                {c.label}
              </div>
              <div className="space-y-2">
                {c.id === col && (
                  <motion.div
                    layoutId="hero-card"
                    transition={{ duration: 0.8, ease: EASE }}
                    className="rounded-xl border border-ink bg-paper p-3 shadow-[var(--shadow-card)]"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className={cx('size-1.5 rounded-full transition-colors duration-500', COLS[col]!.dot)} />
                      <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-mute">Urgent</span>
                    </div>
                    <p className="mt-1.5 text-[13px] font-medium leading-snug">Finalize Q4 board deck</p>
                    <div className="mt-2.5 flex items-center justify-between">
                      <span className="grid size-5 place-items-center rounded-full bg-[#EEDFDB] text-[9px] font-semibold">KA</span>
                      <span className="text-[10px] text-faint">{['Due 17:00', 'Started 08:41', 'Proof · AI ✓', 'Approved ✓'][col]}</span>
                    </div>
                  </motion.div>
                )}
                {STATIC.filter((s) => s.col === c.id).map((s) => (
                  <motion.div layout key={s.title} transition={{ duration: 0.8, ease: EASE }} className="rounded-xl border border-line bg-paper p-3">
                    <p className="text-[13px] leading-snug text-ink-2">{s.title}</p>
                    <div className="mt-2.5 flex items-center justify-between">
                      <span className="grid size-5 place-items-center rounded-full bg-[#DDE7E3] text-[9px] font-semibold">{s.who}</span>
                      <span className={cx('rounded-full px-1.5 py-0.5 text-[10px]', s.tag === 'Blocked' ? 'bg-s-active-soft text-[#8A5A00]' : s.tag.startsWith('AI') ? 'bg-s-done-soft text-[#1E6B47]' : 'bg-milk text-faint')}>
                        {s.tag}
                      </span>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </LayoutGroup>
    </div>
  );
}
