import { motion } from 'motion/react';

/**
 * A friendly little character for an empty board lane: a round, smiling face giving a thumbs-up,
 * with a small speech bubble. Line art in the theme's own colours, gently bobbing.
 */
export function EmptyLaneArt({ className }: { className?: string }) {
  return (
    <motion.svg
      viewBox="0 0 120 104"
      className={className}
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      animate={{ y: [0, -3, 0] }}
      transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
    >
      {/* speech bubble */}
      <motion.g animate={{ scale: [1, 1.06, 1], opacity: [0.9, 1, 0.9] }} transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }} style={{ transformOrigin: '96px 22px' }}>
        <path d="M84 10h22a7 7 0 0 1 7 7v8a7 7 0 0 1-7 7h-12l-6 6v-6h-4a7 7 0 0 1-7-7v-8a7 7 0 0 1 7-7z" className="fill-paper" strokeWidth={1.8} />
        <circle cx="88" cy="21" r="1.4" className="fill-current" stroke="none" />
        <circle cx="95" cy="21" r="1.4" className="fill-current" stroke="none" />
        <circle cx="102" cy="21" r="1.4" className="fill-current" stroke="none" />
      </motion.g>
      {/* head */}
      <circle cx="52" cy="54" r="30" className="fill-paper" />
      {/* hair tuft */}
      <path d="M44 25c3-5 9-6 12-2" />
      {/* eyes */}
      <path d="M40 50c2-3 6-3 8 0" />
      <path d="M57 50c2-3 6-3 8 0" />
      {/* cheeks */}
      <circle cx="38" cy="60" r="3" className="fill-s-open-tint" stroke="none" />
      <circle cx="67" cy="60" r="3" className="fill-s-open-tint" stroke="none" />
      {/* smile */}
      <path d="M44 63c4 5 13 5 17 0" />
      {/* thumbs-up hand, waving a little */}
      <motion.g animate={{ rotate: [0, -8, 0, -5, 0] }} transition={{ duration: 2.4, repeat: Infinity, repeatDelay: 1.2, ease: 'easeInOut' }} style={{ transformOrigin: '78px 80px' }}>
        <path d="M74 84v-12c0-2 1.5-3.5 3.5-3.5S81 70 81 72v-6c0-2.2 1.6-4 3.6-4s3.4 1.8 3.4 4v8h4c2.2 0 4 1.8 4 4l-1.5 8c-.4 2.2-2.3 3.8-4.6 3.8H78c-2.2 0-4-1.8-4-4z" className="fill-paper" />
        <path d="M81 72v6" />
      </motion.g>
    </motion.svg>
  );
}
