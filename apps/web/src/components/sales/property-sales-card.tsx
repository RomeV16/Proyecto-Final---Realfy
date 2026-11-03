'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@/i18n/navigation';
import { apiClient } from '@/lib/api-client';
import { useCan } from '@/lib/permissions';
import type { SalesOperation } from '@/lib/sales';
import { Button } from '@/components/ui/button';
import { DateText } from '@/components/ui/date-text';
import { MoneyText } from '@/components/ui/money-text';
import { StatusBadge } from '@/components/ui/status-badge';
import { SalesCreateDialog } from './sales-create-dialog';

const OPEN = ['Captacion', 'Publicada', 'Reservada', 'SenaRecibida', 'Boleto'];

interface Props {
  property: { id: string; title: string; street?: string | null; number?: string | null };
}

/** Ventas de la propiedad: la operación abierta y el historial, con el acceso a iniciar una venta. */
export function PropertySalesCard({ property }: Props) {
  const t = useTranslations('sales');
  const canView = useCan('sales.view');
  const canManage = useCan('sales.manage');
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const query = useQuery({
    queryKey: ['sales', 'property', property.id],
    queryFn: () => apiClient<{ items: SalesOperation[] }>(`/properties/${property.id}/sales-operations`),
    enabled: canView,
  });

  if (!canView) return null;
  const items = query.data?.items ?? [];
  const hasOpen = items.some((op) => OPEN.includes(op.status));

  return (
    <div className="space-y-3">
      {canManage && !hasOpen && query.data && (
        <Button type="button" size="sm" variant="secondary" onClick={() => setCreating(true)}>
          {t('property.start')}
        </Button>
      )}
      {query.data && items.length === 0 && <p className="text-sm text-[var(--color-muted)]">{t('property.none')}</p>}
      <ul className="space-y-2">
        {items.map((op) => (
          <li key={op.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm">
            <Link href={`/ventas/${op.id}`} className="font-medium text-[var(--color-text)] underline-offset-2 hover:underline">
              {t('property.operation')}
            </Link>
            <StatusBadge domain="venta" status={op.status} />
            {(op.agreedPrice ?? op.price) && <MoneyText value={op.agreedPrice ?? op.price} currency={op.currency} decimals={0} className="tabular-nums" />}
            {op.escrituraDate && (
              <span className="text-xs text-[var(--color-muted)]">
                {t('detail.escrituraDate')} <DateText value={op.escrituraDate} />
              </span>
            )}
          </li>
        ))}
      </ul>
      {creating && (
        <SalesCreateDialog
          property={property}
          onClose={() => setCreating(false)}
          onDone={() => void queryClient.invalidateQueries({ queryKey: ['sales'] })}
        />
      )}
    </div>
  );
}
