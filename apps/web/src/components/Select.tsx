import { Check, ChevronDown, Search } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Popover } from './Popover';
import { cx, EASE } from './util';

/**
 * The one dropdown used everywhere in the app. Replaces the browser's native <select> so it looks
 * and moves like the rest of Delegate in light and dark themes:
 *
 *   - a pill/field trigger that lifts on hover, rings when open, and spins its chevron
 *   - a floating panel (portal) that springs open, flips above when needed, never gets clipped
 *   - options with an icon, colour dot or avatar, an optional description, a highlight that glides
 *     between rows, and a check that draws itself on the chosen one
 *   - search for long lists, full keyboard support (↑ ↓ Home End Enter Esc, type-to-jump)
 */

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  description?: string;
  /** Leading visual: an icon, an avatar… */
  icon?: ReactNode;
  /** Leading colour dot (CSS colour). */
  dot?: string;
  disabled?: boolean;
}

type Size = 'sm' | 'md' | 'inline';

const triggerSize: Record<Size, string> = {
  sm: 'h-9 rounded-full pl-3.5 pr-2.5 text-[13px] gap-2',
  md: 'h-11 w-full rounded-xl pl-3.5 pr-3 text-sm gap-2.5',
  inline: 'h-8 -ml-2 rounded-lg px-2 text-sm font-medium gap-1.5',
};

