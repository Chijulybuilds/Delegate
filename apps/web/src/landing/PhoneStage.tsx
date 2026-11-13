import { animate, motion, useMotionValue, useMotionValueEvent, useReducedMotion, useScroll, useSpring, useTransform, type MotionValue } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PhoneScene } from './PhoneScreen';
import { PHONE, PHONE_ASPECT, PhotoPhone } from './PhotoPhone';

/**
 * The one motion that runs through the whole landing page: a hand holding a phone (a real
 * photo, see PhotoPhone) travels from section to section as you scroll. Its screen tells the
 * story: sign in at the top, one ticket going Open → In motion → Executed → Audited inside
 * "How it works", the live feed, the board, and finally "All caught up" above the footer.
 */

export type SectionId = 'top' | 'how' | 'product' | 'preview' | 'pricing' | 'start';
const ORDER: SectionId[] = ['top', 'how', 'product', 'preview', 'pricing', 'start'];

/** cx/cy = where the photo's centre sits, as a fraction of the viewport. s = scale, r = degrees. */
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
      how: { cx: 0.5, cy: 0.74, s: 0.92, r: 2, o: 1 },
      product: { cx: 0.88, cy: 0.9, s: 0.42, r: -8, o: 1 },
      preview: { cx: 0.9, cy: 0.92, s: 0.38, r: 10, o: 1 },
      pricing: { cx: 0.1, cy: 0.92, s: 0.38, r: -10, o: 1 },
    };
  }
  return {
    how: { cx: 0.7, cy: 0.56, s: 1.12, r: 3, o: 1 },
    product: { cx: 0.24, cy: 0.6, s: 0.95, r: -5, o: 1 },
    preview: { cx: 0.93, cy: 0.86, s: 0.55, r: 12, o: 1 },
    pricing: { cx: 0.07, cy: 0.86, s: 0.55, r: -10, o: 1 },
  };
}

