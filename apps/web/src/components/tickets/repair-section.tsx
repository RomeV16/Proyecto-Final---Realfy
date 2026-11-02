'use client';

import { useTranslations } from 'next-intl';
import type { RepairTicket } from '@/lib/ticket-repairs';
import { useCan } from '@/lib/permissions';
import { ErrorNotice } from '@/components/ui/error-notice';
import { RepairAuthorization } from './repair-authorization';
import { RepairPayments } from './repair-payments';
import { RepairQuotes } from './repair-quotes';
import { RepairStepper } from './repair-stepper';
import { useRepairPeople } from './use-repair-options';

interface Props {
  ticket: RepairTicket;
  onChanged: () => void;
}

/**
 * Reparación de una incidencia: el avance por etapas, la preautorización del locador, los
 * presupuestos, el pago al proveedor y la imputación del gasto. Quien solo mira ve el recorrido y
 * las tablas; los formularios aparecen según el permiso (gestionar el caso, o cobranza).
 */
export function RepairSection({ ticket, onChanged }: Props) {
  const t = useTranslations('tickets.repair');
  const canManage = useCan('tickets.manage');
  const canPay = useCan('tickets.pay');
  const { providers, people, error } = useRepairPeople(canManage);

  return (
    <div className="space-y-6">
      <section aria-labelledby="repair-stepper-title" className="card-lux space-y-3 p-6">
        <div>
          <p className="eyebrow">{t('eyebrow')}</p>
          <h2 id="repair-stepper-title" className="h3">
            {t('title')}
          </h2>
        </div>
        <RepairStepper status={ticket.status} />
      </section>

      {error != null && <ErrorNotice error={error} fallback={t('optionsError')} />}
      <RepairAuthorization ticket={ticket} people={people} canManage={canManage} onChanged={onChanged} />
      <RepairQuotes ticket={ticket} providers={providers} people={people} canManage={canManage} onChanged={onChanged} />
      <RepairPayments ticket={ticket} canPay={canPay} onChanged={onChanged} />
    </div>
  );
}
