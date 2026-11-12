import { motion, type MotionValue } from 'motion/react';
import { memo, type CSSProperties } from 'react';
import cupMaskUrl from './assets/cup-mask.png';
import cupShadeUrl from './assets/cup-shade.webp';
import geometry from './assets/hand-cup.json';
import photoUrl from './assets/hand-cup.webp';

/**
 * A real photo of a hand presenting a takeaway cup, rebuilt so the cup is live:
 *
 *   1. hand-cup.webp     cut-out photo (blank cup, re-toned hand)        — scripts/hero-photo/process.py
 *   2. colour layer      the cup's state colour, clipped to cup-mask.png (fingers stay in front)
 *   3. print layer       the Delegate design, printed on the cup
 *   4. cup-shade.webp    the cup's own lighting, `overlay`-blended over 2 + 3 so colour and print
 *                        pick up the photo's cylinder shading
 *
 * Everything shares one coordinate system (the photo's pixels), so it scales as a unit.
 */

export const CUP_ASPECT = geometry.width / geometry.height;

/** Landmarks as fractions of the photo's height (for layout maths in CupStage). */
export const PHOTO = {
  steamTop: 22 / geometry.height, // highest point the steam reaches
  lidTop: geometry.lid.top / geometry.height,
  cupBottom: geometry.cup.bottom / geometry.height,
  handEnd: 0.86, // below this the forearm has faded out (see armFade)
};
/** The photographed paper, slightly richer to survive `overlay` lighting. */
export const KRAFT = '#A57C4D';
const { width: W, height: H } = geometry;

export interface CupPrint {
  status: string;
  meta: string;
}

const cupMask: CSSProperties = {
  maskImage: `url(${cupMaskUrl})`,
  WebkitMaskImage: `url(${cupMaskUrl})`,
  maskSize: '100% 100%',
  WebkitMaskSize: '100% 100%',
  maskRepeat: 'no-repeat',
  WebkitMaskRepeat: 'no-repeat',
};

// The forearm is cropped in the photo; fade it out instead of showing a hard edge.
const armFade: CSSProperties = {
  maskImage: 'linear-gradient(to bottom, #000 66%, transparent 88%)',
  WebkitMaskImage: 'linear-gradient(to bottom, #000 66%, transparent 88%)',
};

const FONT = "'Inter Tight Variable', 'Inter Tight', system-ui, sans-serif";

export const PhotoCup = memo(function PhotoCup({
  color,
  print,
  steam = true,
  className,
}: {
  color: MotionValue<string> | string;
  print: CupPrint;
  steam?: boolean;
  className?: string;
}) {
  return (
    <div className={className} style={{ aspectRatio: `${W} / ${H}`, position: 'relative', ...armFade }}>
      <img
        src={photoUrl}
        alt="A hand holding a Delegate coffee cup"
        width={W}
        height={H}
        draggable={false}
        decoding="async"
        className="absolute inset-0 size-full select-none [filter:drop-shadow(0_28px_36px_rgba(0,0,0,0.12))]"
      />

      {/* 2. state colour */}
      <motion.div className="absolute inset-0" style={{ ...cupMask, backgroundColor: color }} />

      {/* 3. the printed design: same layout as a branded cup, with Delegate's mark */}
      <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 size-full" style={cupMask} aria-hidden>
        <g fill="#fff" fontFamily={FONT}>
          {/* vertical wordmark */}
          <text transform="translate(499 538) rotate(-90)" fontSize="64" fontWeight="700" letterSpacing="-2.5">
            delegate
          </text>
          {/* mark */}
          <circle cx="474" cy="592" r="26" />
          <motion.path d="M461 593 l9 9 l17 -18" fill="none" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: color }} />

          {/* small vertical copy */}
          <text transform="translate(584 612) rotate(-90)" fontSize="17" fontWeight="650" letterSpacing="0.2">
            Task ticket #0412
          </text>
          <text transform="translate(606 612) rotate(-90)" fontSize="14" fillOpacity="0.85">
            Finalize Q4 board deck
          </text>
          <text transform="translate(626 612) rotate(-90)" fontSize="14" fillOpacity="0.85">
            Hand it off. See it done.
          </text>

          {/* bottom block */}
          <circle cx="468" cy="666" r="11" />
          <motion.path d="M462.5 666.5 l3.8 3.8 l7 -7.4" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: color }} />
          <text x="486" y="674" fontSize="24" fontWeight="650" letterSpacing="-0.5">
            delegate
          </text>
          <text x="455" y="718" fontSize="36" fontWeight="700" letterSpacing="-1">
            Task ticket
          </text>
          <text x="455" y="756" fontSize="36" fontWeight="700" letterSpacing="-1">
            {print.status}
          </text>
          <text x="456" y="787" fontSize="13.5" fontWeight="600" letterSpacing="1.2" fillOpacity="0.9">
            {print.meta.toUpperCase()}
          </text>
        </g>
      </svg>

      {/* 4. the photo's own lighting on top of colour + print */}
      <img src={cupShadeUrl} alt="" aria-hidden width={W} height={H} draggable={false} className="absolute inset-0 size-full select-none" style={{ ...cupMask, mixBlendMode: 'overlay' }} />

      {steam && (
        <svg viewBox={`0 0 ${W} ${H}`} className="pointer-events-none absolute inset-0 size-full" aria-hidden>
          <g fill="none" stroke="#a9a9a4" strokeLinecap="round" strokeWidth="8">
            {[
              { d: 'M512 134 C498 114 528 102 514 82 C506 68 520 56 516 44', delay: 0 },
              { d: 'M552 130 C538 110 568 98 554 76 C546 62 560 50 556 38', delay: 1.1 },
              { d: 'M592 134 C578 114 608 102 594 82 C586 68 600 56 596 44', delay: 2.2 },
            ].map((s) => (
              <motion.path
                key={s.d}
                d={s.d}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: [0, 0.3, 0], y: [10, -4, -16] }}
                transition={{ duration: 3.4, repeat: Infinity, delay: s.delay, ease: 'easeInOut' }}
              />
            ))}
          </g>
        </svg>
      )}
    </div>
  );
});
