import { z } from 'zod';
import { BILL_PROVIDER_SERVICE_TYPES, BillChannel } from '@realfy/shared';
import type { BillProviderDefinition } from './provider.types';
import { readLabelled } from './labelled-reader';
import { digitsOf } from './text-utils';

/** Ecogas: número de cuenta o de cliente; sin formato verificado, se aceptan de 4 a 14 dígitos. */
export function normalizeEcogasAccount(raw: string): string | null {
  const digits = digitsOf(raw);
  return digits.length >= 4 && digits.length <= 14 ? digits : null;
}

const accountSchema = z.string().transform((value, ctx) => {
  const normalized = normalizeEcogasAccount(value);
  if (!normalized) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid Ecogas account' });
  return normalized ?? '';
});

/**
 * Ecogas, Distribuidora de Gas del Centro (gas). Lectura por etiquetas del formato
 * público, a ajustar con la primera boleta real: la confianza está topada en 0,6 y nada
 * se da de alta solo hasta entonces (queda para revisión).
 */
export const ecogas: BillProviderDefinition = {
  key: 'ecogas',
  name: 'Ecogas',
  serviceTypes: BILL_PROVIDER_SERVICE_TYPES.ecogas,
  accountSchema,
  channels: [BillChannel.Archivo, BillChannel.Mail],
  signatures: [/\bEcogas\b/i, /Distribuidora de Gas del Centro/i],
  parse: (text) =>
    readLabelled(text, {
      providerKey: 'ecogas',
      accountLabel: /(?:N[°ºo.]?\s*(?:de\s*)?)?(?:Cuenta|Cliente)\s*(?:N[°ºo.]?)?\s*:?/i,
      accountValue: /(\d[\d-]{3,15})/,
      normalizeAccount: normalizeEcogasAccount,
      maxConfidence: 0.6,
    }),
};
