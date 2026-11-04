'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { parsePositiveAmount } from '@/lib/cash';
import { toast } from '@/lib/toast';
import { Dialog, DialogBody, DialogHeader } from './dialog';
import { ErrorNotice } from './error-notice';
import { FormDialogFooter } from './form-dialog-footer';
import { FormField } from './form-field';
import { Input } from './input';
import { Select } from './select';
import { Textarea } from './textarea';

export type FieldValues = Record<string, string>;

export interface FieldDef {
  name: string;
  label: string;
  kind?: 'text' | 'textarea' | 'date' | 'amount' | 'number' | 'select';
  options?: ReadonlyArray<{ value: string; label: string }>;
  required?: boolean;
  hint?: string;
  /** El campo solo aparece (y se valida) si devuelve `true` con los valores actuales. */
  visible?: (values: FieldValues) => boolean;
  /** Validación propia de un valor no vacío: devuelve el mensaje de error o `null`. */
  validate?: (value: string) => string | null;
}

interface Props {
  title: string;
  description?: string;
  fields: readonly FieldDef[];
  initial?: FieldValues;
  submitLabel: string;
  successMessage: string;
  errorFallback: string;
  /** Contenido propio antes de los campos (por ejemplo, un buscador de propiedad). */
  extra?: ReactNode;
  /** Validación propia previa al envío: devuelve el mensaje de error o `null`. */
  precheck?: () => string | null;
  /** Hace el pedido con los valores ya validados; si falla, el error se muestra en el diálogo. */
  request: (values: FieldValues) => Promise<unknown>;
  onClose: () => void;
  onDone: () => void;
}

/**
 * Diálogo de un formulario corto: una lista de campos (texto, fecha, importe, número, lista o texto largo), su
 * validación mínima (obligatorio e importe positivo), el envío y el aviso. Lo usan las acciones de ventas y llaves
 * (cambiar de etapa, recibir o devolver una seña, sacar o devolver unas llaves), que solo difieren en los campos y
 * en el pedido.
 */
export function FieldsDialog({ title, description, fields, initial = {}, submitLabel, successMessage, errorFallback, extra, precheck, request, onClose, onDone }: Props) {
  const t = useTranslations('fieldsDialog');
  const [values, setValues] = useState<FieldValues>(() => Object.fromEntries(fields.map((f) => [f.name, initial[f.name] ?? ''])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [precheckError, setPrecheckError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const shown = fields.filter((f) => !f.visible || f.visible(values));

  function validate(): Record<string, string> {
    const found: Record<string, string> = {};
    for (const f of shown) {
      const value = (values[f.name] ?? '').trim();
      if (!value) {
        if (f.required) found[f.name] = t('required');
      } else if (f.kind === 'amount' && !parsePositiveAmount(value)) {
        found[f.name] = t('amountInvalid');
      } else {
        const custom = f.validate?.(value) ?? null;
        if (custom) found[f.name] = custom;
      }
    }
    return found;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const found = validate();
    setErrors(found);
    const blocked = precheck?.() ?? null;
    setPrecheckError(blocked);
    if (blocked || Object.keys(found).length > 0) return;
    setSaving(true);
    setError(null);
    try {
      const clean = Object.fromEntries(shown.map((f) => [f.name, (values[f.name] ?? '').trim()]));
      await request(clean);
      toast.success(successMessage);
      onDone();
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onClose={onClose} busy={saving} size="md">
      <form onSubmit={(e) => void submit(e)} noValidate>
        <DialogHeader>
          <div>
            <h2 className="text-base font-semibold text-[var(--color-text)]">{title}</h2>
            {description && <p className="text-sm text-[var(--color-muted)]">{description}</p>}
          </div>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {precheckError && <p role="alert" className="text-sm text-[var(--color-danger)]">{precheckError}</p>}
          {error != null && <ErrorNotice error={error} fallback={errorFallback} />}
          {extra}
          {shown.map((f) => (
            <FormField key={f.name} label={f.label} hint={f.hint} error={errors[f.name]} required={f.required}>
              {(c) => {
                const value = values[f.name] ?? '';
                const set = (next: string) => setValues((prev) => ({ ...prev, [f.name]: next }));
                if (f.kind === 'select') {
                  return (
                    <Select {...c} value={value} onChange={(e) => set(e.target.value)}>
                      {!f.required && <option value="" />}
                      {(f.options ?? []).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  );
                }
                if (f.kind === 'textarea') return <Textarea {...c} value={value} onChange={(e) => set(e.target.value)} />;
                return (
                  <Input
                    {...c}
                    type={f.kind === 'date' ? 'date' : f.kind === 'number' ? 'number' : 'text'}
                    inputMode={f.kind === 'amount' ? 'decimal' : undefined}
                    value={value}
                    onChange={(e) => set(e.target.value)}
                  />
                );
              }}
            </FormField>
          ))}
        </DialogBody>
        <FormDialogFooter onCancel={onClose} busy={saving} submitLabel={saving ? t('saving') : submitLabel} />
      </form>
    </Dialog>
  );
}
