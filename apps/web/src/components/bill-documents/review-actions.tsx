'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ParsedBillLine } from '@realfy/shared';
import { apiClient } from '@/lib/api-client';
import { BILL_DOCUMENTS_PATH, periodMonth, type BillDocumentDetail } from '@/lib/bill-documents';
import { parseAmountInput } from '@/lib/service-bills';
import { Button } from '@/components/ui/button';
import { FieldsDialog, type FieldDef, type FieldValues } from '@/components/ui/fields-dialog';
import { ServicePicker } from './service-picker';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_REASON = 500;

/**
 * Lo que la API recibe al aceptar: el servicio y, para un documento de una sola boleta, lo que la persona cambió
 * respecto de lo leído (sin boleta leída, período e importe siempre). Con varias boletas no se corrige nada.
 */
export function acceptBody(
  serviceId: string,
  values: FieldValues,
  lines: readonly ParsedBillLine[],
): Record<string, unknown> {
  const body: Record<string, unknown> = { serviceId };
  if (lines.length > 1) return body;
  const read = lines[0];
  const amount = parseAmountInput(values.amount ?? '') ?? '';
  const differs = (value: string, original: string | null | undefined) => value !== '' && value !== (original ?? '');
  if (!read || differs(values.period, periodMonth(read.period))) body.period = values.period;
  if (differs(values.installmentLabel, read?.installmentLabel)) body.installmentLabel = values.installmentLabel;
  if (!read || (amount !== '' && Number(amount) !== Number(read.amount))) body.amount = amount;
  const dueDate = values.dueDate || null;
  if (dueDate !== (read?.dueDate ?? null)) body.dueDate = dueDate;
  return body;
}

/** Aceptar (con correcciones) o rechazar un documento que espera revisión. */
export function ReviewActions({ document, onDone }: { document: BillDocumentDetail; onDone: () => void }) {
  const t = useTranslations('billDocuments.review');
  const [dialog, setDialog] = useState<'accept' | 'reject' | null>(null);
  const close = () => setDialog(null);

  return (
    <div className="flex flex-wrap gap-3">
      <Button type="button" onClick={() => setDialog('accept')}>
        {t('accept')}
      </Button>
      <Button type="button" variant="secondary" onClick={() => setDialog('reject')}>
        {t('reject')}
      </Button>
      {dialog === 'accept' && <AcceptDialog document={document} onClose={close} onDone={onDone} />}
      {dialog === 'reject' && <RejectDialog id={document.id} onClose={close} onDone={onDone} />}
    </div>
  );
}

function AcceptDialog({ document, onClose, onDone }: { document: BillDocumentDetail; onClose: () => void; onDone: () => void }) {
  const t = useTranslations('billDocuments.review');
  const lines = document.data?.lines ?? [];
  const read = lines.length === 1 ? lines[0] : undefined;
  const single = lines.length <= 1;
  const [serviceId, setServiceId] = useState(document.serviceId ?? '');

  const fields: FieldDef[] = single
    ? [
        { name: 'period', label: t('period'), required: !read, validate: (v) => (PERIOD.test(v) ? null : t('periodInvalid')) },
        { name: 'installmentLabel', label: t('installment') },
        { name: 'amount', label: t('amount'), kind: 'amount', required: !read },
        { name: 'dueDate', label: t('dueDate'), kind: 'date' },
      ]
    : [];
  const initial: FieldValues = read
    ? {
        period: periodMonth(read.period),
        installmentLabel: read.installmentLabel ?? '',
        amount: String(Number(read.amount)),
        dueDate: read.dueDate ?? '',
      }
    : {};

  return (
    <FieldsDialog
      title={t('acceptTitle')}
      description={t('acceptDescription')}
      fields={fields}
      initial={initial}
      submitLabel={t('acceptSubmit')}
      successMessage={t('accepted')}
      errorFallback={t('acceptError')}
      extra={
        <>
          <ServicePicker value={serviceId} onChange={setServiceId} />
          {!single && <p className="text-sm text-[var(--color-muted)]">{t('multiBillHint')}</p>}
        </>
      }
      precheck={() => (serviceId ? null : t('serviceRequired'))}
      request={(values) =>
        apiClient(`${BILL_DOCUMENTS_PATH}/${document.id}/accept`, {
          method: 'POST',
          body: JSON.stringify(acceptBody(serviceId, values, lines)),
        })}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

function RejectDialog({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const t = useTranslations('billDocuments.review');
  return (
    <FieldsDialog
      title={t('rejectTitle')}
      description={t('rejectDescription')}
      fields={[{ name: 'reason', label: t('rejectReason'), kind: 'textarea', required: true, hint: t('rejectReasonHint'), validate: (v) => (v.length > MAX_REASON ? t('rejectReasonTooLong') : null) }]}
      submitLabel={t('rejectSubmit')}
      successMessage={t('rejected')}
      errorFallback={t('rejectError')}
      request={(values) =>
        apiClient(`${BILL_DOCUMENTS_PATH}/${id}/reject`, {
          method: 'POST',
          body: JSON.stringify({ reason: values.reason }),
        })}
      onClose={onClose}
      onDone={onDone}
    />
  );
}
