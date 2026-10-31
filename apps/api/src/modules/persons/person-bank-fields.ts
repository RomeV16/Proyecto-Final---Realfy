import { Currency } from '@realfy/shared';

type BankShortcut = { bankName?: string | null; cbu?: string | null; bankAlias?: string | null };

/**
 * Separa los campos bancarios planos (atajo de la API y del importador) del
 * resto de la persona. Ya no existen como columnas: se guardan como la cuenta
 * predeterminada en pesos.
 */
export function splitBankShortcut<T extends BankShortcut>(data: T) {
  const { bankName, cbu, bankAlias, ...rest } = data;
  const provided = bankName !== undefined || cbu !== undefined || bankAlias !== undefined;
  return { rest, bank: provided ? { bankName, cbu, bankAlias } : null };
}

/** True si el atajo trae algún dato real (no vacío ni nulo). */
export function hasBankData(bank: BankShortcut | null): boolean {
  return !!bank && !!(bank.bankName || bank.cbu || bank.bankAlias);
}

/** Cuenta predeterminada en ARS para crear junto con la persona. */
export function defaultAccountForCreate(
  tenantId: string,
  bank: BankShortcut | null,
  holder: string,
) {
  if (!bank || !hasBankData(bank)) return undefined;
  return {
    create: [
      {
        tenantId,
        currency: Currency.ARS,
        bankName: bank.bankName ?? null,
        cbu: bank.cbu ?? null,
        alias: bank.bankAlias ?? null,
        holder,
        isDefault: true,
      },
    ],
  };
}
