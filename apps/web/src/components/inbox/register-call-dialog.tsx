'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import type { ConversationDetail } from '@/lib/inbox';
import { toast } from '@/lib/toast';
import { Dialog, DialogBody, DialogHeader } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormDialogFooter } from '@/components/ui/form-dialog-footer';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  onClose: () => void;
  /** Recibe la consulta creada para abrirla en la bandeja. */
  onSaved: (created: ConversationDetail) => void;
}

/** "Registrar llamada": anota quién llamó, a qué número y qué se habló; si quedó para devolver, corre el plazo. */
export function RegisterCallDialog({ onClose, onSaved }: Props) {
  const t = useTranslations('inbox.call');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [summary, setSummary] = useState('');
  const [answered, setAnswered] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [touched, setTouched] = useState(false);

  const invalid = !name.trim() || phone.replace(/\D/g, '').length < 6 || !summary.trim();

  async function save(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (invalid) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await apiClient<ConversationDetail>('/conversations/calls', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), phone: phone.trim(), summary: summary.trim(), answered }),
      });
      toast.success(t('saved'));
      onSaved(created);
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onClose={onClose} busy={submitting} size="md">
      <form onSubmit={(e) => void save(e)} noValidate>
        <DialogHeader>
          <h2 className="text-base font-semibold text-[var(--color-text)]">{t('title')}</h2>
          <p className="mt-1 text-sm text-[var(--color-muted)]">{t('subtitle')}</p>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {error != null && <ErrorNotice error={error} fallback={t('saveError')} />}
          <FormField label={t('name')} required error={touched && !name.trim() ? t('required') : undefined}>
            {(control) => <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} {...control} />}
          </FormField>
          <FormField
            label={t('phone')}
            required
            error={touched && phone.replace(/\D/g, '').length < 6 ? t('phoneInvalid') : undefined}
          >
            {(control) => <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={50} {...control} />}
          </FormField>
          <FormField label={t('summary')} required error={touched && !summary.trim() ? t('required') : undefined}>
            {(control) => (
              <Textarea rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={4000} {...control} />
            )}
          </FormField>
          <label className="flex items-start gap-2 text-sm text-[var(--color-text)]">
            <input type="checkbox" checked={answered} onChange={(e) => setAnswered(e.target.checked)} className="mt-1" />
            <span>
              {t('answered')}
              <span className="block text-xs text-[var(--color-muted)]">{t('answeredHint')}</span>
            </span>
          </label>
        </DialogBody>
        <FormDialogFooter onCancel={onClose} busy={submitting} submitLabel={submitting ? t('saving') : t('save')} />
      </form>
    </Dialog>
  );
}
