import {
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { HandCup, type CupTicket } from './HandCup';

/**
 * The one motion that runs through the whole landing page: a single hand-held cup that
 * travels from section to section as you scroll, and changes state inside "How it works".
 */

export type SectionId = 'top' | 'how' | 'product' | 'preview' | 'pricing' | 'start';
const ORDER: SectionId[] = ['top', 'how', 'product', 'preview', 'pricing', 'start'];

/** cx/cy = where the cup's centre sits, as a fraction of the viewport. s = scale, r = degrees. */
interface Pose {
  cx: number;
  cy: number;
  s: number;
  r: number;
  o: number;
}

function posesFor(vw: number, vh: number, cupH: number, reduced: boolean): Record<SectionId, Pose> {
  const mobile = vw < 768;
  // Hero: lid starts at ~40% (desktop) / ~48% (mobile) of the viewport, hand runs off the bottom.
  const heroTop = mobile ? 0.46 : 0.4;
  const hero: Pose = { cx: 0.5, cy: heroTop + cupH / 2 / vh, s: 1, r: 0, o: 1 };
  if (reduced) {
    const hidden = { ...hero, o: 0 };
    return { top: hero, how: hidden, product: hidden, preview: hidden, pricing: hidden, start: hidden };
  }
  if (mobile) {
    return {
      top: hero,
      how: { cx: 0.5, cy: 0.8, s: 0.74, r: 3, o: 1 },
      product: { cx: 0.9, cy: 0.93, s: 0.34, r: -10, o: 1 },
      preview: { cx: 0.92, cy: 0.94, s: 0.3, r: 12, o: 1 },
      pricing: { cx: 0.08, cy: 0.94, s: 0.3, r: -12, o: 1 },
      start: { cx: 0.5, cy: 0.5 + (cupH * 0.72) / 2 / vh + 0.12, s: 0.72, r: 0, o: 1 },
    };
  }
  return {
    top: hero,
    how: { cx: 0.72, cy: 0.56, s: 0.8, r: 5, o: 1 },
    product: { cx: 0.25, cy: 0.58, s: 0.74, r: -6, o: 1 },
    preview: { cx: 0.94, cy: 0.84, s: 0.42, r: 14, o: 1 },
    pricing: { cx: 0.06, cy: 0.84, s: 0.42, r: -12, o: 1 },
    start: { cx: 0.5, cy: 0.47 + (cupH * 0.92) / 2 / vh, s: 0.92, r: 0, o: 1 },
  };
}

interface Layout {
  vw: number;
  vh: number;
  cupH: number;
  keys: number[];
  poses: Pose[];
  how: { start: number; end: number };
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function interpolatePose(y: number, keys: number[], poses: Pose[]): Pose {
  if (!keys.length) return poses[0] ?? { cx: 0.5, cy: 0.8, s: 1, r: 0, o: 1 };
  if (y <= keys[0]!) return poses[0]!;
  for (let i = 1; i < keys.length; i++) {
    if (y <= keys[i]!) {
      const span = keys[i]! - keys[i - 1]!;
      const t = span <= 0 ? 1 : ease((y - keys[i - 1]!) / span);
      const a = poses[i - 1]!;
      const b = poses[i]!;
      return {
        cx: a.cx + (b.cx - a.cx) * t,
        cy: a.cy + (b.cy - a.cy) * t,
        s: a.s + (b.s - a.s) * t,
        r: a.r + (b.r - a.r) * t,
        o: a.o + (b.o - a.o) * t,
      };
    }
  }
  return poses[poses.length - 1]!;
}

function measure(reduced: boolean): Layout {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cupH = vw < 768 ? Math.min(vh * 0.6, vw * 1.35) : Math.min(vh * 0.8, 900);
  const poseMap = posesFor(vw, vh, cupH, reduced);
  const keys: number[] = [0];
  const poses: Pose[] = [poseMap.top];
  let how = { start: 0, end: 1 };

  ORDER.slice(1).forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    const height = el.offsetHeight;
    if (id === 'how') how = { start: top, end: top + height - vh };
    const last = keys[keys.length - 1]!;
    const departAt = Math.max(last, top - vh * 0.85);
    const arriveAt = Math.max(departAt + 1, top - vh * 0.08);
    const holdUntil = Math.max(arriveAt + 1, top + height - vh * 0.92);
    keys.push(departAt, arriveAt, holdUntil);
    poses.push(poses[poses.length - 1]!, poseMap[id], poseMap[id]);
  });
  return { vw, vh, cupH, keys, poses, how };
}

