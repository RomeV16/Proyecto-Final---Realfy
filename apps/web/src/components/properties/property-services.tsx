'use client';

import { useCallback, useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/lib/toast';
import { useCan } from '@/lib/permissions';
import { formatMoney } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { EntityRow } from '@/components/ui/entity-card';
import { ErrorNotice } from '@/components/ui/error-notice';
import { Skeleton } from '@/components/ui/skeleton';
import { PropertyServiceDialog, type PropertyService } from './property-service-dialog';

interface Props {
  propertyId: string;
  /** Edificio al que pertenece la unidad: sus servicios se muestran aparte y sin edición. */
  parentPropertyId?: string | null;
}

const list = (propertyId: string) =>
  apiClient<{ items: PropertyService[] }>(`/services?propertyId=${propertyId}&limit=100`).then((r) => r.items);

/**
 * Servicios e impuestos de una propiedad o de un edificio: lista con los dados de baja, alta, edición, baja lógica y
 * reactivación. La API valida y normaliza la cuenta según el proveedor del catálogo (ADR-0018); acá solo se muestra
 * su error. Los de una unidad incluyen, aparte, los del edificio, que se editan desde su ficha.
 */
export function PropertyServices({ propertyId, parentPropertyId }: Props) {
  const t = useTranslations('propertyServices');
  const tTypes = useTranslations('services.serviceTypes');
  const canManage = useCan('services.manage');
  const canDelete = useCan('services.delete');
  const confirm = useConfirm();

  const [services, setServices] = useState<PropertyService[] | null>(null);
  const [inherited, setInherited] = useState<PropertyService[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [dialog, setDialog] = useState<{ service?: PropertyService } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setServices(await list(propertyId));
      setInherited(parentPropertyId ? (await list(parentPropertyId)).filter((s) => s.isActive) : []);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [propertyId, parentPropertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setActive(service: PropertyService, active: boolean) {
    if (!active && !(await confirm({ body: t('deactivateConfirm'), confirmLabel: t('deactivate'), tone: 'danger' }))) return;
    setBusyId(service.id);
    try {
      await apiClient(`/services/${service.id}`, active ? { method: 'PATCH', body: JSON.stringify({ isActive: true }) } : { method: 'DELETE' });
      toast.success(active ? t('reactivated') : t('deactivated'));
      await load();
    } catch {
      toast.error(t('actionError'));
    } finally {
      setBusyId(null);
    }
  }

  const row = (service: PropertyService, editable: boolean) => (
    <EntityRow
      key={service.id}
      accent={service.isActive ? 'none' : 'warning'}
      title={
        <span className="flex flex-wrap items-center gap-2">
          {tTypes(service.serviceType)}
          {!service.isActive && <Badge variant="neutral">{t('inactive')}</Badge>}
        </span>
      }
      subtitle={[
        service.providerName ?? t('noProvider'),
        service.accountNumber ? t('account', { account: service.accountNumber }) : t('noAccount'),
      ].join(' · ')}
      meta={
        <p className="text-xs text-[var(--color-muted)]">
          {[t('dueDay', { day: service.dueDay }), t(`frequencies.${service.billingFrequency}`), service.hasAnnualOption ? t('annualOption') : null]
            .filter(Boolean)
            .join(' · ')}
        </p>
      }
      trailing={<span className="text-sm font-semibold tabular-nums">{formatMoney(service.amount, service.currency)}</span>}
      actions={
        editable && (
          <>
            {canManage && service.isActive && (
              <EntityRow.Action onClick={() => setDialog({ service })} disabled={busyId === service.id}>
                {t('edit')}
              </EntityRow.Action>
            )}
            {canManage && !service.isActive && (
              <EntityRow.Action onClick={() => void setActive(service, true)} disabled={busyId === service.id}>
                {t('reactivate')}
              </EntityRow.Action>
            )}
            {canDelete && service.isActive && (
              <EntityRow.Action
                variant="quiet"
                className="hover:text-[var(--color-danger)]"
                onClick={() => void setActive(service, false)}
                disabled={busyId === service.id}
              >
                {t('deactivate')}
              </EntityRow.Action>
            )}
          </>
        )
      }
    />
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-prose text-sm text-[var(--color-muted)]">{t('subtitle')}</p>
        {canManage && (
          <Button type="button" size="sm" onClick={() => setDialog({})}>
            {t('add')}
          </Button>
        )}
      </div>

      {error != null && <ErrorNotice error={error} fallback={t('loadError')} />}
      {error == null && services === null && <Skeleton className="h-16 w-full" />}
      {services !== null && services.length === 0 && inherited.length === 0 && (
        <p className="text-sm italic text-[var(--color-muted)]">{t('empty')}</p>
      )}
      {services !== null && services.length > 0 && <div className="space-y-2">{services.map((s) => row(s, true))}</div>}

      {inherited.length > 0 && parentPropertyId && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-[var(--color-text)]">{t('inherited')}</h4>
            <Link href={`/properties/${parentPropertyId}`} className="text-xs font-medium text-[var(--color-brand-600)] hover:underline">
              {t('openBuilding')}
            </Link>
          </div>
          <p className="text-xs text-[var(--color-muted)]">{t('inheritedHint')}</p>
          {inherited.map((s) => row(s, false))}
        </div>
      )}

      {dialog && (
        <PropertyServiceDialog
          propertyId={propertyId}
          service={dialog.service}
          onClose={() => setDialog(null)}
          onDone={() => void load()}
        />
      )}
    </div>
  );
}
