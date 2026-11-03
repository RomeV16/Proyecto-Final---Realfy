'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';

/**
 * Lee una ruta de la API y la vuelve a leer con `reload`. Con `path` null no consulta (sin permiso o con el
 * diálogo cerrado). No usa react-query: se monta dentro de pantallas que no siempre tienen su proveedor.
 */
export function useApiData<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiClient<T>(path);
        if (cancelled) return;
        setData(res);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error, reload, setData };
}
