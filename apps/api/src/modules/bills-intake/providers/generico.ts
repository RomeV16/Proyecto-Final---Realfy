import { z } from 'zod';
import { BILL_PROVIDER_SERVICE_TYPES, BillChannel } from '@realfy/shared';
import type { BillProviderDefinition } from './provider.types';
import { readLabelled } from './labelled-reader';

/** Identificador de cuenta de cualquier proveedor: letras y dígitos, sin separadores, de 3 a 30. */
export function normalizeGenericAccount(raw: string): string | null {
  const value = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return value.length >= 3 && value.length <= 30 ? value : null;
}

const accountSchema = z.string().transform((value, ctx) => {
  const normalized = normalizeGenericAccount(value);
  if (!normalized) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid account' });
  return normalized ?? '';
});

/**
 * Lector de respaldo para un documento que ningún proveedor reconoce: total a pagar,
 * vencimiento y período por sus etiquetas habituales. Su confianza está topada en 0,5:
 * nunca da de alta una boleta sin que una persona la revise.
 */
export const generico: BillProviderDefinition = {
  key: 'generico',
  name: 'Otro proveedor',
  serviceTypes: BILL_PROVIDER_SERVICE_TYPES.generico,
  accountSchema,
  channels: [BillChannel.Archivo, BillChannel.Mail],
  signatures: [],
  parse: (text) =>
    readLabelled(text, {
      providerKey: 'generico',
      accountLabel: /(?:N[°ºo.]?\s*(?:de\s*)?)?(?:Cuenta|Cliente|Suministro|Contrato|Socio|Unidad funcional)\s*(?:N[°ºo.]?)?\s*:?/i,
      accountValue: /([A-Z0-9][A-Z0-9-]{2,29})/i,
      normalizeAccount: normalizeGenericAccount,
      maxConfidence: 0.5,
    }),
};
