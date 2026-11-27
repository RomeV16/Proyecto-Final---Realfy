'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

interface RevealProps {
  children: ReactNode;
  className?: string;
  /** Stagger index — multiplies a 70ms delay. */
  delay?: number;
  /** Add a blur-in on top of the slide. */
  blur?: boolean;
  once?: boolean;
}

/**
 * Scroll-reveal wrapper. Fades + slides its content in when it enters the
 * viewport. Respects prefers-reduced-motion via the global .reveal styles.
 */
export function Reveal({
  children,
  className = '',
  delay = 0,
  blur = false,
  once = true,
}: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          if (once) io.disconnect();
        } else if (!once) {
          setVisible(false);
        }
      },
      // Umbral 0: un bloque mucho más alto que la ventana nunca llega a tener una fracción fija a la
      // vista y quedaría invisible. El margen inferior hace que aparezca recién al asomar un poco.
      { threshold: 0, rootMargin: '0px 0px -8% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [once]);

  return (
    <div
      ref={ref}
      style={{ ['--reveal-i' as string]: delay }}
      className={`reveal ${blur ? 'reveal-blur' : ''} ${visible ? 'in-view' : ''} ${className}`}
    >
      {children}
    </div>
  );
}