const STATES: Array<{ sleeve: string; ticket: CupTicket }> = [
  { sleeve: '#2a2a2a', ticket: { status: 'Open', title: 'Finalize Q4 board deck', meta: 'Assigned 08:02 · Ada → Kemi', color: '#E5484D' } },
  { sleeve: '#D64545', ticket: { status: 'Open', title: 'Finalize Q4 board deck', meta: 'Assigned 08:02 · due 17:00', color: '#E5484D' } },
  { sleeve: '#D99A1E', ticket: { status: 'In progress', title: 'Finalize Q4 board deck', meta: 'Started 08:41 · Kemi', color: '#E8A317' } },
  { sleeve: '#2F9E6A', ticket: { status: 'Executed', title: 'Finalize Q4 board deck', meta: 'Proof attached · AI check passed', color: '#2F9E6A' } },
  { sleeve: '#2B6FE0', ticket: { status: 'Audited ✓', title: 'Finalize Q4 board deck', meta: 'Approved 15:12 · by Ada', color: '#2B7FFF' } },
];

/** 0 = hero (neutral), 1..4 = the four lifecycle states inside "How it works". */
export function useHowStep(): { step: number; progress: MotionValue<number> } {
  const { scrollY } = useScroll();
  const [step, setStep] = useState(0);
  const progress = useMotionValue(0);
  const range = useRef({ start: 0, end: 1 });

  useLayoutEffect(() => {
    const update = () => {
      const el = document.getElementById('how');
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      range.current = { start: top, end: top + el.offsetHeight - window.innerHeight };
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, []);

  useMotionValueEvent(scrollY, 'change', (y) => {
    const { start, end } = range.current;
    const p = Math.min(1, Math.max(0, (y - start) / Math.max(1, end - start)));
    progress.set(p);
    let next = 0;
    if (y >= start - window.innerHeight * 0.35) next = Math.min(4, 1 + Math.floor(p * 4));
    setStep((s) => (s === next ? s : next));
  });

  return { step, progress };
}

export function CupStage({ step }: { step: number }) {
  const reduced = useReducedMotion() ?? false;
  const { scrollY } = useScroll();
  const layoutRef = useRef<Layout | null>(null);
  const [cupH, setCupH] = useState(720);
  const tick = useMotionValue(0);
  const intro = useMotionValue(reduced ? 0 : 1);

  useLayoutEffect(() => {
    const update = () => {
      layoutRef.current = measure(reduced);
      setCupH(layoutRef.current.cupH);
      tick.set(tick.get() + 1);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(document.body);
    window.addEventListener('resize', update);
    document.fonts?.ready.then(update).catch(() => {});
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [reduced, tick]);

  // Entrance: the hand rises into frame, like it's being offered to you.
  useEffect(() => {
    if (reduced) return;
    const controls = animate(intro, 0, { type: 'spring', stiffness: 38, damping: 14, mass: 1.1, delay: 0.15 });
    return () => controls.stop();
  }, [intro, reduced]);

  const pose = useTransform([scrollY, tick] as MotionValue<number>[], ([y]: number[]) => {
    const l = layoutRef.current;
    return l ? interpolatePose(y ?? 0, l.keys, l.poses) : { cx: 0.5, cy: 0.9, s: 1, r: 0, o: 1 };
  });

  const spring = { stiffness: 70, damping: 20, mass: 0.7 };
  const x = useSpring(useTransform(pose, (p) => (p.cx - 0.5) * (layoutRef.current?.vw ?? 1280)), spring);
  const yBase = useSpring(useTransform(pose, (p) => (p.cy - 0.5) * (layoutRef.current?.vh ?? 800)), spring);
  const scale = useSpring(useTransform(pose, (p) => p.s), spring);
  const rotateBase = useSpring(useTransform(pose, (p) => p.r), spring);
  const opacity = useTransform(pose, (p) => p.o);
  const y = useTransform([yBase, intro] as MotionValue<number>[], ([b, i]: number[]) => (b ?? 0) + (i ?? 0) * (layoutRef.current?.vh ?? 800) * 0.75);
  const rotate = useTransform([rotateBase, intro] as MotionValue<number>[], ([r, i]: number[]) => (r ?? 0) - (i ?? 0) * 10);

  const state = STATES[Math.min(step, STATES.length - 1)]!;
  // After the lifecycle section the cup stays audited (blue) for the rest of the story.
  const sleeve = useSpring(0, { stiffness: 120, damping: 24 });
  useEffect(() => {
    sleeve.set(step);
  }, [step, sleeve]);
  const sleeveColor = useTransform(sleeve, [0, 1, 2, 3, 4], STATES.map((s) => s.sleeve));

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden data-testid="cup-stage">
      <motion.div
        className="absolute left-1/2 top-1/2 will-change-transform"
        style={{ x, y, scale, rotate, opacity, height: cupH, width: cupH * (480 / 760), marginLeft: -(cupH * (480 / 760)) / 2, marginTop: -cupH / 2 }}
      >
        <motion.div
          className="size-full"
          animate={reduced ? undefined : { y: [0, -9, 0], rotate: [0, -0.8, 0] }}
          transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
        >
          <HandCup className="size-full drop-shadow-[0_30px_40px_rgba(0,0,0,0.12)]" sleeveColor={sleeveColor} ticket={state.ticket} steam={!reduced} />
        </motion.div>
      </motion.div>
    </div>
  );
}