export function Select<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  placeholder = 'Choose…',
  disabled,
  searchable,
  className,
  menuWidth,
  align = 'start',
  'aria-label': ariaLabel,
  'data-testid': testId,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<SelectOption<T>>;
  size?: Size;
  placeholder?: string;
  disabled?: boolean;
  /** Show a search box. Defaults to on for lists longer than 8. */
  searchable?: boolean;
  className?: string;
  menuWidth?: number;
  align?: 'start' | 'end';
  'aria-label'?: string;
  'data-testid'?: string;
}) {
  const uid = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const typeahead = useRef({ text: '', at: 0 });
  const withSearch = searchable ?? options.length > 8;

  const selected = options.find((o) => o.value === value) ?? null;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => `${o.label} ${o.description ?? ''} ${o.value}`.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    setQuery('');
    if (refocus) requestAnimationFrame(() => trigger.current?.focus());
  }, []);

  const openMenu = () => {
    if (disabled) return;
    setOpen(true);
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
  };

  // Focus the search box (or the list) once the panel is up.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => (withSearch ? searchRef.current : list.current)?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(id);
  }, [open, withSearch]);

  // Keep the active row in view while navigating with the keyboard.
  useEffect(() => {
    if (!open || active < 0) return;
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  useEffect(() => {
    if (open) setActive(shown.length ? 0 : -1);
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (o: SelectOption<T> | undefined) => {
    if (!o || o.disabled) return;
    if (o.value !== value) onChange(o.value);
    close();
  };

  const move = (dir: 1 | -1) => {
    if (!shown.length) return;
    let i = active;
    for (let n = 0; n < shown.length; n++) {
      i = (i + dir + shown.length) % shown.length;
      if (!shown[i]!.disabled) break;
    }
    setActive(i);
  };

  const onKey = (e: KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        move(-1);
        break;
      case 'Home':
        e.preventDefault();
        setActive(0);
        break;
      case 'End':
        e.preventDefault();
        setActive(shown.length - 1);
        break;
      case 'Enter':
        e.preventDefault();
        choose(shown[active]);
        break;
      case 'Escape':
        // Close just the dropdown, not the modal or drawer it lives in.
        e.preventDefault();
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
        close();
        break;
      case 'Tab':
        close(false);
        break;
      default:
        // Type-to-jump when there's no search box.
        if (!withSearch && e.key.length === 1 && /\S/.test(e.key)) {
          const now = Date.now();
          const t = typeahead.current;
          t.text = now - t.at < 700 ? t.text + e.key.toLowerCase() : e.key.toLowerCase();
          t.at = now;
          const i = shown.findIndex((o) => o.label.toLowerCase().startsWith(t.text));
          if (i >= 0) setActive(i);
        }
    }
  };

  const lead = (o: SelectOption<T> | null) =>
    o?.icon ? (
      <span className="grid shrink-0 place-items-center">{o.icon}</span>
    ) : o?.dot ? (
      <span className="size-2 shrink-0 rounded-full" style={{ background: o.dot }} />
    ) : null;

  return (
    <>
      <motion.button
        ref={trigger}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${uid}-list` : undefined}
        aria-label={ariaLabel}
        data-testid={testId}
        data-value={value}
        disabled={disabled}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onKey}
        whileTap={disabled ? undefined : { scale: 0.98 }}
        className={cx(
          'group relative inline-flex min-w-0 items-center text-left text-ink outline-none transition-[border-color,box-shadow,background-color] duration-200',
          size === 'inline'
            ? 'border border-transparent hover:bg-ink/[0.05] focus-visible:bg-ink/[0.05]'
            : 'border bg-paper shadow-[var(--shadow-card)] hover:border-line-2 hover:shadow-[var(--shadow-pop)] focus-visible:border-ink',
          size !== 'inline' && (open ? 'border-ink ring-4 ring-ink/[0.06]' : 'border-line'),
          disabled && 'cursor-not-allowed opacity-55 hover:border-line hover:shadow-[var(--shadow-card)]',
          triggerSize[size],
          className,
        )}
      >
        {lead(selected)}
        <span className={cx('min-w-0 flex-1 truncate', !selected && 'text-faint')}>{selected?.label ?? placeholder}</span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ type: 'spring', stiffness: 420, damping: 26 }} className="grid shrink-0 place-items-center text-mute group-hover:text-ink">
          <ChevronDown className="size-4" strokeWidth={2.2} />
        </motion.span>
      </motion.button>

      <Popover anchor={trigger} open={open} onClose={() => close(false)} matchWidth placement={align === 'end' ? 'bottom-end' : 'bottom-start'} className="w-max max-w-[min(92vw,360px)]">
        {({ maxHeight }) => (
          <div style={{ minWidth: menuWidth }} onKeyDown={onKey}>
            {withSearch && (
              <div className="mb-1 flex items-center gap-2 rounded-xl bg-milk px-2.5">
                <Search className="size-4 shrink-0 text-faint" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search…"
                  aria-label="Search options"
                  aria-controls={`${uid}-list`}
                  aria-activedescendant={active >= 0 ? `${uid}-opt-${active}` : undefined}
                  className="h-9 w-full bg-transparent text-sm text-ink outline-none placeholder:text-faint"
                />
              </div>
            )}
            <div
              ref={list}
              id={`${uid}-list`}
              role="listbox"
              tabIndex={-1}
              aria-label={ariaLabel}
              aria-activedescendant={active >= 0 ? `${uid}-opt-${active}` : undefined}
              className="overflow-y-auto overscroll-contain outline-none [scrollbar-width:thin]"
              style={{ maxHeight: maxHeight - (withSearch ? 56 : 14) }}
              onMouseLeave={() => setActive(-1)}
            >
              {shown.length === 0 && <p className="px-3 py-6 text-center text-sm text-faint">No matches</p>}
              {shown.map((o, i) => {
                const isSelected = o.value === value;
                const isActive = i === active;
                return (
                  <motion.div
                    key={o.value}
                    id={`${uid}-opt-${i}`}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={o.disabled || undefined}
                    data-index={i}
                    data-value={o.value}
                    onMouseMove={() => !o.disabled && active !== i && setActive(i)}
                    onClick={() => choose(o)}
                    initial={i < 14 ? { opacity: 0, x: -6 } : false}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.22, ease: EASE, delay: i < 14 ? 0.02 + i * 0.018 : 0 }}
                    className={cx(
                      'relative flex cursor-pointer select-none items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm',
                      o.disabled ? 'cursor-not-allowed opacity-40' : isActive ? 'text-ink' : 'text-ink-2',
                    )}
                  >
                    {isActive && !o.disabled && (
                      <motion.span layoutId={`${uid}-hl`} className="absolute inset-0 -z-0 rounded-xl bg-ink/[0.065]" transition={{ type: 'spring', stiffness: 700, damping: 45 }} />
                    )}
                    <span className="relative z-10 flex min-w-0 flex-1 items-center gap-2.5">
                      {lead(o)}
                      <span className="min-w-0 flex-1">
                        <span className={cx('block truncate', isSelected && 'font-medium text-ink')}>{o.label}</span>
                        {o.description && <span className="block truncate text-xs text-faint">{o.description}</span>}
                      </span>
                    </span>
                    <span className="relative z-10 grid size-5 shrink-0 place-items-center">
                      <AnimatePresence>
                        {isSelected && (
                          <motion.span initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} transition={{ type: 'spring', stiffness: 600, damping: 30 }}>
                            <Check className="size-4 text-ink" strokeWidth={2.6} />
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </span>
                  </motion.div>
                );
              })}
            </div>
          </div>
        )}
      </Popover>
    </>
  );
}
