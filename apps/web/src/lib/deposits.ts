import { computeMoveOut, MoveOutItemKind } from '@realfy/shared';
import type { MoveOutItem } from '@realfy/shared';

/* ──────────── Lo que devuelve la API ──────────── */

export interface DepositInstallment {
  id: string;
  number: number;
  dueDate: string;
  amount: string;
  paidAt: string | null;
}

export interface ContractDepositData {
  id: string;
  amount: string;
  currency: string;
  heldBy: 'Locador' | 'Inmobiliaria';
  heldByPersonId: string | null;
  heldByPerson?: { id: string; firstName: string; lastName: string } | null;
  installments: number;
  refundRule: 'PesosActualizado' | 'MismaMoneda';
  refundInstallments: number;
  refundDueDays: number;
  status: 'Pendiente' | 'Parcial' | 'Cobrado' | 'Devuelto';
  refundedAt: string | null;
  refundedAmount: string | null;
  notes: string | null;
  collectedAmount: string;
  pendingAmount: string;
  installmentRows: DepositInstallment[];
}

export interface DepositResponse {
  deposit: ContractDepositData | null;
  defaults: { defaultHeldBy: 'Locador' | 'Inmobiliaria'; refundDueDays: number; deductionsNeedLessorApproval: boolean };
}

export interface MoveOutPreview {
  contractId: string;
  date: string;
  currency: string;
  items: MoveOutItem[];
  deposit: {
    id: string;
    amount: string;
    currency: string;
    heldBy: string;
    refundRule: string;
    refundInstallments: number;
    refundDueDate: string;
    refundable: string;
    collected: string;
  } | null;
}

export interface MoveOutSettlementData {
  id: string;
  status: 'Borrador' | 'Confirmada';
  date: string;
  currency: string;
  items: MoveOutItem[];
  netAmount: string;
}

/* ──────────── Opciones ──────────── */

export const HOLDERS = ['Locador', 'Inmobiliaria'] as const;
export const REFUND_RULES = ['PesosActualizado', 'MismaMoneda'] as const;
export const DEPOSIT_CURRENCIES = ['ARS', 'USD', 'EUR'] as const;
export const ITEM_KINDS = Object.values(MoveOutItemKind);

/* ──────────── Totales de la liquidación ──────────── */

/**
 * Totales de la liquidación con los renglones tal como están en pantalla. Es el mismo motor que usa la API al guardar,
 * así que lo que se ve es lo que se confirma. `refundable` y `collected` salen de la vista previa.
 */
export function moveOutTotals(items: readonly MoveOutItem[], deposit: MoveOutPreview['deposit']) {
  const amount = Number(deposit?.amount ?? 0);
  const result = computeMoveOut({
    items: items.map((i) => ({ ...i, amount: parseSigned(i.amount) ?? '0' })),
    refundable: deposit?.refundable ?? '0',
    collectedShare: amount > 0 ? String(Number(deposit?.collected ?? 0) / amount) : '0',
  });
  return {
    totalOwed: result.totalOwed.toFixed(2),
    depositAvailable: result.depositAvailable.toFixed(2),
    refundToTenant: result.refundToTenant.toFixed(2),
    owedByTenant: result.owedByTenant.toFixed(2),
    net: result.net.toFixed(2),
  };
}

/** Importe con signo y hasta 2 decimales (acepta coma decimal), o null. */
export function parseSigned(raw: string): string | null {
  const text = (raw ?? '').trim().replace(',', '.');
  return /^-?\d+(\.\d{1,2})?$/.test(text) ? text : null;
}
