'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormField } from '@/components/ui/form-field';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  open: boolean;
  title: string;
  body: ReactNode;
  onClose: () => void;
  /** Recibe el motivo ya recortado; si falla, el diálogo muestra el error y sigue abierto. */
  onConfirm: (reason: string) => Promise<void>;
}

/** Confirmación de una condonación: pide un motivo obligatorio, que queda en la auditoría. */
export function WaiveDialog({ open, title, body, onClose, onConfirm }: Props) {
  const t = useTranslations('punitorios.waive');
  const tCommon = useTranslations('common');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const trimmed = reason.trim();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(trimmed);
      setReason('');
      setTouched(false);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} size="sm" busy={busy}>
      <form onSubmit={submit} noValidate>
        <DialogHeader>
          <h2 className="text-base font-semibold text-[var(--color-text)]">{title}</h2>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-4 text-sm text-[var(--color-text)]">
            <div>{body}</div>
            <FormField label={t('reason')} hint={t('reasonHint')} error={touched && !trimmed ? t('reasonRequired') : undefined} required>
              {(c) => <Textarea {...c} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />}
            </FormField>
            {error != null && <ErrorNotice error={error} fallback={t('error')} />}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" variant="danger" disabled={busy}>
            {t('confirm')}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
