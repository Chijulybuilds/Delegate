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
import { CUP_ASPECT, KRAFT, PHOTO, PhotoCup, type CupPrint } from './PhotoCup';

/**
 * The one motion that runs through the whole landing page: a single hand-held cup (a real
 * photo, see PhotoCup) that travels from section to section as you scroll and changes colour
 * through the task states inside "How it works".
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

/** Poses for the travelling sections; the hero and finale are fitted to the real layout in measure(). */
function posesFor(vw: number, reduced: boolean): Record<Exclude<SectionId, 'top' | 'start'>, Pose> {
  const hidden: Pose = { cx: 0.5, cy: 0.8, s: 1, r: 0, o: 0 };
  if (reduced) return { how: hidden, product: hidden, preview: hidden, pricing: hidden };
  if (vw < 768) {
    return {
      how: { cx: 0.5, cy: 0.82, s: 0.78, r: 3, o: 1 },
      product: { cx: 0.9, cy: 0.93, s: 0.34, r: -10, o: 1 },
      preview: { cx: 0.92, cy: 0.94, s: 0.3, r: 12, o: 1 },
      pricing: { cx: 0.08, cy: 0.94, s: 0.3, r: -12, o: 1 },
    };
  }
  return {
    how: { cx: 0.72, cy: 0.62, s: 0.82, r: 5, o: 1 },
    product: { cx: 0.25, cy: 0.64, s: 0.76, r: -6, o: 1 },
    preview: { cx: 0.94, cy: 0.9, s: 0.44, r: 14, o: 1 },
    pricing: { cx: 0.06, cy: 0.9, s: 0.44, r: -12, o: 1 },
  };
}

