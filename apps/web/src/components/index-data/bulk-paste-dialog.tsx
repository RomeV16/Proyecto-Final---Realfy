'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { IndexType } from '@realfy/shared';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { toast } from '@/lib/toast';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { INDEX_TYPES, granularityOf, parseBulk } from '@/lib/index-values';

interface BulkPasteDialogProps {
  open: boolean;
  initialType: IndexType;
  onClose: () => void;
  onSaved: (indexType: IndexType) => void;
}

/**
 * Carga de varios períodos de una vez (POST /index-data/bulk). Se lee el
 * texto mientras se escribe y no se envía nada hasta que todas las líneas
 * son válidas, así no queda una carga a medias.
 */
export function BulkPasteDialog({ open, initialType, onClose, onSaved }: BulkPasteDialogProps) {
  const t = useTranslations('indexData');
  const tCommon = useTranslations('common');

  const [indexType, setIndexType] = useState<IndexType>(initialType);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setIndexType(initialType);
    setText('');
  }, [open, initialType]);

  const parsed = useMemo(() => parseBulk(text, indexType), [text, indexType]);
  const canSubmit = parsed.rows.length > 0 && parsed.errors.length === 0 && !saving;
  const monthly = granularityOf(indexType) === 'month';

  async function handleSubmit() {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await apiClient('/index-data/bulk', { method: 'POST', body: JSON.stringify(parsed.rows) });
      toast.success(t('bulk.saved', { count: parsed.rows.length }));
      onSaved(indexType);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t('bulk.saveError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={saving ? () => undefined : onClose} className="max-w-xl">
      <DialogHeader>
        <h2 className="text-base font-semibold text-[var(--color-text)]">{t('bulk.title')}</h2>
      </DialogHeader>

      <DialogBody className="space-y-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="bulk-type" className="text-[0.8rem] font-medium text-[var(--color-text)]">
            {t('form.type')}
          </label>
          <select
            id="bulk-type"
            value={indexType}
            onChange={(e) => setIndexType(e.target.value as IndexType)}
            disabled={saving}
            className="h-11 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 text-sm text-[var(--color-text)] focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-[color-mix(in_srgb,var(--color-brand-500)_15%,transparent)] disabled:opacity-50"
          >
            {INDEX_TYPES.map((type) => (
              <option key={type} value={type}>
                {type} · {t(`unit.${type}`)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="bulk-text" className="text-[0.8rem] font-medium text-[var(--color-text)]">
            {t('bulk.lines')}
          </label>
          <textarea
            id="bulk-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={monthly ? t('bulk.exampleMonth') : t('bulk.exampleDay')}
            rows={8}
            spellCheck={false}
            disabled={saving}
            className="w-full resize-y rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2.5 font-mono text-sm text-[var(--color-text)] placeholder:text-[var(--color-muted)] focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-[color-mix(in_srgb,var(--color-brand-500)_15%,transparent)]"
          />
          <p className="text-xs text-[var(--color-muted)]">
            {monthly ? t('bulk.instructionsMonth') : t('bulk.instructionsDay')}
          </p>
        </div>

        {(parsed.rows.length > 0 || parsed.errors.length > 0) && (
          <div className="space-y-2" aria-live="polite">
            <div className="flex flex-wrap gap-2">
              <Badge variant="success" dot>
                {t('bulk.ready', { count: parsed.rows.length })}
              </Badge>
              {parsed.errors.length > 0 && (
                <Badge variant="danger" dot>
                  {t('bulk.invalid', { count: parsed.errors.length })}
                </Badge>
              )}
            </div>
            {parsed.errors.length > 0 && (
              <ul className="max-h-32 space-y-1 overflow-y-auto text-xs text-[var(--color-danger)]">
                {parsed.errors.slice(0, 20).map((error) => (
                  <li key={error.line}>
                    {t('bulk.errorLine', { line: error.line, reason: t(`bulk.reasons.${error.reason}`) })}
                    <span className="ml-1 font-mono text-[var(--color-muted)]">{error.text.trim()}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </DialogBody>

      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
          {tCommon('cancel')}
        </Button>
        <Button type="button" size="sm" onClick={handleSubmit} disabled={!canSubmit}>
          {saving && <Spinner className="h-4 w-4 text-white" />}
          {t('bulk.submit', { count: parsed.rows.length })}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
