import { getProvider, normalizeAccount } from './index';

export type ProviderFieldsError = {
  code: 'UNKNOWN_PROVIDER_KEY' | 'PROVIDER_SERVICE_TYPE_MISMATCH' | 'INVALID_PROVIDER_ACCOUNT';
  message: string;
  field: 'providerKey' | 'serviceType' | 'accountNumber';
};

export type ProviderFieldsResult = { ok: true; accountNumber?: string | null } | ({ ok: false } & ProviderFieldsError);

/**
 * Valida el proveedor de un servicio contra el catálogo (ADR-0018) y devuelve la cuenta
 * normalizada con el esquema de ese proveedor, que es con lo que el circuito de boletas
 * busca el servicio. Lo comparten el alta y edición manual y el lote de importación.
 * Lo que la entrada no informa se toma de `current`; sin proveedor no se toca la cuenta.
 */
export function resolveProviderFields(
  input: { providerKey?: string | null; accountNumber?: string | null; serviceType?: string },
  current?: { providerKey: string | null; accountNumber: string | null; serviceType: string },
): ProviderFieldsResult {
  const providerKey = input.providerKey !== undefined ? input.providerKey : (current?.providerKey ?? null);
  if (!providerKey) return { ok: true };
  const provider = getProvider(providerKey);
  if (!provider) {
    return { ok: false, code: 'UNKNOWN_PROVIDER_KEY', message: `Unknown provider ${providerKey}`, field: 'providerKey' };
  }
  const serviceType = input.serviceType ?? current?.serviceType;
  if (serviceType && provider.serviceTypes.length > 0 && !provider.serviceTypes.includes(serviceType as never)) {
    return {
      ok: false,
      code: 'PROVIDER_SERVICE_TYPE_MISMATCH',
      message: `Provider ${providerKey} does not issue ${serviceType} bills`,
      field: 'serviceType',
    };
  }
  // Una edición que no toca ni el proveedor ni la cuenta no revalida la cuenta guardada.
  if (input.providerKey === undefined && input.accountNumber === undefined) return { ok: true };
  const raw = input.accountNumber !== undefined ? input.accountNumber : (current?.accountNumber ?? null);
  if (raw === null || raw === '') return { ok: true, ...(input.accountNumber === undefined ? {} : { accountNumber: null }) };
  const normalized = normalizeAccount(providerKey, raw);
  if (!normalized) {
    return {
      ok: false,
      code: 'INVALID_PROVIDER_ACCOUNT',
      message: `The account number is not valid for provider ${providerKey}`,
      field: 'accountNumber',
    };
  }
  return { ok: true, accountNumber: normalized };
}