interface Layout {
  vw: number;
  vh: number;
  photoH: number;
  keys: number[];
  poses: Pose[];
  /** linear[i] = segment ending at keys[i] tracks the page 1:1 instead of easing. */
  linear: boolean[];
  /** Scroll positions where each section's scene takes over the phone's screen. */
  scenes: Array<{ at: number; scene: PhoneScene }>;
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

/** Centre of the photo (viewport px) when the phone's top edge must sit at `phoneTopY`, photo `h` px tall. */
const centreForPhoneTop = (phoneTopY: number, h: number) => phoneTopY - PHONE.top * h + h / 2;
const GAP = 28; // breathing room between the copy and the top of the phone

function measure(reduced: boolean): Layout {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const mobile = vw < 768;

  // Hero: the phone sits under the headline + pills (never behind them) and the whole phone
  // stays above the fold. Kept deliberately modest so the phone, not the hand, is the subject.
  const copyBottom = docBottom('hero-copy') ?? vh * 0.4;
  const cap = mobile ? Math.min(vh * 0.62, (vw * 1.05) / PHONE_ASPECT) : Math.min(vh * 0.78, 760);
  const fit = (vh - 20 - copyBottom - GAP) / (PHONE.bottom - PHONE.top);
  const photoH = Math.max(Math.min(cap, fit), Math.min(cap, vh * 0.5));
  const hero: Pose = {
    cx: 0.5,
    cy: centreForPhoneTop(copyBottom + GAP, photoH) / vh,
    s: 1,
    r: 0,
    o: 1,
  };

  const poseMap = posesFor(vw, reduced);
  const keys: number[] = [0];
  const poses: Pose[] = [hero];
  const linear: boolean[] = [false];
  const scenes: Layout['scenes'] = [{ at: -Infinity, scene: 'login' }];
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
    const sceneOf: Record<string, PhoneScene> = {
      how: 'task',
      product: 'feed',
      preview: 'board',
      pricing: 'board',
      start: 'done',
    };
    scenes.push({ at: top - vh * 0.45, scene: sceneOf[id]! });

    if (id === 'start') {
      // Finale: fitted inside the section, under the CTA buttons and fully above the footer.
      const ctaBottom = (docBottom('start-copy') ?? top + vh * 0.45) - top;
      const room = height - 16 - ctaBottom - GAP; // the hand must end above the section's bottom edge (= footer top)
      const s = Math.min(1, Math.max(0.35, room / ((PHONE.handEnd - PHONE.top) * photoH)));
      const pose: Pose = reduced
        ? { ...hero, o: 0 }
        : {
            cx: 0.5,
            cy: centreForPhoneTop(ctaBottom + GAP, photoH * s) / vh,
            s,
            r: 0,
            o: 1,
          };
      const arriveAt = Math.max(departAt + 1, top);
      push(departAt, poses[poses.length - 1]!);
      push(arriveAt, pose);
      // Past this point the footer scrolls in: carry the phone up with the page, 1:1.
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
  return { vw, vh, photoH, keys, poses, linear, scenes };
}

/** 0 = before the lifecycle, 1..4 = the four task states inside "How it works". */
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
      range.current = {
        start: top,
        end: top + el.offsetHeight - window.innerHeight,
      };
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

export function PhoneStage({ step }: { step: number }) {
  const reduced = useReducedMotion() ?? false;
  const { scrollY } = useScroll();
  const layoutRef = useRef<Layout | null>(null);
  const [photoH, setPhotoH] = useState(640);
  const [scene, setScene] = useState<PhoneScene>('login');
  const tick = useMotionValue(0);
  const intro = useMotionValue(reduced ? 0 : 1);

  const pickScene = (y: number) => {
    const l = layoutRef.current;
    if (!l) return;
    let next: PhoneScene = 'login';
    for (const s of l.scenes) if (y >= s.at) next = s.scene;
    setScene((cur) => (cur === next ? cur : next));
  };

  useLayoutEffect(() => {
    const update = () => {
      layoutRef.current = measure(reduced);
      setPhotoH(layoutRef.current.photoH);
      tick.set(tick.get() + 1);
      pickScene(window.scrollY);
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

  useMotionValueEvent(scrollY, 'change', pickScene);

  // Entrance: the hand rises into frame, like it's showing you its screen.
  useEffect(() => {
    if (reduced) return;
    const controls = animate(intro, 0, {
      type: 'spring',
      stiffness: 38,
      damping: 14,
      mass: 1.1,
      delay: 0.15,
    });
    return () => controls.stop();
  }, [intro, reduced]);

  const pose = useTransform([scrollY, tick] as MotionValue<number>[], ([y]: number[]) => {
    const l = layoutRef.current;
    return l ? interpolatePose(y ?? 0, l) : { cx: 0.5, cy: 0.9, s: 1, r: 0, o: 1 };
  });

  const spring = { stiffness: 70, damping: 20, mass: 0.7 };
  const x = useSpring(
    useTransform(pose, (p) => (p.cx - 0.5) * (layoutRef.current?.vw ?? 1280)),
    spring,
  );
  const yBase = useSpring(
    useTransform(pose, (p) => (p.cy - 0.5) * (layoutRef.current?.vh ?? 800)),
    spring,
  );
  const scale = useSpring(
    useTransform(pose, (p) => p.s),
    spring,
  );
  const rotateBase = useSpring(
    useTransform(pose, (p) => p.r),
    spring,
  );
  const opacity = useTransform(pose, (p) => p.o);
  const y = useTransform([yBase, intro] as MotionValue<number>[], ([b, i]: number[]) => (b ?? 0) + (i ?? 0) * (layoutRef.current?.vh ?? 800) * 0.75);
  const rotate = useTransform([rotateBase, intro] as MotionValue<number>[], ([r, i]: number[]) => (r ?? 0) - (i ?? 0) * 10);
  const width = photoH * PHONE_ASPECT;

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden data-testid="phone-stage" data-scene={scene}>
      <motion.div
        className="absolute left-1/2 top-1/2 will-change-transform"
        style={{
          x,
          y,
          scale,
          rotate,
          opacity,
          height: photoH,
          width,
          marginLeft: -width / 2,
          marginTop: -photoH / 2,
        }}
      >
        <motion.div className="size-full" animate={reduced ? undefined : { y: [0, -9, 0], rotate: [0, -0.9, 0] }} transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}>
          <PhotoPhone className="h-full" scene={scene} step={step} animate={!reduced} />
        </motion.div>
      </motion.div>
    </div>
  );
}
