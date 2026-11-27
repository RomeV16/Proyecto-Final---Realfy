'use client';

import { useCallback, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'realfy.nav.collapsed';
const EMPTY: readonly string[] = [];

let collapsed: readonly string[] | null = null;
const listeners = new Set<() => void>();

function read(): readonly string[] {
  if (collapsed) return collapsed;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    collapsed = Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : EMPTY;
  } catch {
    collapsed = EMPTY;
  }
  return collapsed;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function toggleSection(key: string) {
  const current = read();
  collapsed = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(collapsed));
  } catch {
    // Sin almacenamiento (modo privado) el estado dura lo que dura la pestaña.
  }
  listeners.forEach((notify) => notify());
}

/** Solo para pruebas: olvida lo leído del almacenamiento. */
export function resetNavCollapse() {
  collapsed = null;
}

/**
 * Secciones del menú que el usuario plegó. Se guarda en el navegador y lo
 * comparten la barra lateral y el cajón móvil, así que plegar en uno se ve en el otro.
 */
export function useNavCollapse() {
  const keys = useSyncExternalStore(subscribe, read, () => EMPTY);
  const isCollapsed = useCallback((key: string) => keys.includes(key), [keys]);
  return { isCollapsed, toggle: toggleSection };
}
