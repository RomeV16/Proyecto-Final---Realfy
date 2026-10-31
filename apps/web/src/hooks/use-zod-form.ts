'use client';

import { useCallback, useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { ApiRequestError } from '@/lib/api-client';

/** Lo mínimo que se le pide a un esquema zod: así la web no depende de `zod` directamente. */
export interface FormSchema<T> {
  safeParse(
    input: unknown,
  ): { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
}

export type FieldErrors<V> = Partial<Record<keyof V & string, string>>;

/**
 * Errores por campo que trae un `ApiRequestError`. Acepta tres formas:
 * - `details.fieldErrors`: `{ campo: 'mensaje' | ['mensaje'] }`
 * - `details.errors`: `[{ field | path, message }]`
 * - `message` como lista de class-validator (`"email must be an email"`): el
 *   mensaje se asigna al campo con el que empieza.
 * Los campos que el formulario no conoce se descartan; quedan en el aviso general.
 */
export function fieldErrorsFromApi(error: ApiRequestError, fields: readonly string[]): Record<string, string> {
  const known = new Set(fields);
  const found: Record<string, string> = {};
  const put = (field: unknown, message: unknown) => {
    const name = typeof field === 'string' ? field.split('.')[0] : undefined;
    const text = Array.isArray(message) ? message[0] : message;
    if (name && known.has(name) && typeof text === 'string' && !found[name]) found[name] = text;
  };

  const { fieldErrors, errors } = error.details as { fieldErrors?: unknown; errors?: unknown };
  if (fieldErrors && typeof fieldErrors === 'object') {
    for (const [field, message] of Object.entries(fieldErrors)) put(field, message);
  }
  if (Array.isArray(errors)) {
    for (const item of errors as { field?: unknown; path?: unknown; message?: unknown }[]) {
      put(item?.field ?? item?.path, item?.message);
    }
  }
  const list = (error.body as { message?: unknown } | undefined)?.message;
  if (Array.isArray(list)) {
    for (const line of list) {
      if (typeof line === 'string') put(line.split(' ')[0], line);
    }
  }
  return found;
}

interface UseZodFormOptions<V extends object, D> {
  schema: FormSchema<D>;
  initialValues: V;
  /** Traduce el mensaje del esquema (suelen ser claves i18n, como `validation.required`). */
  translate?: (message: string) => string;
}

/**
 * Estado de un formulario con validación por esquema.
 *
 * - `values` / `set(campo, valor)` / `setValues(parche)`: estado controlado.
 * - `errors`: por campo; se limpia el del campo al editarlo.
 * - `submit(fn)`: devuelve el manejador del `<form>`. Valida, y si hay errores no llama a `fn`;
 *   si `fn` falla con `ApiRequestError`, mapea `details` a los campos (ver `fieldErrorsFromApi`)
 *   y deja el error en `formError` para mostrarlo con `ErrorNotice`. Maneja `submitting`.
 * - `dirty`: algún valor difiere de los iniciales.
 */
export function useZodForm<V extends object, D = V>({ schema, initialValues, translate }: UseZodFormOptions<V, D>) {
  const initial = useRef(initialValues);
  const [values, setValuesState] = useState<V>(initialValues);
  const [errors, setErrors] = useState<FieldErrors<V>>({});
  const [formError, setFormError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  const set = useCallback(<K extends keyof V & string>(field: K, value: V[K]) => {
    setValuesState((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => {
      if (!(field in prev)) return prev;
      const { [field]: _removed, ...rest } = prev;
      return rest as FieldErrors<V>;
    });
  }, []);

  const setValues = useCallback(
    (patch: Partial<V> | ((prev: V) => Partial<V>)) =>
      setValuesState((prev) => ({ ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) })),
    [],
  );

  const validate = useCallback((): D | null => {
    const result = schema.safeParse(values);
    if (result.success) {
      setErrors({});
      return result.data;
    }
    const next: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const field = String(issue.path[0] ?? '');
      if (field && !next[field]) next[field] = translate ? translate(issue.message) : issue.message;
    }
    setErrors(next as FieldErrors<V>);
    return null;
  }, [schema, values, translate]);

  const submit = useCallback(
    (fn: (data: D) => Promise<void> | void) => async (event?: FormEvent) => {
      event?.preventDefault();
      setFormError(null);
      const data = validate();
      if (!data) {
        const form = event?.currentTarget as HTMLElement | null | undefined;
        // Con los errores ya pintados, el foco va al primer campo inválido.
        requestAnimationFrame(() => form?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
        return;
      }
      setSubmitting(true);
      try {
        await fn(data);
      } catch (err) {
        setFormError(err);
        if (err instanceof ApiRequestError) {
          const mapped = fieldErrorsFromApi(err, Object.keys(initial.current));
          if (Object.keys(mapped).length > 0) setErrors(mapped as FieldErrors<V>);
        }
      } finally {
        setSubmitting(false);
      }
    },
    [validate],
  );

  const dirty = (Object.keys(values) as (keyof V)[]).some((k) => values[k] !== initial.current[k]);

  return { values, set, setValues, errors, formError, setFormError, submitting, submit, validate, dirty };
}

/**
 * Traductor de los mensajes de los esquemas compartidos, que son claves i18n
 * (`validation.required`). Una clave que no existe se muestra tal cual.
 */
export function useSchemaMessages(): (message: string) => string {
  const t = useTranslations();
  return useCallback((message: string) => (t.has(message) ? t(message) : message), [t]);
}
