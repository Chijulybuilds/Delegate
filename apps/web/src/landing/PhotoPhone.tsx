import { motion, useAnimationControls } from 'motion/react';
import { memo, useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import fingersUrl from './assets/phone-fingers.webp';
import geometry from './assets/hand-phone.json';
import photoUrl from './assets/hand-phone.webp';
import { PhoneScreen, SCREEN_W, type PhoneScene } from './PhoneScreen';

/**
 * A real photo of a hand holding a phone, with a live Delegate app on its screen:
 *
 *   1. hand-phone.webp      cut-out photo: re-toned hand, blank glass   — scripts/hero-photo/process.py
 *   2. PhoneScreen          the app, drawn at iPhone size and scaled onto the glass
 *   3. glass                a faint reflection, so the screen reads as glass, not a sticker
 *   4. phone-fingers.webp   the fingertips that wrap over the screen's edge (+ their shadow),
 *                           so the app sits *behind* the fingers as it would in real life
 *
 * Every layer shares the photo's pixel grid, so the whole thing scales as one unit.
 */

const { width: W, height: H, screen, phone } = geometry;
export const PHONE_ASPECT = W / H;

/** Landmarks as fractions of the photo's height (for layout maths in PhoneStage). */
export const PHONE = {
  top: phone.y / H,
  bottom: (phone.y + phone.h) / H,
  handEnd: 0.95, // below this the cropped wrist has faded out (see wristFade)
};

// The photo crops the wrist; fade it out instead of showing a hard edge.
const wristFade: CSSProperties = {
  maskImage: 'linear-gradient(to bottom, #000 80%, transparent 97%)',
  WebkitMaskImage: 'linear-gradient(to bottom, #000 80%, transparent 97%)',
};

const pct = (v: number, of: number) => `${(v / of) * 100}%`;

export const PhotoPhone = memo(function PhotoPhone({ scene, step = 0, animate = true, className }: { scene: PhoneScene; step?: number; animate?: boolean; className?: string }) {
  const glassRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  // The hand reacts to the tap on "Continue": a small, quick press toward the screen.
  const press = useAnimationControls();
  const onTap = useCallback(() => {
    press.start({
      y: [0, 5, 0],
      rotate: [0, -0.6, 0],
      scale: [1, 0.995, 1],
      transition: { duration: 0.45, ease: 'easeOut' },
    });
  }, [press]);

  useLayoutEffect(() => {
    const el = glassRef.current;
    if (!el) return;
    const update = () => setScale(el.offsetWidth / SCREEN_W); // layout size: unaffected by transforms
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <motion.div className={className} style={{ aspectRatio: `${W} / ${H}`, position: 'relative', ...wristFade }} animate={press}>
      <img src={photoUrl} alt="A hand holding a phone showing the Delegate app" width={W} height={H} draggable={false} decoding="async" className="absolute inset-0 size-full select-none" />

      <div
        ref={glassRef}
        className="absolute overflow-hidden bg-black"
        style={{
          left: pct(screen.x, W),
          top: pct(screen.y, H),
          width: pct(screen.w, W),
          height: pct(screen.h, H),
          borderRadius: `${(screen.r / screen.w) * 100}% / ${(screen.r / screen.h) * 100}%`,
        }}
      >
        {scale > 0 && (
          <div
            style={{
              transform: `scale(${scale})`,
              transformOrigin: '0 0',
              width: SCREEN_W,
            }}
          >
            <PhoneScreen scene={scene} step={step} animate={animate} onTap={onTap} />
          </div>
        )}
        {/* glass: a soft diagonal reflection and a hairline where the glass meets the bezel */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: 'linear-gradient(118deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.05) 22%, rgba(255,255,255,0) 40%, rgba(255,255,255,0) 78%, rgba(255,255,255,0.06) 100%)',
            boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.55), inset 0 0 14px rgba(0,0,0,0.18)',
            borderRadius: 'inherit',
          }}
        />
      </div>

      <img src={fingersUrl} alt="" aria-hidden width={W} height={H} draggable={false} decoding="async" className="pointer-events-none absolute inset-0 size-full select-none" />
    </motion.div>
  );
});
