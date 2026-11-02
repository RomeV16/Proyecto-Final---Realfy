import type { FormSchema } from '@/hooks/use-zod-form';

/** Lo que se usa de un esquema zod compartido. */
export interface SharedSchema {
  safeParse: (input: unknown) => { success: boolean; data?: unknown; error?: { issues: { path: PropertyKey[] }[] } };
}

/**
 * Esquema de formulario a partir de uno compartido: `body` arma el cuerpo con los textos del formulario y cada
 * error va a su campo con la clave `<namespace>.errors.<campo>` (la traduce `useSchemaMessages`).
 */
export function sharedFormSchema(
  namespace: string,
  shared: SharedSchema,
  body: (values: Record<string, string>) => Record<string, unknown>,
  fallbackField: string,
  /** Campo del formulario al que va el error de un campo del cuerpo que el formulario no tiene con ese nombre. */
  fieldOf: Record<string, string> = {},
): FormSchema<Record<string, unknown>> {
  return {
    safeParse(input) {
      const result = shared.safeParse(body(input as Record<string, string>));
      if (result.success) return { success: true, data: result.data as Record<string, unknown> };
      return {
        success: false,
        error: {
          issues: (result.error?.issues ?? []).map((issue) => {
            const raw = String(issue.path[0] ?? fallbackField);
            const field = fieldOf[raw] ?? raw;
            return { path: [field], message: `${namespace}.errors.${field}` };
          }),
        },
      };
    },
  };
}
