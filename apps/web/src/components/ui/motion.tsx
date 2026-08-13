'use client';

import { motion, AnimatePresence, useReducedMotion, type Variants } from 'framer-motion';
import { cn } from '@/lib/cn';
import type { ReactNode } from 'react';

/**
 * Motion primitives for list/card surfaces.
 *
 * Two rules the whole card system follows:
 *
 * 1. Entrance is staggered but *capped*. A 60-row list must not take three
 *    seconds to finish appearing, so per-item delay saturates at STAGGER_CAP.
 * 2. Nothing ever hard-swaps. Loading → content → empty always crossfades
 *    through `ListTransition`, which also holds a min-height so the page
 *    doesn't jump when the skeleton is replaced.
 *
 * Every component here degrades to an instant, motionless render when the user
 * has `prefers-reduced-motion: reduce` set.
 */

const EASE_LUXE = [0.22, 1, 0.36, 1] as const;

const STAGGER_STEP = 0.045;
const STAGGER_CAP = 0.36;

/** Per-item entrance delay, saturating so long lists stay snappy. */
export function staggerDelay(index: number): number {
  return Math.min(index * STAGGER_STEP, STAGGER_CAP);
}

/* ──────────── Card / item entrance ──────────── */

interface StaggerItemProps {
  /** Position in the list — drives the entrance delay. */
  index?: number;
  children: ReactNode;
  className?: string;
}

/**
 * One card animating in. Wrap each item of a grid/list in this.
 * `layout` is on so filter changes reflow smoothly instead of snapping.
 */
export function StaggerItem({ index = 0, children, className }: StaggerItemProps) {
  const reduce = useReducedMotion();

  if (reduce) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      layout
      initial={{ opacity: 0, y: 14, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.99, transition: { duration: 0.18 } }}
      transition={{
        duration: 0.45,
        ease: EASE_LUXE,
        delay: staggerDelay(index),
      }}
    >
      {children}
    </motion.div>
  );
}

/** Simple one-shot reveal for section headers, toolbars, panels. */
export function FadeIn({
  children,
  className,
  delay = 0,
  y = 10,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
}) {
  const reduce = useReducedMotion();

  if (reduce) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE_LUXE, delay }}
    >
      {children}
    </motion.div>
  );
}

/* ──────────── Loading ⇄ content ⇄ empty ──────────── */

export type ListState = 'loading' | 'empty' | 'ready';

interface ListTransitionProps {
  state: ListState;
  /** Rendered while `state === 'loading'`. */
  skeleton: ReactNode;
  /** Rendered while `state === 'empty'`. */
  empty: ReactNode;
  /** Rendered while `state === 'ready'`. */
  children: ReactNode;
  /**
   * Floor height held during the swap so replacing a tall skeleton with a
   * short empty state doesn't yank the page. Defaults to none.
   */
  minHeight?: number | string;
  className?: string;
}

const fadeSwap: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.32, ease: EASE_LUXE } },
  exit: { opacity: 0, transition: { duration: 0.16, ease: 'easeOut' } },
};

/**
 * Crossfades between the three states of any list screen.
 *
 * `mode="wait"` guarantees the outgoing state is gone before the incoming one
 * mounts, which is what removes the double-render flash that the
 * `{loading && ...}{!loading && ...}` pattern produced.
 */
export function ListTransition({
  state,
  skeleton,
  empty,
  children,
  minHeight,
  className,
}: ListTransitionProps) {
  const reduce = useReducedMotion();
  const content = state === 'loading' ? skeleton : state === 'empty' ? empty : children;

  if (reduce) {
    return (
      <div className={className} style={{ minHeight }}>
        {content}
      </div>
    );
  }

  return (
    <div className={className} style={{ minHeight }}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={state} variants={fadeSwap} initial="initial" animate="animate" exit="exit">
          {content}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/**
 * Wraps the items of a list so removals/additions animate.
 * Pair with `StaggerItem` children that carry a stable `key`.
 */
export function AnimatedList({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();

  if (reduce) return <div className={className}>{children}</div>;

  return (
    <div className={className}>
      <AnimatePresence initial={false} mode="popLayout">
        {children}
      </AnimatePresence>
    </div>
  );
}

/* ──────────── Numeric flip ──────────── */

/**
 * Subtle slide/fade when a value changes, so metric tiles acknowledge updates
 * instead of silently swapping digits.
 */
export function ValueFlip({ value, className }: { value: string | number; className?: string }) {
  const reduce = useReducedMotion();

  if (reduce) return <span className={className}>{value}</span>;

  return (
    <span className={cn('inline-block', className)}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={String(value)}
          className="inline-block tabular-nums"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.28, ease: EASE_LUXE }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export { motion, AnimatePresence, useReducedMotion };
