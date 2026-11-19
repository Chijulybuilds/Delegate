import { STATUS_META, type TaskPriority, type TaskStatus } from '@delegate/shared';
import { Loader2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  forwardRef,
  useEffect,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { initials } from '../lib/format';

import { cx, EASE } from './util';

export { cx, EASE };

/* ----------------------------------- Logo ----------------------------------- */

export function LogoMark({ className = 'size-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <circle cx="16" cy="16" r="15" fill="currentColor" />
      <path d="M9.5 16.5l4.2 4.2 8.8-9.2" fill="none" stroke="var(--color-milk)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-2 text-ink', className)}>
      <LogoMark className="size-7" />
      <span className="text-[1.1875rem] font-semibold tracking-[-0.04em]">Delegate</span>
    </span>
  );
}

/* ---------------------------------- Button ---------------------------------- */

type Variant = 'primary' | 'outline' | 'ghost' | 'danger' | 'soft';
type Size = 'sm' | 'md' | 'lg';

const variants: Record<Variant, string> = {
  primary: 'obsidian border border-transparent',
  outline: 'border border-ink/80 text-ink hover:bg-ink hover:text-milk',
  ghost: 'text-ink-2 hover:bg-ink/5 border border-transparent',
  danger: 'ruby border border-transparent hover:brightness-105',
  soft: 'surface text-ink hover:border-line-2',
};
const sizes: Record<Size, string> = {
  sm: 'h-8 px-3.5 text-[0.8125rem] gap-1.5',
  md: 'h-10 px-5 text-sm gap-2',
  lg: 'h-12 px-7 text-[0.9375rem] gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cx(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-medium tracking-[-0.01em] transition-[background,color,border,transform,filter] duration-200 active:scale-[0.97] disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

/* ----------------------------------- Pill ----------------------------------- */

export function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex h-7 items-center rounded-full border border-ink/70 px-3 text-[0.8125rem] text-ink-2', className)}>
      {children}
    </span>
  );
}

/* ---------------------------------- Status ---------------------------------- */

const toneClasses = {
  red: { dot: 'bg-s-open', text: 'text-s-open', soft: 'bg-s-open-soft text-s-open-ink' },
  amber: { dot: 'bg-s-active', text: 'text-s-active', soft: 'bg-s-active-soft text-s-active-ink' },
  green: { dot: 'bg-s-done', text: 'text-s-done', soft: 'bg-s-done-soft text-s-done-ink' },
  blue: { dot: 'bg-s-approved', text: 'text-s-approved', soft: 'bg-s-approved-soft text-s-approved-ink' },
} as const;

/** A status dot. `glow` adds a soft halo in its colour (used for work that's moving). */
export function StatusDot({ status, pulse, glow, className }: { status: TaskStatus; pulse?: boolean; glow?: boolean; className?: string }) {
  const tone = STATUS_META[status].tone;
  return (
    <span className={cx('relative inline-flex size-2', className)}>
      {pulse && <span className={cx('absolute inline-flex size-full animate-ping rounded-full opacity-60', toneClasses[tone].dot)} />}
      <span className={cx('relative inline-flex size-2 rounded-full', glow ? cx('glow', toneClasses[tone].text) : toneClasses[tone].dot)} />
    </span>
  );
}

export function StatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  const meta = STATUS_META[status];
  return (
    <span
      data-status={status}
      className={cx('inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium', toneClasses[meta.tone].soft, className)}
    >
      <StatusDot status={status} />
      {meta.label}
      {status === 'approved' && <span aria-hidden>✓</span>}
    </span>
  );
}

const priorityStyle: Record<TaskPriority, string> = {
  low: 'text-faint',
  medium: 'text-mute',
  high: 'text-ink-2',
  urgent: 'text-s-open-ink',
};

export function PriorityTag({ priority }: { priority: TaskPriority }) {
  return (
    <span className={cx('inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[0.6875rem] font-medium uppercase tracking-[0.06em]', priorityStyle[priority])}>
      {priority === 'urgent' && <span className="size-1.5 rounded-full bg-s-open" />}
      {priority}
    </span>
  );
}

