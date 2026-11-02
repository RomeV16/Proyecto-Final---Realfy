'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';

export interface ChargeContractOption {
  id: string;
  propertyId: string;
  label: string;
}

export interface ChargePropertyOption {
  id: string;
  title: string;
}

interface ContractItem {
  id: string;
  startDate: string;
  property?: { id: string; title: string } | null;
}

/** Contratos activos y propiedades a los que se puede cargar un gasto. */
export function useChargeTargets(enabled = true) {
  const [contracts, setContracts] = useState<ChargeContractOption[]>([]);
  const [properties, setProperties] = useState<ChargePropertyOption[]>([]);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const [c, p] = await Promise.all([
          apiClient<{ items: ContractItem[] }>('/contracts?status=Activo&limit=100'),
          apiClient<{ items: ChargePropertyOption[] }>('/properties?limit=100'),
        ]);
        if (cancelled) return;
        setContracts(
          c.items.map((item) => ({
            id: item.id,
            propertyId: item.property?.id ?? '',
            label: `${item.property?.title ?? item.id} · ${item.startDate.slice(0, 7)}`,
          })),
        );
        setProperties(p.items.map((item) => ({ id: item.id, title: item.title })));
      } catch (err) {
        if (!cancelled) setError(err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { contracts, properties, error };
}
