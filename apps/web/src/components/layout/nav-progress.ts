'use client';

import { useSyncExternalStore } from 'react';
import { routing } from '@/i18n/routing';

const LOCALES: readonly string[] = routing.locales;

/** Ruta de destino (sin prefijo de idioma) de un cambio de pantalla que todavía no terminó. */
let pending: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((notify) => notify());

/** `/es/contracts/1` -> `/contracts/1`. */
export function stripLocale(pathname: string): string {
  const parts = pathname.split('/');
  if (!LOCALES.includes(parts[1])) return pathname || '/';
  return `/${parts.slice(2).join('/')}`;
}

export const navProgress = {
  /** Empezó un cambio de pantalla hacia `pathname` (con o sin prefijo de idioma). */
  start(pathname: string) {
    pending = stripLocale(pathname);
    emit();
  },
  /** La pantalla nueva ya está a la vista (o se desistió). */
  done() {
    if (pending === null) return;
    pending = null;
    emit();
  },
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Ruta hacia la que se está navegando, o null si no hay un cambio de pantalla en curso. */
export function usePendingPath(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => pending,
    () => null,
  );
}

/**
 * Ruta a la que lleva un clic, si es un clic simple sobre un enlace interno que cambia de
 * pantalla. Devuelve null para clics con tecla o botón secundario, enlaces que abren otra
 * pestaña, descargas, otros sitios y enlaces a la pantalla actual.
 */
export function internalNavTarget(
  event: Pick<MouseEvent, 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'target'>,
  current: Pick<Location, 'origin' | 'pathname'>,
): string | null {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  if (anchor.hasAttribute('download')) return null;
  const target = anchor.getAttribute('target');
  if (target && target !== '_self') return null;
  let url: URL;
  try {
    url = new URL(anchor.href, current.origin);
  } catch {
    return null;
  }
  if (url.origin !== current.origin || url.pathname === current.pathname) return null;
  return url.pathname;
}
