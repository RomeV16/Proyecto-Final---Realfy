import type { BillProviderKey, FetchedBillData } from '@realfy/shared';
import { ecogas } from './ecogas';
import { epec } from './epec';
import { generico } from './generico';
import { muniCordoba } from './muni-cordoba';
import type { BillProviderDefinition } from './provider.types';
import { normalizeText } from './text-utils';

export type { BillProviderDefinition } from './provider.types';
export type { BillFetcher, BillFetchContext, BillFetchTarget, FetchedDocument } from './bill-fetcher';
export { BillFetchBlockedError } from './bill-fetcher';

/** Catálogo de proveedores: uno por archivo, registrado acá. El genérico va último y es el respaldo. */
export const BILL_PROVIDERS: readonly BillProviderDefinition[] = [
  ecogas,
  epec,
  muniCordoba,
  generico,
];

const BY_KEY = new Map<string, BillProviderDefinition>(BILL_PROVIDERS.map((p) => [p.key, p]));

export function getProvider(key: string): BillProviderDefinition | undefined {
  return BY_KEY.get(key);
}

/** Identificador de cuenta normalizado según el proveedor; `null` si no es válido o no hay proveedor. */
export function normalizeAccount(providerKey: string, raw: string): string | null {
  const provider = getProvider(providerKey);
  if (!provider) return null;
  const parsed = provider.accountSchema.safeParse(raw);
  return parsed.success && parsed.data ? parsed.data : null;
}

/**
 * Proveedor de un documento por las firmas de su texto: el que más firmas reconoce. Un
 * empate entre dos (o ninguna) no reconoce a ninguno y el documento va al lector genérico.
 */
export function detectProvider(rawText: string): BillProviderDefinition | null {
  const text = normalizeText(rawText);
  let best: BillProviderDefinition | null = null;
  let bestHits = 0;
  let tie = false;
  for (const provider of BILL_PROVIDERS) {
    const hits = provider.signatures.filter((re) => re.test(text)).length;
    if (hits === 0) continue;
    if (hits > bestHits) {
      best = provider;
      bestHits = hits;
      tie = false;
    } else if (hits === bestHits) {
      tie = true;
    }
  }
  return tie ? null : best;
}

export interface ReadBillResult {
  providerKey: BillProviderKey;
  /** El proveedor se reconoció por sus firmas (no es la lectura de respaldo). */
  detected: boolean;
  data: FetchedBillData | null;
}

/** Reconoce al proveedor y lee el documento; sin proveedor reconocido, con el lector genérico. */
export function readBill(text: string): ReadBillResult {
  const provider = detectProvider(text);
  if (provider) return { providerKey: provider.key, detected: true, data: provider.parse(text) };
  return { providerKey: generico.key, detected: false, data: generico.parse(text) };
}
