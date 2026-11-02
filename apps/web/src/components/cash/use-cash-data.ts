'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import type { AccountsResponse } from '@/lib/cash';

/**
 * Cuentas de la inmobiliaria con su saldo y los totales por moneda. `includeInactive` trae también las dadas de
 * baja (la pantalla de caja las muestra para reactivarlas; los formularios usan solo las activas).
 */
export function useCashAccounts(enabled: boolean, includeInactive = false) {
  const [data, setData] = useState<AccountsResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiClient<AccountsResponse>(`/financial-accounts${includeInactive ? '?includeInactive=true' : ''}`);
        if (cancelled) return;
        setData({ items: res?.items ?? [], totals: res?.totals ?? [], custodyInAgencyBalance: !!res?.custodyInAgencyBalance });
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, includeInactive, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error, reload };
}

export interface ContractOption {
  id: string;
  label: string;
}

/** Contratos activos para elegir uno (opcional) en un movimiento o en el filtro del libro. */
export function useContractOptions(enabled: boolean) {
  const [contracts, setContracts] = useState<ContractOption[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiClient<{ items: { id: string; startDate: string; property?: { title: string } | null }[] }>(
          '/contracts?status=Activo&limit=100',
        );
        if (cancelled) return;
        setContracts(
          (res?.items ?? []).map((c) => ({ id: c.id, label: `${c.property?.title ?? c.id} · ${c.startDate.slice(0, 7)}` })),
        );
      } catch {
        if (!cancelled) setContracts([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return contracts;
}

/** Texto de un error para un aviso breve: la versión traducida del código si existe, o el mensaje de la API. */
export function useErrorText() {
  const t = useTranslations('errors');
  return useCallback(
    (err: unknown, fallback: string) => {
      if (!(err instanceof ApiRequestError)) return fallback;
      return err.errorCode && t.has(`codes.${err.errorCode}`) ? t(`codes.${err.errorCode}`) : err.message || fallback;
    },
    [t],
  );
}
