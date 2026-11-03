'use client';

import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import {
  BILL_DOCUMENTS_PATH,
  confidencePercent,
  isReviewable,
  periodMonth,
  type BillDocumentDetail,
} from '@/lib/bill-documents';
import { useCan } from '@/lib/permissions';
import { DateText } from '@/components/ui/date-text';
import { ErrorNotice } from '@/components/ui/error-notice';
import { MoneyText } from '@/components/ui/money-text';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { ProviderText, ReasonText } from './bill-documents-screen';
import { ReviewActions } from './review-actions';

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">{label}</dt>
      <dd className="mt-0.5 text-sm text-[var(--color-text)]">{children}</dd>
    </div>
  );
}

/** El PDF original en un visor embebido; el enlace es temporal (10 minutos), así que se pide al abrir la pantalla. */
function PdfViewer({ id }: { id: string }) {
  const t = useTranslations('billDocuments.detail');
  const file = useQuery({
    queryKey: ['bill-documents', id, 'file'],
    queryFn: () => apiClient<{ url: string }>(`${BILL_DOCUMENTS_PATH}/${id}/file`),
    staleTime: 5 * 60_000,
    retry: false,
  });
  if (file.isPending) return <Skeleton className="h-[70vh] w-full" />;
  if (file.error || !file.data) return <p role="alert" className="text-sm text-[var(--color-danger)]">{t('fileError')}</p>;
  return (
    <div className="space-y-2">
      <iframe src={file.data.url} title={t('viewerTitle')} className="h-[70vh] w-full rounded-lg border border-[var(--color-border)] bg-white" />
      <a href={file.data.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-brand-600 hover:text-brand-700">
        {t('openFile')}
      </a>
    </div>
  );
}

function ReadData({ doc }: { doc: BillDocumentDetail }) {
  const t = useTranslations('billDocuments.detail');
  const tTypes = useTranslations('services.serviceTypes');
  const lines = doc.data?.lines ?? [];
  const warnings = doc.data?.warnings ?? [];
  const pct = confidencePercent(doc.confidence);
  const rejected = doc.status === 'Rechazada';
  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Fact label={t('provider')}>
          <ProviderText providerKey={doc.providerKey} />
        </Fact>
        <Fact label={t('account')}>{doc.accountNumber ?? t('unknown')}</Fact>
        <Fact label={t('confidence')}>{pct === null ? t('unknown') : `${pct} %`}</Fact>
        <Fact label={t('service')}>
          {doc.service ? [tTypes(doc.service.serviceType), doc.service.providerName].filter(Boolean).join(' · ') : t('noService')}
        </Fact>
        <Fact label={t('received')}>
          <DateText value={doc.createdAt} kind="datetime" />
        </Fact>
        {doc.reviewedAt && (
          <Fact label={t('reviewed')}>
            <DateText value={doc.reviewedAt} kind="datetime" />
          </Fact>
        )}
        {doc.reason && (
          <Fact label={rejected ? t('rejectionReason') : t('reason')}>
            <ReasonText reason={doc.reason} />
          </Fact>
        )}
      </dl>

      {warnings.length > 0 && (
        <section aria-label={t('warnings')}>
          <h3 className="text-sm font-semibold text-[var(--color-text)]">{t('warnings')}</h3>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-[var(--color-muted)]">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label={t('lines')}>
        <h3 className="text-sm font-semibold text-[var(--color-text)]">{t('lines')}</h3>
        {lines.length === 0 ? (
          <p className="mt-1 text-sm text-[var(--color-muted)]">{t('noLines')}</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-[var(--color-muted)]">
                <tr>
                  <th scope="col" className="pb-1 pr-3 font-medium">{t('line.period')}</th>
                  <th scope="col" className="pb-1 pr-3 font-medium">{t('line.installment')}</th>
                  <th scope="col" className="pb-1 pr-3 text-right font-medium">{t('line.amount')}</th>
                  <th scope="col" className="pb-1 font-medium">{t('line.dueDate')}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={`${line.period}-${line.installmentLabel}-${line.amount}`} className="border-t border-[var(--color-border)]">
                    <td className="py-1.5 pr-3">{periodMonth(line.period)}</td>
                    <td className="py-1.5 pr-3">{line.installmentLabel ?? '—'}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums"><MoneyText value={line.amount} /></td>
                    <td className="py-1.5">{line.dueDate ? <DateText value={line.dueDate} /> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {doc.bills.length > 0 && (
        <section aria-label={t('createdBills')}>
          <h3 className="text-sm font-semibold text-[var(--color-text)]">{t('createdBills')}</h3>
          <ul className="mt-1 space-y-0.5 text-sm">
            {doc.bills.map((bill) => (
              <li key={bill.id}>
                {bill.installmentLabel} · <MoneyText value={bill.amount} />
              </li>
            ))}
          </ul>
          <Link href="/boletas" className="mt-2 inline-block text-sm font-medium text-brand-600 hover:text-brand-700">
            {t('goToBills')}
          </Link>
        </section>
      )}
    </div>
  );
}

/** Un documento recibido: el PDF al lado de lo leído, y la revisión (aceptar con correcciones o rechazar). */
export function BillDocumentDetailScreen({ id }: { id: string }) {
  const t = useTranslations('billDocuments');
  const canView = useCan('billDocuments.view');
  const canReview = useCan('serviceBills.manage');
  const queryClient = useQueryClient();
  const doc = useQuery({
    queryKey: ['bill-documents', id],
    queryFn: () => apiClient<BillDocumentDetail>(`${BILL_DOCUMENTS_PATH}/${id}`),
    enabled: canView,
    retry: false,
  });

  if (!canView) return <p className="text-sm text-[var(--color-muted)]">{t('forbidden')}</p>;

  const back = (
    <Link href="/boletas/recibidas" className="text-sm font-medium text-brand-600 hover:text-brand-700">
      {t('back')}
    </Link>
  );
  if (doc.isPending) return <Skeleton className="h-96 w-full" />;
  if (doc.error || !doc.data) {
    const missing = doc.error instanceof ApiRequestError && doc.error.status === 404;
    return (
      <div className="space-y-3">
        {back}
        {missing ? <p className="text-sm text-[var(--color-muted)]">{t('notFound')}</p> : <ErrorNotice error={doc.error} fallback={t('detailLoadError')} />}
      </div>
    );
  }

  const data = doc.data;
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['bill-documents'] });
  };

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        {back}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="h1">{data.fileName ?? data.origin ?? t('detail.title')}</h1>
          <StatusBadge domain="boletaRecibida" status={data.status} size="md" />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section aria-labelledby="bill-viewer-title" className="space-y-2">
          <h2 id="bill-viewer-title" className="text-base font-semibold text-[var(--color-text)]">{t('detail.viewer')}</h2>
          {data.hasFile ? <PdfViewer id={id} /> : <p className="text-sm text-[var(--color-muted)]">{t('detail.noFile')}</p>}
        </section>

        <div className="space-y-6">
          <section aria-labelledby="bill-read-title" className="space-y-3">
            <h2 id="bill-read-title" className="text-base font-semibold text-[var(--color-text)]">{t('detail.read')}</h2>
            <ReadData doc={data} />
          </section>

          {isReviewable(data.status) && (
            <section aria-labelledby="bill-review-title" className="space-y-3 rounded-xl border border-[var(--color-border)] p-4">
              <h2 id="bill-review-title" className="text-base font-semibold text-[var(--color-text)]">{t('review.title')}</h2>
              {canReview ? (
                <>
                  <p className="text-sm text-[var(--color-muted)]">{t('review.intro')}</p>
                  <ReviewActions document={data} onDone={refresh} />
                </>
              ) : (
                <p className="text-sm text-[var(--color-muted)]">{t('review.readOnly')}</p>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

