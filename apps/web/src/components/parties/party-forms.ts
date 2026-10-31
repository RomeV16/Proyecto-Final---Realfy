import type { FormSchema } from '@/hooks/use-zod-form';

interface SharedSchema {
  safeParse(
    input: unknown,
  ): { success: true; data: unknown } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
}

/**
 * Adapta un esquema compartido de la API a un formulario: `normalize` pasa los textos del formulario al cuerpo
 * que la API espera (vacío -> omitido o nulo) y los mensajes del esquema, que están en inglés, se reemplazan
 * por la clave `parties.errors.<campo>`, que `useSchemaMessages` traduce.
 */
export function partyFormSchema<D>(schema: SharedSchema, normalize: (values: any) => unknown,
  /** Campo del formulario al que corresponde un campo del cuerpo, cuando se llaman distinto. */
  fieldOf: Record<string, string> = {},
): FormSchema<D> {
  return {
    safeParse(input) {
      const result = schema.safeParse(normalize(input));
      if (result.success) return { success: true, data: result.data as D };
      return {
        success: false,
        error: {
          issues: result.error.issues.map((issue) => ({
            path: [fieldOf[String(issue.path[0])] ?? issue.path[0]],
            message: `parties.errors.${String(issue.path[0] ?? 'invalid')}`,
          })),
        },
      };
    },
  };
}

/** Texto vacío -> `null` (campo que se limpia). */
export const orNull = (value: string): string | null => (value.trim() === '' ? null : value.trim());
