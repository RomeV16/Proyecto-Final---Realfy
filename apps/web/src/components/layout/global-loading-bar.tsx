'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { internalNavTarget, navProgress, usePendingPath } from './nav-progress';

/** Un cambio de pantalla más corto que esto no muestra la barra: se vería como un parpadeo. */
export const BAR_DELAY_MS = 160;
/** Lo que tarda en completarse y desvanecerse al llegar la pantalla nueva. */
const BAR_FINISH_MS = 320;
/** Si la pantalla nueva nunca llega (navegación cancelada), la barra no queda colgada. */
export const BAR_GIVE_UP_MS = 8000;

type Phase = 'idle' | 'armed' | 'running' | 'finishing';

/**
 * Barra fina de progreso arriba de la ventana durante un cambio de pantalla. Arranca con el clic
 * en un enlace interno y termina cuando cambia la ruta. Se monta una vez en el layout del panel.
 */
export function GlobalLoadingBar() {
  const pathname = usePathname();
  const pending = usePendingPath() !== null;
  const [phase, setPhase] = useState<Phase>('idle');

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = internalNavTarget(event, window.location);
      if (target) navProgress.start(target);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  // La ruta cambió: la pantalla nueva ya está a la vista.
  useEffect(() => {
    navProgress.done();
  }, [pathname]);

  useEffect(() => {
    if (!pending) {
      setPhase((current) => (current === 'running' ? 'finishing' : 'idle'));
      return;
    }
    const show = setTimeout(() => setPhase('armed'), BAR_DELAY_MS);
    const giveUp = setTimeout(() => navProgress.done(), BAR_GIVE_UP_MS);
    return () => {
      clearTimeout(show);
      clearTimeout(giveUp);
    };
  }, [pending]);

  // `armed` pinta la barra en cero; el cuadro siguiente la pone a avanzar, así el ancho transiciona.
  useEffect(() => {
    if (phase === 'armed') {
      const frame = requestAnimationFrame(() => setPhase('running'));
      return () => cancelAnimationFrame(frame);
    }
    if (phase === 'finishing') {
      const timer = setTimeout(() => setPhase('idle'), BAR_FINISH_MS);
      return () => clearTimeout(timer);
    }
  }, [phase]);

  if (phase === 'idle') return null;

  const width = phase === 'armed' ? 0 : phase === 'running' ? 80 : 100;

  return (
    <div
      role="progressbar"
      aria-label="Cargando página"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={width}
      className="pointer-events-none fixed inset-x-0 top-0 z-[9999] h-0.5 print:hidden"
    >
      <div
        className="h-full bg-brand-500"
        style={{
          width: `${width}%`,
          opacity: phase === 'finishing' ? 0 : 1,
          transition:
            phase === 'finishing'
              ? 'width 160ms ease-out, opacity 160ms ease-out 160ms'
              : 'width 2500ms cubic-bezier(0.1, 0.7, 0.2, 1)',
        }}
      />
    </div>
  );
}
