import { AnimatePresence, motion, useAnimate } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { cx } from './util';

/**
 * One-time code boxes (e.g. the 6-digit sign-up code).
 *
 * A single real <input> sits over the boxes, so typing, backspace, pasting the whole code and the
 * phone keyboard's "From Messages/Mail" suggestion (autocomplete="one-time-code") all just work.
 * Digits pop into their box, the next box shows a blinking caret, a wrong code shakes the row red
 * and a correct one turns it green.
 */
export function CodeInput({
  length,
  value,
  onChange,
  onComplete,
  disabled,
  state = 'idle',
  shake = 0,
  autoFocus,
  'data-testid': testId,
}: {
  length: number;
  value: string;
  onChange: (code: string) => void;
  /** Called once the code reaches `length` digits (typed or pasted). */
  onComplete?: (code: string) => void;
  disabled?: boolean;
  state?: 'idle' | 'error' | 'success';
  /** Increment to shake the row (after a wrong code). */
  shake?: number;
  autoFocus?: boolean;
  'data-testid'?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [scope, animate] = useAnimate<HTMLDivElement>();
  // A pasted longer code (if Supabase is set to more digits) still fits.
  const boxes = Math.min(10, Math.max(length, value.length));

  useEffect(() => {
    if (shake) void animate(scope.current, { x: [0, -10, 10, -7, 7, -3, 0] }, { duration: 0.45 });
  }, [shake, animate, scope]);

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);

  const set = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 10);
    if (digits === value) return;
    onChange(digits);
    if (digits.length >= length && digits.length > value.length) onComplete?.(digits);
  };

  return (
    <div ref={scope} className="relative mx-auto w-fit" onClick={() => input.current?.focus()}>
      <div className="flex items-center gap-1.5 sm:gap-2" aria-hidden>
        {Array.from({ length: boxes }, (_, i) => {
          const digit = value[i];
          const active = focused && !disabled && (i === value.length || (i === boxes - 1 && value.length >= boxes));
          return (
            <div key={i} className="flex items-center gap-1.5 sm:gap-2">
              {boxes === length && length % 2 === 0 && i === length / 2 && <span className="h-0.5 w-2.5 rounded-full bg-line-2" />}
              <motion.div
                className={cx(
                  'relative grid place-items-center rounded-2xl border bg-paper font-medium tabular-nums tracking-tight shadow-[var(--shadow-card)] transition-colors duration-200',
                  boxes > 6 ? 'h-12 w-9 text-[22px] sm:h-14 sm:w-11 sm:text-[24px]' : 'h-14 w-11 text-[26px] sm:h-[60px] sm:w-12',
                  state === 'error' ? 'border-s-open text-s-open-ink' : state === 'success' ? 'border-s-done text-s-done-ink' : active ? 'border-ink' : digit ? 'border-line-2' : 'border-line',
                  disabled && state === 'idle' && 'opacity-60',
                )}
                animate={active ? { y: -2, scale: 1.04 } : { y: 0, scale: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              >
                <AnimatePresence mode="popLayout" initial={false}>
                  {digit ? (
                    <motion.span
                      key={`${i}-${digit}`}
                      initial={{ opacity: 0, y: 10, scale: 0.6 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -8, scale: 0.7 }}
                      transition={{ type: 'spring', stiffness: 600, damping: 28 }}
                    >
                      {digit}
                    </motion.span>
                  ) : (
                    active && <span key="caret" className="block h-7 w-0.5 animate-[caret_1.05s_steps(1)_infinite] rounded-full bg-ink" />
                  )}
                </AnimatePresence>
              </motion.div>
            </div>
          );
        })}
      </div>
      <input
        ref={input}
        value={value}
        onChange={(e) => set(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        disabled={disabled}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={10}
        aria-label={`${length}-digit code`}
        aria-invalid={state === 'error'}
        spellCheck={false}
        className="absolute inset-0 h-full w-full cursor-text bg-transparent text-transparent caret-transparent opacity-0 outline-none selection:bg-transparent"
        data-testid={testId}
      />
    </div>
  );
}
