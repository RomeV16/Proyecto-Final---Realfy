'use client';

import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Atributos que el campo le pasa al control para quedar enlazado con su etiqueta y mensajes. */
export interface FieldControlProps {
  id: string;
  'aria-required'?: true;
  'aria-invalid'?: true;
  'aria-describedby'?: string;
}

interface FormFieldProps {
  label: ReactNode;
  /** Texto de ayuda, visible mientras no haya error. */
  hint?: ReactNode;
  /** Mensaje de error; marca el control como inválido. */
  error?: string;
  required?: boolean;
  className?: string;
  /** Recibe los atributos de accesibilidad para esparcirlos en el control. */
  children: (control: FieldControlProps) => ReactNode;
}

/**
 * Campo de formulario accesible: la etiqueta apunta al control con `htmlFor`,
 * y la ayuda o el error quedan enlazados por `aria-describedby`; con error el
 * control lleva `aria-invalid`. El `id` sale de `useId`, sin que la pantalla lo invente.
 *
 *     <FormField label="Email" error={errors.email}>
 *       {(control) => <Input type="email" {...control} />}
 *     </FormField>
 */
export function FormField({ label, hint, error, required, className, children }: FormFieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const hasMessage = Boolean(error || hint);

  const control: FieldControlProps = {
    id,
    ...(required ? { 'aria-required': true as const } : {}),
    ...(error ? { 'aria-invalid': true as const } : {}),
    ...(hasMessage ? { 'aria-describedby': messageId } : {}),
  };

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-[var(--color-text)]">
        {label}
        {required && (
          <span className="ml-0.5 text-[var(--color-danger)]" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children(control)}
      {hasMessage && (
        <p
          id={messageId}
          role={error ? 'alert' : undefined}
          className={cn('text-xs', error ? 'text-[var(--color-danger)]' : 'text-[var(--color-muted)]')}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
}
