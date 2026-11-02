import { FollowUpKind } from '../enums';

/** Un paso del checklist de un seguimiento. `code` es estable: la web lo traduce. */
export interface FollowUpTaskTemplate {
  code: string;
  label: string;
}

/**
 * Checklist que se arma al abrir un seguimiento. El orden es el de la pantalla.
 * Devolución: lo que la inmobiliaria revisa antes de recibir la unidad.
 * Renovación: lo que cierra con el inquilino y los garantes antes de firmar.
 */
export const FOLLOW_UP_CHECKLISTS: Record<FollowUpKind, readonly FollowUpTaskTemplate[]> = {
  [FollowUpKind.Devolucion]: [
    { code: 'VISITA', label: 'Visita previa de inspección' },
    { code: 'FECHA_ENTREGA', label: 'Fecha de entrega acordada' },
    { code: 'PUBLICAR', label: 'Publicar la unidad con anticipación' },
    { code: 'LIBRE_DEUDA', label: 'Libre deuda de servicios' },
    { code: 'PINTURA', label: 'Pintura y estado de la unidad' },
    { code: 'LLAVES', label: 'Entrega de llaves' },
    { code: 'DEPOSITO', label: 'Devolución del depósito' },
  ],
  [FollowUpKind.Renovacion]: [
    { code: 'VISITA', label: 'Visita y estado de la unidad' },
    { code: 'PRECIO', label: 'Precio nuevo acordado' },
    { code: 'REGLA', label: 'Regla de ajuste' },
    { code: 'GARANTES', label: 'Garantes y fiadores reafirmados' },
    { code: 'HONORARIOS', label: 'Honorarios de renovación' },
    { code: 'SELLOS_FIRMA', label: 'Sellos y firma de la adenda' },
  ],
};

/** Pasos del checklist de un tipo de seguimiento. */
export function checklistFor(kind: FollowUpKind | `${FollowUpKind}`): readonly FollowUpTaskTemplate[] {
  return FOLLOW_UP_CHECKLISTS[kind as FollowUpKind];
}

/** Semáforo de un vencimiento: se calcula del fin efectivo, no se guarda. */
export enum ExpirationLight {
  Green = 'green',
  Yellow = 'yellow',
  Red = 'red',
  /** El fin efectivo ya pasó. */
  Expired = 'expired',
}

/** Umbrales del semáforo, en días antes del fin (`Tenant.operationalDefaults.expiryLight`). */
export interface ExpirationThresholds {
  /** Rojo desde N días o menos del fin. */
  redDays: number;
  /** Amarillo desde M días o menos del fin. */
  yellowDays: number;
}

const DAY_MS = 86_400_000;

/** Días corridos desde `today` hasta `effectiveEnd` (negativo si ya pasó); ambos son días calendario en UTC. */
export function daysUntil(effectiveEnd: Date, today: Date): number {
  const end = Date.UTC(effectiveEnd.getUTCFullYear(), effectiveEnd.getUTCMonth(), effectiveEnd.getUTCDate());
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((end - now) / DAY_MS);
}

/**
 * Semáforo del fin efectivo: vencido si ya pasó, rojo a `redDays` días o menos,
 * amarillo a `yellowDays` días o menos y verde si falta más.
 */
export function expirationLight(
  effectiveEnd: Date,
  today: Date,
  thresholds: ExpirationThresholds,
): ExpirationLight {
  const days = daysUntil(effectiveEnd, today);
  if (days < 0) return ExpirationLight.Expired;
  if (days <= thresholds.redDays) return ExpirationLight.Red;
  if (days <= thresholds.yellowDays) return ExpirationLight.Yellow;
  return ExpirationLight.Green;
}
