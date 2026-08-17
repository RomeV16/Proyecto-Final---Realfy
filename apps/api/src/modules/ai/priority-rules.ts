import type { AiPriorityUrgency } from '@realfy/shared';
import type { DailyContextItem } from './daily-context';

/**
 * Reglas propias de priorización.
 *
 * Es el orden con el que se responde cuando no hay modelo de lenguaje
 * disponible, así que está pensado para valer por sí mismo y no como relleno:
 * cada frente aporta un puntaje comparable con el de los demás, construido con
 * lo que la operación considera urgente de verdad — atraso y monto en las
 * cobranzas, exceso de SLA y falta de responsable en los reclamos, cercanía del
 * vencimiento en los contratos y antigüedad sin contacto en los leads.
 *
 * El monto entra normalizado contra el mayor monto del propio día, así que la
 * escala funciona igual en una cartera chica que en una grande.
 */

export interface RuleScoredPriority {
  ref: string;
  urgency: AiPriorityUrgency;
  /** Puntaje 0–100 con el que se ordena la lista. */
  score: number;
  reason: string;
  action: string;
}

/** Peso del atraso de una cobranza a partir del cual ya no crece. */
const OVERDUE_CAP_DAYS = 60;
/** Exceso de SLA a partir del cual un reclamo ya no crece. */
const SLA_CAP_HOURS = 72;
/** Horizonte de los vencimientos de contrato. */
const EXPIRY_HORIZON_DAYS = 90;
/** Antigüedad sin contacto a partir de la cual un lead ya no crece. */
const STALE_CAP_DAYS = 45;

const TICKET_PRIORITY_WEIGHT: Record<string, number> = {
  Urgente: 26,
  Alta: 18,
  Media: 8,
  Baja: 2,
};

const URGENCY_HIGH_FROM = 70;
const URGENCY_MEDIUM_FROM = 45;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function urgencyFor(score: number): AiPriorityUrgency {
  if (score >= URGENCY_HIGH_FROM) return 'alta';
  if (score >= URGENCY_MEDIUM_FROM) return 'media';
  return 'baja';
}

function formatAmount(amount: number, currency: string | null): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: currency || 'ARS',
    maximumFractionDigits: 0,
  }).format(amount);
}

function pluralDays(days: number): string {
  return days === 1 ? '1 día' : `${days} días`;
}

// ─── Puntaje y texto por frente ───────────────────────────

function scoreCollection(item: DailyContextItem, maxAmount: number): RuleScoredPriority {
  const overdue = item.daysOverdue ?? 0;
  const share = maxAmount > 0 && item.amount ? item.amount / maxAmount : 0;
  const score = 34 + (clamp(overdue, 0, OVERDUE_CAP_DAYS) / OVERDUE_CAP_DAYS) * 46 + share * 20;

  const amountText = item.amount !== null ? ` por ${formatAmount(item.amount, item.currency)}` : '';
  const reason =
    overdue > 0
      ? `Vencida hace ${pluralDays(overdue)}${amountText}`
      : `Pendiente de cobro${amountText}`;

  return {
    ref: item.ref,
    score,
    urgency: urgencyFor(score),
    reason,
    action: 'Reclamar el pago y registrar la cobranza',
  };
}

function scoreClaim(item: DailyContextItem): RuleScoredPriority {
  const slaHours = item.slaHoursOverdue ?? 0;
  const score =
    30 +
    (TICKET_PRIORITY_WEIGHT[item.ticketPriority ?? ''] ?? 0) +
    (clamp(slaHours, 0, SLA_CAP_HOURS) / SLA_CAP_HOURS) * 30 +
    (item.unassigned ? 12 : 0);

  const parts: string[] = [];
  if (slaHours > 0) parts.push(`SLA excedido en ${slaHours} h`);
  if (item.unassigned) parts.push('sin responsable asignado');
  if (parts.length === 0) parts.push(`Reclamo abierto de prioridad ${item.ticketPriority ?? 'Media'}`);

  return {
    ref: item.ref,
    score,
    urgency: urgencyFor(score),
    reason: parts.join(', '),
    action: item.unassigned
      ? 'Asignar responsable o derivar a un proveedor'
      : 'Retomar el reclamo y actualizar su estado',
  };
}

function scoreExpiry(item: DailyContextItem): RuleScoredPriority {
  const daysLeft = item.daysToDue ?? EXPIRY_HORIZON_DAYS;
  const score = 26 + (1 - clamp(daysLeft, 0, EXPIRY_HORIZON_DAYS) / EXPIRY_HORIZON_DAYS) * 44;

  return {
    ref: item.ref,
    score,
    urgency: urgencyFor(score),
    reason: daysLeft === 0 ? 'El contrato vence hoy' : `El contrato vence en ${pluralDays(daysLeft)}`,
    action: 'Iniciar la renovación o avisar la baja',
  };
}

function scoreFollowUp(item: DailyContextItem): RuleScoredPriority {
  const stale = item.daysSinceContact ?? 0;
  const score = 12 + (clamp(stale, 0, STALE_CAP_DAYS) / STALE_CAP_DAYS) * 26;

  return {
    ref: item.ref,
    score,
    urgency: urgencyFor(score),
    reason: `${pluralDays(stale)} sin contacto`,
    action: 'Retomar el contacto y registrar la interacción',
  };
}

// ─── Orden completo ───────────────────────────────────────

/**
 * Ordena el contexto del día de más a menos urgente.
 * El desempate va por referencia, así que dos corridas con el mismo contexto
 * devuelven exactamente la misma lista.
 */
export function rankByRules(items: DailyContextItem[]): RuleScoredPriority[] {
  const maxAmount = items
    .filter((i) => i.kind === 'cobranza')
    .reduce((max, i) => Math.max(max, i.amount ?? 0), 0);

  return items
    .map((item) => {
      switch (item.kind) {
        case 'cobranza':
          return scoreCollection(item, maxAmount);
        case 'reclamo':
          return scoreClaim(item);
        case 'contrato':
          return scoreExpiry(item);
        case 'lead':
          return scoreFollowUp(item);
      }
    })
    .map((scored) => ({ ...scored, score: Math.round(scored.score * 100) / 100 }))
    .sort((a, b) => b.score - a.score || a.ref.localeCompare(b.ref));
}
