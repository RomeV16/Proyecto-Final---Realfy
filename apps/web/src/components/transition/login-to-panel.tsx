'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import { transition, useTransitionState } from '@/lib/transition-store';

const EASE = [0.22, 1, 0.36, 1] as const;

const NAV = [
  'Panel',
  'Propiedades',
  'Personas',
  'Contratos',
  'Liquidaciones',
  'Pagos',
  'Morosos',
  'Tickets',
];

/**
 * Cinematic login → panel transition. Mounted once per locale layout but backed
 * by a module store, so it survives the auth → app route change. The panel
 * assembles (sidebar slides in, header drops, welcome + cards rise in stagger)
 * over an opaque warm cover while the real dashboard loads underneath, then it
 * fades away to reveal it.
 */
export function LoginToPanel() {
  const { active, data, runId } = useTransitionState();

  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => transition.end(), 1900);
    return () => clearTimeout(t);
  }, [active, runId]);

  const firstName = data.firstName || '';
  const initial = (firstName[0] || 'R').toUpperCase();

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          key={`ltp-${runId}`}
          className="fixed inset-0 z-[200] flex overflow-hidden bg-[var(--color-bg)]"
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.6, ease: EASE } }}
        >
          {/* Sidebar assembling */}
          <motion.aside
            className="hidden lg:flex flex-col w-64 shrink-0 text-[#cabda6]"
            style={{ background: 'var(--color-sidebar-bg)' }}
            initial={{ x: -60, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: 0.7, delay: 0.15, ease: EASE }}
          >
            <motion.div
              className="flex items-center gap-2.5 px-5 h-16"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.4, ease: EASE }}
            >
              <span className="w-8 h-8 rounded-md bg-brand-500 flex items-center justify-center text-white font-display italic text-base">
                R
              </span>
              <span className="font-display italic text-[1.3rem] leading-none text-[#f0e6d4]">
                Realfy
              </span>
            </motion.div>

            <div className="px-3 py-5 space-y-0.5">
              {NAV.map((label, i) => (
                <motion.div
                  key={label}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm"
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: i === 0 ? 1 : 0.7, x: 0 }}
                  transition={{ duration: 0.4, delay: 0.55 + i * 0.05, ease: EASE }}
                >
                  <span
                    className={`w-[18px] h-[18px] rounded ${
                      i === 0 ? 'bg-brand-500' : 'bg-white/15'
                    }`}
                  />
                  <span className={i === 0 ? 'text-white font-medium' : ''}>
                    {label}
                  </span>
                </motion.div>
              ))}
            </div>
          </motion.aside>

          {/* Main column assembling */}
          <div className="flex-1 flex flex-col min-w-0">
            <motion.div
              className="h-16 border-b border-[var(--color-border)] flex items-center justify-end px-6 gap-3 shrink-0"
              initial={{ opacity: 0, y: -22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.6, ease: EASE }}
            >
              <span className="w-9 h-9 rounded-lg bg-[var(--color-surface-sunken)]" />
              <span className="w-8 h-8 rounded-full bg-brand-500 flex items-center justify-center text-white text-xs font-semibold">
                {initial}
              </span>
            </motion.div>

            <div className="flex-1 p-6 lg:p-8 space-y-6">
              <div>
                <motion.p
                  className="eyebrow mb-3"
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.78, ease: EASE }}
                >
                  Centro de operaciones
                </motion.p>
                <motion.h1
                  className="h1"
                  initial={{ opacity: 0, y: 18, filter: 'blur(8px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  transition={{ duration: 0.85, delay: 0.9, ease: EASE }}
                >
                  Bienvenido{firstName ? `, ${firstName}` : ''}
                </motion.h1>
              </div>

              <motion.div
                className="card-lux h-44"
                initial={{ opacity: 0, y: 28 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 1.12, ease: EASE }}
              />

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[0, 1, 2, 3].map((i) => (
                  <motion.div
                    key={i}
                    className="card-lux h-28"
                    initial={{ opacity: 0, y: 22 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, delay: 1.28 + i * 0.09, ease: EASE }}
                  />
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
