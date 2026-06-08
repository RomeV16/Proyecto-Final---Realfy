'use client';

import { useLinkStatus } from 'next/link';
import { useEffect, useRef, useState } from 'react';

/**
 * Thin progress bar at the top of the viewport that animates during
 * route transitions. Uses brand color tokens — no inline hex values.
 *
 * Rendered once in the (app) layout.
 */
export function GlobalLoadingBar() {
  const { pending } = useLinkStatus();
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const rafRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (pending) {
      // Show bar and animate to ~80% quickly, then slow down
      setVisible(true);
      setWidth(0);

      // rAF chain: jump to 30%, ease toward 75%
      rafRef.current = requestAnimationFrame(() => {
        setWidth(30);
        timerRef.current = setTimeout(() => setWidth(75), 100);
      });
    } else {
      // Complete to 100%, then fade out
      setWidth(100);
      timerRef.current = setTimeout(() => {
        setVisible(false);
        setWidth(0);
      }, 300);
    }

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [pending]);

  if (!visible && width === 0) return null;

  return (
    <div
      role="progressbar"
      aria-label="Cargando página"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={width}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        height: '2px',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          height: '100%',
          width: `${width}%`,
          background: 'var(--color-brand-500)',
          boxShadow: '0 0 6px var(--color-brand-400)',
          transition:
            width === 100
              ? 'width 200ms ease-in'
              : 'width 400ms cubic-bezier(0.4, 0, 0.2, 1)',
          opacity: visible ? 1 : 0,
        }}
      />
    </div>
  );
}
