import { Eye, EyeOff } from 'lucide-react';
import { motion } from 'motion/react';
import { useState, type InputHTMLAttributes } from 'react';
import { Input } from './ui';
import { cx } from './util';

/** Password field with a show/hide toggle and, for new passwords, a live strength meter. */
export function PasswordInput({ meter = false, value, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { meter?: boolean; value: string }) {
  const [shown, setShown] = useState(false);
  const s = strength(value);
  return (
    <span className="block">
      <span className="relative block">
        <Input {...rest} value={value} type={shown ? 'text' : 'password'} className={cx('pr-11', className)} />
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-faint transition-colors hover:bg-ink/5 hover:text-ink"
          aria-label={shown ? 'Hide password' : 'Show password'}
          tabIndex={-1}
        >
          {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </span>
      {meter && value.length > 0 && (
        <span className="mt-2 flex items-center gap-2" aria-live="polite">
          <span className="grid flex-1 grid-cols-4 gap-1">
            {[0, 1, 2, 3].map((i) => (
              <motion.span key={i} className="h-1 rounded-full bg-line" animate={{ backgroundColor: i < s.score ? s.color : 'var(--color-line)' }} transition={{ duration: 0.25 }} />
            ))}
          </span>
          <span className="w-[92px] text-right text-xs text-mute">{s.label}</span>
        </span>
      )}
    </span>
  );
}

export const MIN_PASSWORD = 8;

function strength(p: string): { score: number; label: string; color: string } {
  if (p.length < MIN_PASSWORD) return { score: 1, label: `${MIN_PASSWORD - p.length} more character${MIN_PASSWORD - p.length === 1 ? '' : 's'}`, color: 'var(--color-s-open)' };
  let score = 1;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) score++;
  if (/\d/.test(p)) score++;
  if (/[^A-Za-z0-9]/.test(p) || p.length >= 14) score++;
  return [
    { score: 1, label: 'Weak', color: 'var(--color-s-open)' },
    { score: 2, label: 'Fair', color: 'var(--color-s-active)' },
    { score: 3, label: 'Good', color: 'var(--color-s-done)' },
    { score: 4, label: 'Strong', color: 'var(--color-s-done)' },
  ][score - 1]!;
}
