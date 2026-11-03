import { SalesDepositKind, SalesDepositStatus } from '../enums';

/** Documentación del inmueble que se reúne antes del boleto. `required`: sin ella no se pasa a boleto. */
export interface SalesDocTemplateItem {
  code: string;
  required: boolean;
}

/** Lista de verificación que se crea con cada operación de venta (se tilda y se anotan observaciones). */
export const SALES_DOC_TEMPLATE: readonly SalesDocTemplateItem[] = [
  { code: 'informe_dominio', required: true },
  { code: 'informe_inhibicion', required: true },
  { code: 'certificado_catastral', required: true },
  { code: 'libre_deuda_municipal', required: true },
  { code: 'libre_deuda_rentas', required: true },
  { code: 'libre_deuda_expensas', required: false },
  { code: 'titulo_propiedad', required: true },
  { code: 'dni_vendedores', required: true },
  { code: 'estado_civil_asentimiento', required: false },
  { code: 'plano_final_de_obra', required: false },
];

export const SALES_DOC_CODES: readonly string[] = SALES_DOC_TEMPLATE.map((i) => i.code);

type StatusLike = SalesDepositStatus | `${SalesDepositStatus}`;

interface DepositLike {
  status: StatusLike;
  receivedAt?: Date | string | null;
  resolvedAt?: Date | string | null;
}

const dayOf = (value: Date | string): string => new Date(value).toISOString().slice(0, 10);

/** Dinero recibido y todavía sin devolver, retener ni aplicar al precio (vencida o no). */
export function hasUnresolvedMoney(d: DepositLike): boolean {
  return Boolean(d.receivedAt) && !d.resolvedAt && d.status !== SalesDepositStatus.Aplicada;
}

/** Una reserva o seña bloquea volver atrás de la etapa: sigue pendiente de cobro o con dinero sin resolver. */
export function blocksLeavingStage(d: DepositLike): boolean {
  return d.status === SalesDepositStatus.Pendiente || hasUnresolvedMoney(d);
}

/** Una reserva vence el día siguiente a `expiresAt` (el último día vale todavía). */
export function isDepositExpired(
  d: { expiresAt?: Date | string | null; status: StatusLike; kind: SalesDepositKind | `${SalesDepositKind}` },
  today: Date,
): boolean {
  if (d.kind !== SalesDepositKind.Reserva || !d.expiresAt) return false;
  if (d.status !== SalesDepositStatus.Pendiente && d.status !== SalesDepositStatus.Recibida) return false;
  return dayOf(d.expiresAt) < dayOf(today);
}

/** Fecha de vencimiento por defecto de una reserva: el día de `from` más `days`. */
export function reservationExpiry(from: Date, days: number): Date {
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + days));
}
