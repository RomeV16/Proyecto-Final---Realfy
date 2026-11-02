'use client';

import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { dayAfter, oralExtensionFormSchema, type OralExtensionFormValues } from '@/lib/follow-ups';
import { toast } from '@/lib/toast';
import { useSchemaMessages, useZodForm } from '@/hooks/use-zod-form';
import { Button } from '@/components/ui/button';
import { DateText } from '@/components/ui/date-text';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  contractId: string;
  /** Fin efectivo hoy (el real si ya hubo una prórroga, si no el pactado). */
  effectiveEnd: string;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Prórroga de palabra: el inquilino sigue después del fin firmado sin papeles. Mueve el fin real y deja el pactado
 * como está; queda registrada como convenio.
 */
export function OralExtensionDialog({ contractId, effectiveEnd, onClose, onSaved }: Props) {
  const t = useTranslations('followUps.oralExtension');
  const tCommon = useTranslations('common');
  const { values, set, errors, formError, submitting, submit } = useZodForm({
    schema: oralExtensionFormSchema,
    initialValues: { until: '', note: '' } satisfies OralExtensionFormValues,
    translate: useSchemaMessages(),
  });

  const save = submit(async (body) => {
    await apiClient(`/contracts/${contractId}/oral-extension`, { method: 'POST', body: JSON.stringify(body) });
    toast.success(t('saved'));
    onSaved();
    onClose();
  });

  return (
    <Dialog open onClose={onClose} busy={submitting} size="md">
      <form onSubmit={save} noValidate>
        <DialogHeader>
          <h2 className="text-base font-semibold text-[var(--color-text)]">{t('title')}</h2>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            {t('currentEnd')} <DateText value={effectiveEnd} />. {t('intro')}
          </p>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {formError != null && <ErrorNotice error={formError} fallback={t('saveError')} />}
          <FormField label={t('until')} hint={t('untilHint')} error={errors.until} required>
            {(c) => (
              <Input
                {...c}
                type="date"
                min={dayAfter(effectiveEnd)}
                value={values.until}
                onChange={(e) => set('until', e.target.value)}
              />
            )}
          </FormField>
          <FormField label={t('note')} error={errors.note} required>
            {(c) => <Textarea {...c} rows={3} value={values.note} onChange={(e) => set('note', e.target.value)} />}
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? t('saving') : t('save')}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
