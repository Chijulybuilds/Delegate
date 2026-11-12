import { motion, type MotionValue } from 'motion/react';
import { memo } from 'react';

export interface CupTicket {
  status: string;
  title: string;
  meta: string;
  color: string;
}

/**
 * A suited hand presenting a takeaway cup — Delegate's mascot for "handing work off".
 * The sleeve colour and the order-ticket sticker carry the task state (Red → Amber → Green → Blue ✓).
 *
 * Pure SVG: crisp at any size, no image requests, cheap to animate as one transformed layer.
 */
export const HandCup = memo(function HandCup({
  sleeveColor,
  ticket,
  steam = true,
  className,
}: {
  sleeveColor: MotionValue<string> | string;
  ticket: CupTicket;
  steam?: boolean;
  className?: string;
}) {
  return (
    <svg viewBox="0 0 480 760" className={className} role="img" aria-label="A hand in a suit sleeve holding a Delegate coffee cup">
      <defs>
        {/* Cup body: a cylinder lit from the upper left */}
        <linearGradient id="hc-cup" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#c9c9c4" />
          <stop offset="0.16" stopColor="#e6e6e2" />
          <stop offset="0.36" stopColor="#fbfbf9" />
          <stop offset="0.6" stopColor="#f1f1ed" />
          <stop offset="0.86" stopColor="#d6d6d1" />
          <stop offset="1" stopColor="#bdbdb8" />
        </linearGradient>
        <linearGradient id="hc-cup-v" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#000" stopOpacity="0.07" />
          <stop offset="0.12" stopColor="#000" stopOpacity="0" />
          <stop offset="0.9" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.1" />
        </linearGradient>
        <linearGradient id="hc-lid" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#d2d2cd" />
          <stop offset="0.3" stopColor="#f6f6f3" />
          <stop offset="0.55" stopColor="#ffffff" />
          <stop offset="0.85" stopColor="#dededa" />
          <stop offset="1" stopColor="#c6c6c1" />
        </linearGradient>
        <linearGradient id="hc-lid-top" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#e4e4e0" />
        </linearGradient>
        {/* Sleeve shading overlay: darkens the edges, adds a soft highlight */}
        <linearGradient id="hc-sleeve-shade" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity="0.38" />
          <stop offset="0.2" stopColor="#000" stopOpacity="0.08" />
          <stop offset="0.38" stopColor="#fff" stopOpacity="0.16" />
          <stop offset="0.55" stopColor="#fff" stopOpacity="0.04" />
          <stop offset="0.85" stopColor="#000" stopOpacity="0.18" />
          <stop offset="1" stopColor="#000" stopOpacity="0.42" />
        </linearGradient>

        {/* Skin */}
        <linearGradient id="hc-finger" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#a8714e" />
          <stop offset="0.42" stopColor="#8f5b3c" />
          <stop offset="1" stopColor="#6a3f27" />
        </linearGradient>
        <linearGradient id="hc-finger-x" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity="0.18" />
          <stop offset="0.25" stopColor="#000" stopOpacity="0" />
          <stop offset="0.75" stopColor="#fff" stopOpacity="0.05" />
          <stop offset="1" stopColor="#000" stopOpacity="0.12" />
        </linearGradient>
        <linearGradient id="hc-palm" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#7c4c31" />
          <stop offset="0.35" stopColor="#9a6342" />
          <stop offset="0.7" stopColor="#8a5638" />
          <stop offset="1" stopColor="#5f3822" />
        </linearGradient>
        <linearGradient id="hc-nail" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#d9b29a" />
          <stop offset="1" stopColor="#b5876b" />
        </linearGradient>

        {/* Shirt cuff + suit sleeve */}
        <linearGradient id="hc-cuff" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#d9d9d6" />
          <stop offset="0.35" stopColor="#ffffff" />
          <stop offset="0.75" stopColor="#f2f2ef" />
          <stop offset="1" stopColor="#c9c9c5" />
        </linearGradient>
        <linearGradient id="hc-suit" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#141414" />
          <stop offset="0.3" stopColor="#2c2c2c" />
          <stop offset="0.55" stopColor="#3a3a3a" />
          <stop offset="0.8" stopColor="#222" />
          <stop offset="1" stopColor="#101010" />
        </linearGradient>
        <filter id="hc-blur" x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
        <clipPath id="hc-sleeve-clip">
          <path d="M134 300 Q230 318 326 300 L316.5 440 Q230 458 143.5 440 Z" />
        </clipPath>
      </defs>

      {/* ---------------------------------------------------------------- steam */}
      {steam && (
        <g fill="none" stroke="#9a9a95" strokeLinecap="round" strokeWidth="5">
          {[
            { d: 'M196 92 C184 72 210 62 198 40 C190 26 204 16 200 4', delay: 0 },
            { d: 'M230 88 C218 66 246 56 232 32 C224 18 238 8 234 -6', delay: 1.1 },
            { d: 'M264 92 C252 72 278 62 266 40 C258 26 272 16 268 4', delay: 2.2 },
          ].map((s) => (
            <motion.path
              key={s.d}
              d={s.d}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: [0, 0.32, 0], y: [12, -10, -26] }}
              transition={{ duration: 3.4, repeat: Infinity, delay: s.delay, ease: 'easeInOut' }}
            />
          ))}
        </g>
      )}

      {/* ------------------------------------------------------------- cup body */}
      <path d="M128 160 L332 160 L302.4 598 Q301.6 606 293 606 L167 606 Q158.4 606 157.6 598 Z" fill="url(#hc-cup)" />
      <path d="M128 160 L332 160 L302.4 598 Q301.6 606 293 606 L167 606 Q158.4 606 157.6 598 Z" fill="url(#hc-cup-v)" />
      {/* seam */}
      <path d="M296 168 L276 600" stroke="#000" strokeOpacity="0.05" strokeWidth="2" />

      {/* ---------------------------------------------------------------- sleeve */}
      <motion.path d="M134 300 Q230 318 326 300 L316.5 440 Q230 458 143.5 440 Z" style={{ fill: sleeveColor }} />
      <g clipPath="url(#hc-sleeve-clip)">
        <rect x="120" y="290" width="220" height="170" fill="url(#hc-sleeve-shade)" />
        {/* corrugation lines */}
        {Array.from({ length: 13 }, (_, i) => (
          <path key={i} d={`M${146 + i * 14} 300 L${152 + i * 13.2} 460`} stroke="#000" strokeOpacity="0.06" strokeWidth="1.2" />
        ))}
      </g>
      <path d="M134 300 Q230 318 326 300" fill="none" stroke="#000" strokeOpacity="0.12" strokeWidth="1.5" />
      {/* sleeve brand */}
      <g transform="translate(230 372)">
        <circle r="17" cx="-56" cy="0" fill="#fff" fillOpacity="0.95" />
        <path d="M-63.5 0.5 l4.6 4.6 l9.6 -10" fill="none" stroke="#111" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
        <text x="-30" y="7" fill="#fff" fillOpacity="0.95" fontSize="22" fontWeight="600" letterSpacing="-0.5" fontFamily="'Inter Tight Variable', 'Inter Tight', system-ui, sans-serif">
          Delegate
        </text>
      </g>

      {/* --------------------------------------------------------- order ticket */}
      <g transform="translate(160 186) rotate(-4)">
        <rect width="150" height="78" rx="6" fill="#fff" />
        <rect width="150" height="78" rx="6" fill="none" stroke="#000" strokeOpacity="0.08" />
        <rect width="150" height="16" rx="6" fill="#111" />
        <rect y="10" width="150" height="6" fill="#111" />
        <text x="10" y="11.5" fill="#f3f3f1" fontSize="8.5" fontWeight="600" letterSpacing="1.4" fontFamily="'Inter Tight Variable', system-ui, sans-serif">
          TASK TICKET
        </text>
        <text x="140" y="11.5" textAnchor="end" fill="#9a9a95" fontSize="8" fontFamily="ui-monospace, monospace">
          #0412
        </text>
        <circle cx="15" cy="32" r="4.5" fill={ticket.color} />
        <text x="25" y="35.5" fill="#111" fontSize="11" fontWeight="650" fontFamily="'Inter Tight Variable', system-ui, sans-serif">
          {ticket.status}
        </text>
        <text x="10" y="54" fill="#3a3a3a" fontSize="10.5" fontWeight="500" fontFamily="'Inter Tight Variable', system-ui, sans-serif">
          {ticket.title}
        </text>
        <text x="10" y="68" fill="#8a8a85" fontSize="8.5" fontFamily="'Inter Tight Variable', system-ui, sans-serif">
          {ticket.meta}
        </text>
      </g>

      {/* ------------------------------------------------------------------ lid */}
      <path d="M120 146 Q120 130 136 130 L324 130 Q340 130 340 146 L340 152 Q340 164 326 164 L134 164 Q120 164 120 152 Z" fill="url(#hc-lid)" />
      <path d="M124 160 L336 160" stroke="#000" strokeOpacity="0.1" strokeWidth="2" />
      <path d="M150 100 Q152 92 162 92 L298 92 Q308 92 310 100 L322 130 L138 130 Z" fill="url(#hc-lid-top)" />
      <path d="M150 100 Q152 92 162 92 L298 92 Q308 92 310 100 L322 130 L138 130 Z" fill="url(#hc-lid)" fillOpacity="0.45" />
      <rect x="172" y="99" width="40" height="9" rx="4.5" fill="#a9a9a4" />
      <path d="M138 130 L322 130" stroke="#000" strokeOpacity="0.08" strokeWidth="1.5" />

      {/* ---------------------------------------------------------------- wrist */}
      <path d="M318 640 Q312 610 322 590 L400 588 Q414 612 410 644 Z" fill="url(#hc-palm)" />

      {/* -------------------------------------------- fingers wrapping the cup */}
      {/* soft contact shadow where the hand meets the cup */}
      <path d="M166 448 Q250 458 336 444" fill="none" stroke="#000" strokeOpacity="0.1" strokeWidth="9" strokeLinecap="round" filter="url(#hc-blur)" />
      {[
        // pinky (drawn first, sits lowest)
        { y: 552, h: 30, tip: 196, sag: 7 },
        { y: 518, h: 34, tip: 170, sag: 8 },
        { y: 482, h: 36, tip: 160, sag: 9 },
        // index (top, drawn last)
        { y: 446, h: 36, tip: 168, sag: 9 },
      ].map((f, i) => {
        const right = 352;
        const top = f.y;
        const bottom = f.y + f.h;
        const mid = (f.tip + right) / 2;
        const d = `M${right} ${top} Q${mid} ${top + f.sag} ${f.tip + f.h / 2} ${top + 1}
          Q${f.tip} ${top + 2} ${f.tip} ${top + f.h / 2}
          Q${f.tip} ${bottom - 2} ${f.tip + f.h / 2} ${bottom - 1}
          Q${mid} ${bottom + f.sag} ${right} ${bottom} Z`;
        const nailX = f.tip + 5;
        const nailW = f.h * 0.62;
        return (
          <g key={i}>
            <path d={d} fill="url(#hc-finger)" />
            <path d={d} fill="url(#hc-finger-x)" />
            <path d={`M${right} ${bottom} Q${mid} ${bottom + f.sag} ${f.tip + f.h / 2} ${bottom - 1}`} fill="none" stroke="#3d2214" strokeOpacity="0.45" strokeWidth="1.6" />
            <path d={`M${f.tip + (right - f.tip) * 0.3} ${top + 7} q-3 ${f.h / 2 - 6} 0 ${f.h - 12}`} fill="none" stroke="#3d2214" strokeOpacity="0.28" strokeWidth="1.3" />
            <path d={`M${f.tip + (right - f.tip) * 0.58} ${top + 8} q-3 ${f.h / 2 - 6} 0 ${f.h - 12}`} fill="none" stroke="#3d2214" strokeOpacity="0.22" strokeWidth="1.3" />
            <rect x={nailX} y={top + f.h * 0.2} width={nailW} height={f.h * 0.6} rx={f.h * 0.28} fill="url(#hc-nail)" />
            <rect x={nailX + 3} y={top + f.h * 0.27} width={nailW * 0.45} height={f.h * 0.14} rx={2} fill="#fff" fillOpacity="0.35" />
            <path d={`M${right - 20} ${top + 4} Q${mid} ${top + f.sag + 3} ${f.tip + f.h * 0.9} ${top + 4}`} fill="none" stroke="#fff" strokeOpacity="0.12" strokeWidth="2.4" strokeLinecap="round" />
          </g>
        );
      })}

      {/* ------------------------------------- back of hand: knuckles cover finger bases */}
      <path
        d="M344 432 Q326 438 324 462 Q318 480 324 498 Q316 518 322 534 Q316 552 324 568 Q320 586 330 600 Q340 616 344 624
           L404 628 Q420 596 418 540 Q416 478 398 452 Q378 428 344 432 Z"
        fill="url(#hc-palm)"
      />
      {/* knuckle bumps */}
      {[464, 500, 536, 570].map((y) => (
        <path key={y} d={`M330 ${y - 10} q-7 10 0 20`} fill="none" stroke="#fff" strokeOpacity="0.1" strokeWidth="4" strokeLinecap="round" />
      ))}
      <path d="M352 452 Q366 530 352 612" fill="none" stroke="#fff" strokeOpacity="0.06" strokeWidth="14" strokeLinecap="round" />
      <path d="M404 470 Q414 540 400 618" fill="none" stroke="#000" strokeOpacity="0.12" strokeWidth="6" strokeLinecap="round" />

      {/* ---------------------------------------------------------------- thumb */}
      <path d="M332 440 Q322 434 320 420" fill="none" stroke="#000" strokeOpacity="0.12" strokeWidth="8" strokeLinecap="round" filter="url(#hc-blur)" />
      <path
        d="M392 470 Q396 452 384 436 L352 400 Q340 388 328 394 Q316 402 322 418 L346 460 Q356 478 374 482 Q388 482 392 470 Z"
        fill="url(#hc-finger)"
      />
      <path d="M392 470 Q396 452 384 436 L352 400 Q340 388 328 394 Q316 402 322 418 L346 460 Q356 478 374 482 Q388 482 392 470 Z" fill="url(#hc-finger-x)" />
      <path d="M329 398 Q337 393 344 400 L352 410 Q354 418 346 419 Q338 419 333 412 Q326 404 329 398 Z" fill="url(#hc-nail)" />
      <path d="M333 401 Q338 398 342 402" fill="none" stroke="#fff" strokeOpacity="0.4" strokeWidth="2" strokeLinecap="round" />
      <path d="M356 432 q8 6 14 2" fill="none" stroke="#3d2214" strokeOpacity="0.3" strokeWidth="1.4" strokeLinecap="round" />

      {/* ---------------------------------------------------------- suit + cuff */}
      <path d="M280 704 Q280 694 292 692 L426 682 Q440 682 442 696 L468 790 L258 790 Z" fill="url(#hc-suit)" />
      <path d="M306 704 L312 790" stroke="#fff" strokeOpacity="0.05" strokeWidth="2" />
      <path d="M274 698 L444 686" stroke="#000" strokeOpacity="0.5" strokeWidth="3" />
      <path d="M296 654 Q298 644 310 643 L410 636 Q422 636 424 647 L430 688 Q430 696 420 697 L300 705 Q290 705 290 696 Z" fill="url(#hc-cuff)" />
      <path d="M300 667 L426 659" stroke="#000" strokeOpacity="0.06" strokeWidth="1.5" />
      <rect x="396" y="664" width="14" height="10" rx="2.5" fill="#2b2b2b" transform="rotate(-4 403 669)" />
      <rect x="398.5" y="666" width="9" height="5" rx="1.5" fill="#8a8a85" transform="rotate(-4 403 669)" />
    </svg>
  );
});
