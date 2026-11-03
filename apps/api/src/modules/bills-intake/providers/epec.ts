import { z } from 'zod';
import { BILL_PROVIDER_SERVICE_TYPES, BillChannel } from '@realfy/shared';
import type { BillProviderDefinition } from './provider.types';
import { readLabelled } from './labelled-reader';
import { digitsOf } from './text-utils';

/** EPEC: número de suministro o contrato; sin formato verificado, se aceptan de 4 a 14 dígitos. */
export function normalizeEpecAccount(raw: string): string | null {
  const digits = digitsOf(raw);
  return digits.length >= 4 && digits.length <= 14 ? digits : null;
}

const accountSchema = z.string().transform((value, ctx) => {
  const normalized = normalizeEpecAccount(value);
  if (!normalized) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid EPEC account' });
  return normalized ?? '';
});

/**
 * EPEC (electricidad). Lectura por etiquetas del formato público, a ajustar con la
 * primera boleta real: la confianza está topada en 0,6 y nada se da de alta solo hasta
 * entonces (queda para revisión).
 */
export const epec: BillProviderDefinition = {
  key: 'epec',
  name: 'EPEC',
  serviceTypes: BILL_PROVIDER_SERVICE_TYPES.epec,
  accountSchema,
  channels: [BillChannel.Archivo, BillChannel.Mail],
  signatures: [/\bEPEC\b/, /Empresa Provincial de Energ[ií]a de C[oó]rdoba/i],
  parse: (text) =>
    readLabelled(text, {
      providerKey: 'epec',
      accountLabel: /(?:N[°ºo.]?\s*(?:de\s*)?)?(?:Suministro|Contrato|Cliente)\s*(?:N[°ºo.]?)?\s*:?/i,
      accountValue: /(\d[\d-]{3,15})/,
      normalizeAccount: normalizeEpecAccount,
      maxConfidence: 0.6,
    }),
};
