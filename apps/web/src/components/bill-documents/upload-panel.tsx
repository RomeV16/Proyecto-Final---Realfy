'use client';

import { useRef, useState, type DragEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { apiErrorCode, pdfProblem, uploadBillFile, type UploadedBillResult } from '@/lib/bill-documents';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Spinner } from '@/components/ui/spinner';
import { StatusBadge } from '@/components/ui/status-badge';
import { cn } from '@/lib/cn';

type ItemState = 'uploading' | 'done' | 'error';

interface UploadItem {
  key: number;
  name: string;
  state: ItemState;
  /** Por qué no se subió (`notPdf`, `tooLarge`, `failed`) o el código de error de la API. */
  problem?: string;
  result?: UploadedBillResult;
}

let nextKey = 1;

/**
 * Subida de boletas en PDF: arrastrar y soltar o elegir archivos. Cada archivo viaja en su propio pedido y muestra
 * su resultado (estado, boletas cargadas o el error); al terminar avisa para que la lista se actualice.
 */
export function UploadPanel({ onUploaded }: { onUploaded: () => void }) {
  const t = useTranslations('billDocuments.upload');
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);

  const patch = (key: number, change: Partial<UploadItem>) =>
    setItems((prev) => prev.map((item) => (item.key === key ? { ...item, ...change } : item)));

  async function upload(files: File[]) {
    if (files.length === 0 || busy) return;
    const added: UploadItem[] = files.map((file) => ({
      key: nextKey++,
      name: file.name,
      state: pdfProblem(file) ? 'error' : 'uploading',
      problem: pdfProblem(file) ?? undefined,
    }));
    setItems(added);
    setBusy(true);
    for (const [index, file] of files.entries()) {
      const item = added[index];
      if (item.state === 'error') continue;
      try {
        const result = await uploadBillFile(file);
        if (result.error) patch(item.key, { state: 'error', problem: result.error.code === 'NOT_A_PDF' ? 'notPdf' : 'failed', result });
        else patch(item.key, { state: 'done', result });
      } catch (err) {
        patch(item.key, { state: 'error', problem: apiErrorCode(err) ?? 'failed' });
      }
    }
    setBusy(false);
    onUploaded();
  }

  const pick = (list: FileList | null) => {
    void upload(Array.from(list ?? []));
    if (inputRef.current) inputRef.current.value = '';
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    pick(e.dataTransfer.files);
  };

  const finished = items.filter((item) => item.state !== 'uploading').length;

  return (
    <section aria-labelledby="bill-upload-title" className="space-y-3">
      <h2 id="bill-upload-title" className="text-base font-semibold text-[var(--color-text)]">
        {t('title')}
      </h2>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        data-testid="bill-dropzone"
        className={cn(
          'flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors',
          dragging
            ? 'border-brand-500 bg-[color-mix(in_oklab,var(--color-brand-500)_8%,var(--color-surface))]'
            : 'border-[var(--color-border)] bg-[var(--color-surface-sunken)]',
        )}
      >
        <Icon name="invoices" size={28} className="text-[var(--color-muted)]" aria-hidden="true" />
        <p className="text-sm font-medium text-[var(--color-text)]">{dragging ? t('dragging') : t('drop')}</p>
        <p className="text-sm text-[var(--color-muted)]">{t('or')}</p>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => inputRef.current?.click()}>
          {t('choose')}
        </Button>
        <p className="text-xs text-[var(--color-muted)]">{t('limits')}</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="application/pdf,.pdf"
          aria-label={t('dropLabel')}
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => pick(e.target.files)}
        />
      </div>

      {items.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <progress
              className="h-2 flex-1 accent-[var(--color-brand-500)]"
              max={items.length}
              value={finished}
              aria-label={t('progress', { done: finished, total: items.length })}
            />
            <span className="text-sm tabular-nums text-[var(--color-muted)]" aria-live="polite">
              {t('progress', { done: finished, total: items.length })}
            </span>
            {!busy && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setItems([])}>
                {t('clear')}
              </Button>
            )}
          </div>
          <ul aria-label={t('files')} className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
            {items.map((item) => (
              <UploadRow key={item.key} item={item} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function UploadRow({ item }: { item: UploadItem }) {
  const t = useTranslations('billDocuments.upload');
  const tErrors = useTranslations('errors.codes');
  const { result } = item;
  const bills = result?.billIds?.length ?? 0;
  const problemText =
    item.problem === 'notPdf' || item.problem === 'tooLarge' || item.problem === 'failed'
      ? t(item.problem)
      : item.problem && tErrors.has(item.problem)
        ? tErrors(item.problem)
        : t('failed');
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
      <span className="min-w-0 flex-1 truncate font-medium text-[var(--color-text)]">{item.name}</span>
      {item.state === 'uploading' && (
        <span className="flex items-center gap-2 text-[var(--color-muted)]">
          <Spinner className="h-4 w-4 text-brand-500" />
          {t('uploading')}
        </span>
      )}
      {item.state === 'error' && <span className="text-[var(--color-danger)]">{problemText}</span>}
      {item.state === 'done' && result?.status && (
        <>
          <StatusBadge domain="boletaRecibida" status={result.status} />
          {result.duplicate && <span className="text-[var(--color-muted)]">{t('duplicate')}</span>}
          {bills > 0 && <span className="text-[var(--color-muted)]">{t('billsCreated', { count: bills })}</span>}
          {result.id && (
            <Link href={`/boletas/recibidas/${result.id}`} className="font-medium text-brand-600 hover:text-brand-700">
              {t('viewDocument')}
            </Link>
          )}
        </>
      )}
    </li>
  );
}