/* ---------------------------------- Avatar ---------------------------------- */

// Theme-aware pastel backgrounds (see --color-avatar-* in styles.css).
const avatarHues = [1, 2, 3, 4, 5, 6].map((n) => `var(--color-avatar-${n})`);

export function Avatar({ name, src, size = 28, className }: { name: string; src?: string | null; size?: number; className?: string }) {
  const hue = avatarHues[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % avatarHues.length];
  return (
    <span
      className={cx('inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full text-ink-2 ring-2 ring-paper', className)}
      style={{ width: size, height: size, background: hue, fontSize: Math.max(10, size * 0.38) }}
      title={name}
    >
      {src ? <img src={src} alt="" className="size-full object-cover" referrerPolicy="no-referrer" /> : <span className="font-semibold">{initials(name)}</span>}
    </span>
  );
}

/* ---------------------------------- Inputs ---------------------------------- */

const field =
  'w-full rounded-xl border border-line bg-paper px-3.5 text-sm text-ink placeholder:text-faint transition focus:border-ink focus:outline-none focus:ring-4 focus:ring-ink/5';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(field, 'h-11', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cx(field, 'min-h-24 resize-y py-3 leading-relaxed', className)} {...rest} />;
});

export { Select, type SelectOption } from './Select';
export { DateTimePicker, TimePicker } from './DateTimePicker';

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <label className="block space-y-1.5" htmlFor={htmlFor}>
      <span className="text-[0.8125rem] font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="block text-xs text-faint">{hint}</span>}
    </label>
  );
}

/* ------------------------------ Modal & Drawer ------------------------------ */

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  width = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  width?: string;
}) {
  useEscape(open, onClose);
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="absolute inset-0 bg-black/25 backdrop-blur-[2px]" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={cx('relative w-full rounded-t-3xl border border-line bg-paper p-6 shadow-[var(--shadow-float)] sm:rounded-3xl sm:p-7', width)}
            initial={{ y: 32, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 24, opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.35, ease: EASE }}
          >
            <h2 className="text-xl font-semibold tracking-[-0.03em]">{title}</h2>
            {description && <p className="mt-1 text-sm text-mute">{description}</p>}
            <div className="mt-5">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function Drawer({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: ReactNode; label: string }) {
  useEscape(open, onClose);
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[70]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="absolute inset-0 bg-black/20" onClick={onClose} />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label={label}
            className="absolute inset-y-0 right-0 flex w-full max-w-[560px] flex-col border-l border-line bg-milk shadow-[var(--shadow-float)]"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.45, ease: EASE }}
          >
            {children}
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* ---------------------------------- Misc ---------------------------------- */

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('size-5 animate-spin text-mute', className)} aria-label="Loading" />;
}

export function FullPageSpinner() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center gap-3 text-mute">
        <LogoMark className="size-9 animate-pulse text-ink" />
        <span className="text-sm">Loading…</span>
      </motion.div>
    </div>
  );
}

export function Card({ children, className, ...rest }: { children: ReactNode; className?: string; ref?: React.Ref<HTMLDivElement> } & React.HTMLAttributes<HTMLDivElement> & { 'data-testid'?: string }) {
  return (
    <div className={cx('surface rounded-2xl', className)} {...rest}>
      {children}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line-2 px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {body && <p className="mt-1 max-w-sm text-sm text-mute">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
  className?: string;
}) {
  return (
    <div className={cx('well relative inline-flex rounded-full bg-milk-2/60 p-1', className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx('relative z-10 h-7 rounded-full px-3 text-[0.8125rem] font-medium transition-colors', value === o.value ? 'text-milk' : 'text-mute hover:text-ink')}
        >
          {value === o.value && (
            <motion.span layoutId={`seg-${options.map((x) => x.value).join('')}`} className="obsidian absolute inset-0 -z-10 rounded-full" transition={{ type: 'spring', stiffness: 480, damping: 36 }} />
          )}
          {o.label}
        </button>
      ))}
    </div>
  );
}
