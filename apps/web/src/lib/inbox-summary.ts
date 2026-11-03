import { useEffect, useSyncExternalStore } from 'react';
import { apiClient } from '@/lib/api-client';
import type { InboxSummary } from '@/lib/inbox';

/** Cada cuánto se vuelve a preguntar por los contadores del menú. */
const REFRESH_MS = 60_000;

const EMPTY: InboxSummary = { unread: 0, breached: 0, unassigned: 0 };

let snapshot: InboxSummary = EMPTY;
let timer: ReturnType<typeof setInterval> | null = null;
let subscribers = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Vuelve a leer los contadores (la bandeja lo llama después de leer, responder o asignar). */
export async function refreshInboxSummary(): Promise<void> {
  try {
    const next = await apiClient<InboxSummary>('/conversations/summary');
    if (
      next.unread !== snapshot.unread ||
      next.breached !== snapshot.breached ||
      next.unassigned !== snapshot.unassigned
    ) {
      snapshot = next;
      emit();
    }
  } catch {
    // Un contador que no se pudo leer no rompe el menú: conserva el último valor.
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Contadores de la bandeja para el menú, compartidos por todos los lugares que los muestran (una sola consulta cada minuto). */
export function useInboxSummary(enabled: boolean): InboxSummary {
  const value = useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => EMPTY,
  );
  useEffect(() => {
    if (!enabled) return;
    subscribers += 1;
    if (subscribers === 1) {
      void refreshInboxSummary();
      timer = setInterval(() => void refreshInboxSummary(), REFRESH_MS);
    }
    return () => {
      subscribers -= 1;
      if (subscribers === 0 && timer) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, [enabled]);
  return enabled ? value : EMPTY;
}

/** Para las pruebas: vuelve al estado inicial. */
export function resetInboxSummary(): void {
  snapshot = EMPTY;
  emit();
}
