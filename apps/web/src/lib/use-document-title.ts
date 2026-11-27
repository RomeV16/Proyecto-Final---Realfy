'use client';

import { useEffect } from 'react';

/** Título de la pestaña: "Contratos · Realfy". Sin título no toca nada. */
export function useDocumentTitle(title?: string | null): void {
  useEffect(() => {
    if (title) document.title = `${title} · Realfy`;
  }, [title]);
}