interface Layout {
  vw: number;
  vh: number;
  cupH: number;
  keys: number[];
  poses: Pose[];
  /** linear[i] = segment ending at keys[i] tracks the page 1:1 instead of easing. */
  linear: boolean[];
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function interpolatePose(y: number, l: Pick<Layout, 'keys' | 'poses' | 'linear'>): Pose {
  const { keys, poses, linear } = l;
  if (!keys.length) return poses[0] ?? { cx: 0.5, cy: 0.8, s: 1, r: 0, o: 1 };
  if (y <= keys[0]!) return poses[0]!;
  for (let i = 1; i < keys.length; i++) {
    if (y <= keys[i]!) {
      const span = keys[i]! - keys[i - 1]!;
      const raw = span <= 0 ? 1 : (y - keys[i - 1]!) / span;
      const t = linear[i] ? raw : ease(raw);
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

/** Document-relative top of an element, ignoring CSS transforms (so reveal animations don't skew it). */
function docTop(el: HTMLElement): number {
  let y = 0;
  for (let n: HTMLElement | null = el; n; n = n.offsetParent as HTMLElement | null) y += n.offsetTop;
  return y;
}

function docBottom(id: string): number | null {
  const el = document.getElementById(id);
  return el ? docTop(el) + el.offsetHeight : null;
}

/** Space the steam needs above the lid, for a photo rendered `h` px tall. */
const steamRoom = (h: number) => (PHOTO.lidTop - PHOTO.steamTop) * h + 12;

/** Centre of the photo (viewport px) when its lid must sit at `lidY` and it is rendered at `h` px. */
const centreForLid = (lidY: number, h: number) => lidY - PHOTO.lidTop * h + h / 2;

function measure(reduced: boolean): Layout {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const mobile = vw < 768;

  // Hero: the cup sits under the headline + pills (never behind them), sized so the whole cup
  // stays above the fold. The photo height is `cupH`; the cup body is ~53% of it.
  const copyBottom = docBottom('hero-copy') ?? vh * 0.4;
  const cap = mobile ? Math.min(vh * 0.66, (vw * 0.98) / CUP_ASPECT) : Math.min(vh * 0.86, 1000);
  const fit = (vh * 0.975 - copyBottom - 12) / (PHOTO.lidTop - PHOTO.steamTop + PHOTO.cupBottom - PHOTO.lidTop);
  const cupH = Math.max(Math.min(cap, fit), Math.min(cap, vh * 0.42));
  const hero: Pose = { cx: 0.5, cy: centreForLid(copyBottom + steamRoom(cupH), cupH) / vh, s: 1, r: 0, o: 1 };

  const poseMap = posesFor(vw, reduced);
  const keys: number[] = [0];
  const poses: Pose[] = [hero];
  const linear: boolean[] = [false];
  const push = (key: number, pose: Pose, isLinear = false) => {
    keys.push(key);
    poses.push(pose);
    linear.push(isLinear);
  };

  ORDER.slice(1).forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const top = docTop(el);
    const height = el.offsetHeight;
    const last = keys[keys.length - 1]!;
    const departAt = Math.max(last, top - vh * 0.85);

    if (id === 'start') {
      // Finale: fitted inside the section, under the CTA buttons and fully above the footer.
      const ctaBottom = (docBottom('start-copy') ?? top + vh * 0.45) - top;
      let s = 0.92;
      for (let i = 0; i < 3; i++) {
        const lid = ctaBottom + steamRoom(cupH * s);
        const room = height - 16 - lid; // the hand must end above the section's bottom edge (= footer top)
        s = Math.min(0.92, Math.max(0.3, room / ((PHOTO.handEnd - PHOTO.lidTop) * cupH)));
      }
      const pose: Pose = reduced
        ? { ...hero, o: 0 }
        : { cx: 0.5, cy: centreForLid(ctaBottom + steamRoom(cupH * s), cupH * s) / vh, s, r: 0, o: 1 };
      const arriveAt = Math.max(departAt + 1, top);
      push(departAt, poses[poses.length - 1]!);
      push(arriveAt, pose);
      // Past this point the footer scrolls in: carry the cup up with the page, 1:1.
      const maxScroll = document.documentElement.scrollHeight - vh;
      if (maxScroll > arriveAt) push(maxScroll, { ...pose, cy: pose.cy - (maxScroll - arriveAt) / vh }, true);
      return;
    }

    const pose = poseMap[id as keyof typeof poseMap];
    const arriveAt = Math.max(departAt + 1, top - vh * 0.08);
    const holdUntil = Math.max(arriveAt + 1, top + height - vh * 0.92);
    push(departAt, poses[poses.length - 1]!);
    push(arriveAt, pose);
    push(holdUntil, pose);
  });
  return { vw, vh, cupH, keys, poses, linear };
}

// Cup colours are tuned for paper under `overlay` lighting, so they read a touch muted on screen.
const STATES: Array<{ cup: string; print: CupPrint }> = [
  { cup: KRAFT, print: { status: 'Open', meta: 'Assigned 08:02' } }, // natural kraft, as photographed
  { cup: '#C9463E', print: { status: 'Open', meta: 'Due 17:00' } },
  { cup: '#D3952A', print: { status: 'In progress', meta: 'Started 08:41' } },
  { cup: '#2E8D5E', print: { status: 'Executed', meta: 'Proof attached' } },
  { cup: '#2C5EC6', print: { status: 'Audited ✓', meta: 'Approved 15:12' } },
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
    return l ? interpolatePose(y ?? 0, l) : { cx: 0.5, cy: 0.9, s: 1, r: 0, o: 1 };
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
  const stepSpring = useSpring(0, { stiffness: 120, damping: 24 });
  useEffect(() => {
    stepSpring.set(step);
  }, [step, stepSpring]);
  const cupColor = useTransform(stepSpring, [0, 1, 2, 3, 4], STATES.map((s) => s.cup));

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden data-testid="cup-stage">
      <motion.div
        className="absolute left-1/2 top-1/2 will-change-transform"
        style={{ x, y, scale, rotate, opacity, height: cupH, width: cupH * CUP_ASPECT, marginLeft: -(cupH * CUP_ASPECT) / 2, marginTop: -cupH / 2 }}
      >
        <motion.div
          className="size-full"
          animate={reduced ? undefined : { y: [0, -9, 0], rotate: [0, -0.8, 0] }}
          transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
        >
          <PhotoCup className="h-full" color={cupColor} print={state.print} steam={!reduced} />
        </motion.div>
      </motion.div>
    </div>
  );
}
