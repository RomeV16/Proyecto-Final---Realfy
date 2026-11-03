'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog, DialogBody, DialogHeader } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormDialogFooter } from '@/components/ui/form-dialog-footer';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export interface ActionField {
  name: string;
  label: string;
  kind: 'text' | 'textarea' | 'date' | 'number';
  required?: boolean;
  hint?: string;
  maxLength?: number;
}

interface Props {
  title: string;
  description?: string;
  submitLabel: string;
  fields: ActionField[];
  initial?: Record<string, string>;
  /** Hace la llamada; si lanza, el error se muestra en el diálogo y no se cierra. */
  onSubmit: (values: Record<string, string>) => Promise<void>;
  onClose: () => void;
}

/**
 * Diálogo de una acción del caso de cobranza: un puñado de campos de texto, fecha o importe y la llamada a la
 * API. Valida lo obligatorio antes de enviar y muestra el error de la API sin cerrarse.
 */
export function CaseActionDialog({ title, description, submitLabel, fields, initial = {}, onSubmit, onClose }: Props) {
  const tv = useTranslations('validation');
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.name, initial[f.name] ?? ''])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const missing = Object.fromEntries(
      fields.filter((f) => f.required && !values[f.name]?.trim()).map((f) => [f.name, tv('required')]),
    );
    setErrors(missing);
    if (Object.keys(missing).length > 0) return;
    setBusy(true);
    setFailure(null);
    try {
      await onSubmit(values);
      onClose();
    } catch (err) {
      setFailure(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} busy={busy} size="md">
      <form onSubmit={(e) => void submit(e)} noValidate>
        <DialogHeader>
          <div>
            <h2 className="text-base font-semibold text-[var(--color-text)]">{title}</h2>
            {description && <p className="mt-1 text-sm text-[var(--color-muted)]">{description}</p>}
          </div>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {failure != null && <ErrorNotice error={failure} />}
          {fields.map((f) => (
            <FormField key={f.name} label={f.label} hint={f.hint} error={errors[f.name]} required={f.required}>
              {(c) =>
                f.kind === 'textarea' ? (
                  <Textarea
                    {...c}
                    rows={4}
                    maxLength={f.maxLength}
                    value={values[f.name]}
                    onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                  />
                ) : (
                  <Input
                    {...c}
                    type={f.kind === 'date' ? 'date' : 'text'}
                    inputMode={f.kind === 'number' ? 'decimal' : undefined}
                    maxLength={f.maxLength}
                    value={values[f.name]}
                    onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                  />
                )
              }
            </FormField>
          ))}
        </DialogBody>
        <FormDialogFooter onCancel={onClose} busy={busy} submitLabel={submitLabel} />
      </form>
    </Dialog>
  );
}
