'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import type { RepairPerson } from '@/lib/ticket-repairs';

/**
 * Proveedores y personas para elegir en los formularios de la reparación (quién presupuesta y quién
 * aprueba). Se piden una vez, cuando la persona puede gestionar el caso.
 */
export function useRepairPeople(enabled: boolean) {
  const [providers, setProviders] = useState<RepairPerson[]>([]);
  const [people, setPeople] = useState<RepairPerson[]>([]);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const [p, q] = await Promise.all([
          apiClient<{ data: RepairPerson[] }>('/providers?limit=100'),
          apiClient<{ items: RepairPerson[] }>('/persons?limit=100&sortBy=lastName&sortOrder=asc'),
        ]);
        if (cancelled) return;
        setProviders(p?.data ?? []);
        setPeople(q?.items ?? []);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { providers, people, error };
}
