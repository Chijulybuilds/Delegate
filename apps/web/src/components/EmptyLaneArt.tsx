/**
 * A friendly little character for an empty board lane: a round, smiling face giving a thumbs-up,
 * with a small speech bubble. Line art in the theme's own colours. It stays still: endless
 * animations kept the processor busy on boards left open all day.
 */
export function EmptyLaneArt({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 104"
      className={className}
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* speech bubble */}
      <g>
        <path d="M84 10h22a7 7 0 0 1 7 7v8a7 7 0 0 1-7 7h-12l-6 6v-6h-4a7 7 0 0 1-7-7v-8a7 7 0 0 1 7-7z" className="fill-paper" strokeWidth={1.8} />
        <circle cx="88" cy="21" r="1.4" className="fill-current" stroke="none" />
        <circle cx="95" cy="21" r="1.4" className="fill-current" stroke="none" />
        <circle cx="102" cy="21" r="1.4" className="fill-current" stroke="none" />
      </g>
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
      {/* thumbs-up hand */}
      <g>
        <path d="M74 84v-12c0-2 1.5-3.5 3.5-3.5S81 70 81 72v-6c0-2.2 1.6-4 3.6-4s3.4 1.8 3.4 4v8h4c2.2 0 4 1.8 4 4l-1.5 8c-.4 2.2-2.3 3.8-4.6 3.8H78c-2.2 0-4-1.8-4-4z" className="fill-paper" />
        <path d="M81 72v6" />
      </g>
    </svg>
  );
}
