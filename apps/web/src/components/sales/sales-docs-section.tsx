'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import type { SalesOperation } from '@/lib/sales';
import { toast } from '@/lib/toast';

interface Props {
  op: SalesOperation;
  canManage: boolean;
  onChanged: () => void;
}

const OPEN = ['Captacion', 'Publicada', 'Reservada', 'SenaRecibida', 'Boleto'];

/** Documentación del inmueble (informes de dominio e inhibición, libre deuda, catastro...): se tilda a medida que llega. */
export function SalesDocsSection({ op, canManage, onChanged }: Props) {
  const t = useTranslations('sales.docs');
  const [busy, setBusy] = useState<string | null>(null);
  const editable = canManage && OPEN.includes(op.status);

  async function toggle(code: string, done: boolean) {
    setBusy(code);
    try {
      await apiClient(`/sales-operations/${op.id}/docs/${code}`, { method: 'PATCH', body: JSON.stringify({ done }) });
      onChanged();
    } catch {
      toast.error(t('error'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="sales-docs-title" className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <h2 id="sales-docs-title" className="text-base font-semibold text-[var(--color-text)]">
        {t('title')}
      </h2>
      <p className="mt-1 text-sm text-[var(--color-muted)]">
        {t('progress', { done: op.docProgress.requiredDone, total: op.docProgress.requiredTotal })}
      </p>
      <ul className="mt-3 divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
        {op.docs.map((doc) => (
          <li key={doc.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <input
              id={`doc-${doc.code}`}
              type="checkbox"
              checked={doc.done}
              disabled={!editable || busy === doc.code}
              onChange={(e) => void toggle(doc.code, e.target.checked)}
              className="h-4 w-4 accent-[var(--color-brand-500)]"
            />
            <label htmlFor={`doc-${doc.code}`} className="flex-1 text-[var(--color-text)]">
              {t(`items.${doc.code}`)}
            </label>
            <span className="text-xs text-[var(--color-muted)]">{doc.required ? t('required') : t('optional')}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
