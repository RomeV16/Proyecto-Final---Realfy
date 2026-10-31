'use client';

import { useEffect, useState } from 'react';
import { READ_RESOURCES, type ReadResource } from '@realfy/shared';
import { apiClient } from '@/lib/api-client';
import { useOptionalAuth } from '@/lib/auth-context';

export type ReadAccess = Record<ReadResource, boolean>;

interface ReadAccessResponse {
  role: string | null;
  resources: Partial<Record<ReadResource, boolean>>;
}

const DENIED = Object.fromEntries(READ_RESOURCES.map((r) => [r, false])) as ReadAccess;

const cache = new Map<string, Promise<ReadAccess>>();
/** Lo ya resuelto, para que un componente que se monta después lo lea sin esperar. */
const resolved = new Map<string, ReadAccess>();
const listeners = new Set<() => void>();

function load(key: string): Promise<ReadAccess> {
  let pending = cache.get(key);
  if (!pending) {
    pending = apiClient<ReadAccessResponse>('/tenants/me/read-access')
      .then(
        (res) =>
          Object.fromEntries(READ_RESOURCES.map((r) => [r, res.resources[r] === true])) as ReadAccess,
      )
      .then((access) => {
        if (cache.get(key) === pending) resolved.set(key, access);
        return access;
      })
      .catch(() => {
        // Si no se puede saber qué puede leer el rol, se oculta; el próximo
        // montaje vuelve a intentarlo.
        cache.delete(key);
        return DENIED;
      });
    cache.set(key, pending);
  }
  return pending;
}

/** Descarta lo consultado (por ejemplo, tras guardar la política) y avisa a quienes lo usan. */
export function invalidateReadAccess(): void {
  cache.clear();
  resolved.clear();
  listeners.forEach((notify) => notify());
}

/**
 * Qué recursos sensibles puede leer el rol del usuario de la sesión, según la
 * política de su inmobiliaria. Es `null` mientras se consulta. La API es la que
 * impone la política; esto solo decide qué muestra la web.
 */
export function useReadAccess(): ReadAccess | null {
  const user = useOptionalAuth()?.user;
  const key = user ? `${user.id}:${user.role}` : null;
  const [state, setState] = useState<{ key: string | null; access: ReadAccess | null }>({
    key: null,
    access: null,
  });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const notify = () => setVersion((v) => v + 1);
    listeners.add(notify);
    return () => {
      listeners.delete(notify);
    };
  }, []);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    void load(key).then((access) => {
      if (!cancelled) setState({ key, access });
    });
    return () => {
      cancelled = true;
    };
  }, [key, version]);

  if (!key) return DENIED;
  return resolved.get(key) ?? (state.key === key ? state.access : null);
}
