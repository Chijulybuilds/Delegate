import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './util';

/**
 * A floating panel anchored to a trigger: rendered in a portal (never clipped by a card, modal or
 * drawer), flips above the trigger when there's no room below, follows scrolling, closes on outside
 * click / Escape, and springs open from the side it's attached to. Used by Select and the user menu.
 */

export type Placement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end';

interface Position {
  left: number;
  right?: number;
  sheet?: boolean;
  top?: number;
  bottom?: number;
  maxHeight: number;
  minWidth: number;
  above: boolean;
}

const GAP = 8;
const MARGIN = 8;

function compute(anchor: HTMLElement, placement: Placement, panelWidth: number, matchWidth: boolean, maxHeight: number, minSpace: number): Position {
  const r = anchor.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const below = vh - r.bottom - GAP - MARGIN;
  const abovePx = r.top - GAP - MARGIN;
  const wantAbove = placement.startsWith('top');
  // Open toward the side with room; flip when the preferred side has less than `minSpace`.
  const need = Math.min(maxHeight, minSpace);
  const above = wantAbove ? abovePx >= need || abovePx > below : below < need && abovePx > below;
  const minWidth = matchWidth ? r.width : 0;
  const width = Math.max(panelWidth, minWidth);
  let left = placement.endsWith('end') ? r.right - width : r.left;
  left = Math.min(Math.max(MARGIN, left), vw - width - MARGIN);
  return {
    left,
    ...(above ? { bottom: vh - r.top + GAP } : { top: r.bottom + GAP }),
    maxHeight: Math.max(120, Math.min(maxHeight, above ? abovePx : below)),
    minWidth,
    above,
  };
}

export function Popover({
  anchor,
  open,
  onClose,
  children,
  placement = 'bottom-start',
  matchWidth = false,
  maxHeight = 360,
  minSpace = 220,
  sheetOnMobile = false,
  className,
  label,
  id,
}: {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: ReactNode | ((pos: { maxHeight: number; above: boolean }) => ReactNode);
  placement?: Placement;
  matchWidth?: boolean;
  maxHeight?: number;
  /** Space the panel would like on its side before flipping to the other (default 220px). */
  minSpace?: number;
  /** On phones, slide up from the bottom of the screen as a sheet instead of hanging off the trigger. */
  sheetOnMobile?: boolean;
  className?: string;
  label?: string;
  id?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Position | null>(null);

  const update = useCallback(() => {
    if (!anchor.current) return;
    if (sheetOnMobile && window.innerWidth < 640) {
      setPos({ left: 8, right: 8, bottom: 8, maxHeight: Math.round(window.innerHeight * 0.86), minWidth: 0, above: true, sheet: true });
      return;
    }
    setPos(compute(anchor.current, placement, panel.current?.offsetWidth ?? 0, matchWidth, maxHeight, minSpace));
  }, [anchor, placement, matchWidth, maxHeight, minSpace, sheetOnMobile]);

  useLayoutEffect(() => {
    if (!open) return;
    update();
    // Re-measure once the panel has its real width.
    const id = requestAnimationFrame(update);
    return () => cancelAnimationFrame(id);
  }, [open, update]);

  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const onMove = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [open, update, onClose, anchor]);

  return createPortal(
    <AnimatePresence>
      {open && pos?.sheet && (
        <motion.div key="scrim" className="fixed inset-0 z-[119] bg-black/30 backdrop-blur-[1px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} aria-hidden />
      )}
      {open && pos && (
        <motion.div
          key="panel"
          ref={panel}
          id={id}
          aria-label={label}
          className={cx(
            'fixed z-[120] overflow-hidden rounded-2xl border border-line bg-paper/95 p-1.5 text-ink shadow-[var(--shadow-pop)] backdrop-blur-xl',
            className,
            pos.sheet && 'w-auto! rounded-3xl',
          )}
          style={{ left: pos.left, right: pos.right, top: pos.top, bottom: pos.bottom, minWidth: pos.minWidth, transformOrigin: pos.above ? 'bottom center' : 'top center' }}
          initial={pos.sheet ? { opacity: 0, y: 48 } : { opacity: 0, y: pos.above ? 6 : -6, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={pos.sheet ? { opacity: 0, y: 40, transition: { duration: 0.18 } } : { opacity: 0, y: pos.above ? 4 : -4, scale: 0.97, transition: { duration: 0.12 } }}
          transition={pos.sheet ? { type: 'spring', stiffness: 420, damping: 38 } : { type: 'spring', stiffness: 560, damping: 36, mass: 0.7 }}
        >
          {typeof children === 'function' ? children({ maxHeight: pos.maxHeight, above: pos.above }) : children}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
