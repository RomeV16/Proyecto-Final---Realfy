import { addMonthsClamped } from '../date-utils';
import { CollectionActionKind, CollectionStage } from '../enums';

/**
 * Política de cobranza escalonada (ADR-0013). Pura: no lee la base ni el reloj;
 * `today` es el día calendario de Buenos Aires a medianoche UTC, igual que los
 * vencimientos. Dado un caso y el día, dice qué toca hacer y cuándo.
 *
 * Línea de tiempo con los valores de fábrica (vencimiento el día D):
 *   D+5   recordatorio amable (nivel 1)
 *   D+10  recordatorio más firme (nivel 2)
 *   D+15  recordatorio firme (nivel 3); se repite cada 5 días hasta el prejudicial
 *   D'+1  (D' = vencimiento del alquiler siguiente, impago) prejudicial: se
 *         prepara la carta documento para enviarla en papel
 *   E+10  (E = envío confirmado de la carta) vence el plazo: se sugiere derivar
 *         a un abogado
 * Nada legal sale solo: la carta se prepara, se confirma a mano y la derivación
 * es una decisión de una persona.
 */

export const COLLECTION_MAX_LEVEL = 3;

export interface CollectionPolicy {
  /** Apagada, el proceso diario no abre casos ni manda avisos. */
  enabled: boolean;
  /** Días desde el vencimiento hasta el primer recordatorio. */
  firstReminderDays: number;
  /** Días entre un recordatorio y el siguiente. */
  everyDays: number;
  /** Cantidad de recordatorios (y niveles de tono), de 1 a 3. */
  maxLevel: number;
  /** Plazo de la carta documento, en días corridos desde su envío. */
  letterTermDays: number;
  /** Agotados los niveles, sigue mandando el último cada `everyDays` hasta que el caso pase a prejudicial. */
  repeatLastLevel: boolean;
}

export const DEFAULT_COLLECTION_POLICY: CollectionPolicy = {
  enabled: false,
  firstReminderDays: 5,
  everyDays: 5,
  maxLevel: COLLECTION_MAX_LEVEL,
  letterTermDays: 10,
  repeatLastLevel: true,
};

export interface CollectionCaseInput {
  stage: CollectionStage;
  /** Vencimiento de cada liquidación con saldo, vencida o no. Sin orden. */
  unpaidDueDates: readonly Date[];
  /** Hay una liquidación posterior a la más vieja impaga (de cualquier estado menos anulada). */
  nextRentBilled: boolean;
  /** Día de cada recordatorio ya hecho. */
  reminderDates: readonly Date[];
  /** Último día de un acuerdo de pago; null si no hay. */
  agreementUntil: Date | null;
  /** Carta documento: día en que se preparó y día en que se confirmó el envío. */
  letterPreparedOn: Date | null;
  letterSentOn: Date | null;
}

export type CollectionPlanStatus =
  /** Sin deuda vencida: el caso se cierra. */
  | 'Close'
  /** Hay una acción con fecha (`dueOn`), o ninguna por ahora. */
  | 'Scheduled'
  /** Acuerdo de pago vigente. */
  | 'Paused'
  /** Carta preparada: falta que alguien confirme el envío. */
  | 'AwaitingLetterConfirmation'
  /** Derivado o en juicio: nada automático. */
  | 'Manual';

export interface CollectionPlan {
  status: CollectionPlanStatus;
  /** Próxima acción; null si no hay una. */
  action: CollectionActionKind | null;
  /** Día en que toca (hoy o en el pasado: ya toca). */
  dueOn: Date | null;
  /** Nivel de tono del recordatorio (1 a 3). */
  level: number | null;
  /** Una persona decide: el proceso diario no la ejecuta, solo la muestra. */
  manual: boolean;
}

const DAY_MS = 86_400_000;

const dayOf = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
export const addDays = (d: Date, days: number): Date => new Date(dayOf(d) + days * DAY_MS);
const maxDate = (a: Date, b: Date) => (dayOf(a) >= dayOf(b) ? a : b);

/** Días de mora de un vencimiento a `today` (0 si todavía no pasó). */
export function daysOverdue(dueDate: Date, today: Date): number {
  return Math.max(0, Math.round((dayOf(today) - dayOf(dueDate)) / DAY_MS));
}

/** Acción de un recordatorio según su nivel: el primero es amable, los demás son más firmes. */
export function reminderKind(level: number): CollectionActionKind {
  return level <= 1 ? CollectionActionKind.Recordatorio : CollectionActionKind.RecordatorioFirme;
}

/**
 * Día en que vence el alquiler siguiente al más viejo impago: el segundo
 * vencimiento impago o, si no hay otro, un mes después del primero (solo
 * cuando no hay una liquidación posterior, por ejemplo ya pagada).
 */
function nextRentDueDate(sorted: readonly Date[], nextRentBilled: boolean): Date | null {
  if (sorted.length > 1) return sorted[1];
  return nextRentBilled ? null : addMonthsClamped(sorted[0], 1);
}

const none = (status: CollectionPlanStatus): CollectionPlan => ({
  status,
  action: null,
  dueOn: null,
  level: null,
  manual: false,
});

/**
 * Qué toca en un caso hoy. Reglas:
 * - Sin deuda vencida con saldo, se cierra (un pago parcial deja saldo: sigue abierto).
 * - Un acuerdo de pago pausa hasta su último día; si no se cumple, se retoma al día siguiente.
 * - Los recordatorios nunca salen más seguido que `everyDays`, ni se juntan al retomar. Agotados los niveles,
 *   el último se repite cada `everyDays` hasta el prejudicial (`repeatLastLevel`).
 * - Al vencer el alquiler siguiente impago se prepara la carta documento; los recordatorios que quedaban se saltean.
 * - Con la carta enviada, vencido el plazo se sugiere derivar a un abogado (manual).
 * - Derivado o judicial: sin acciones automáticas.
 */
export function planCollection(input: CollectionCaseInput, today: Date, policy: CollectionPolicy): CollectionPlan {
  if (input.stage === CollectionStage.Cerrado) return none('Close');
  const overdue = input.unpaidDueDates.filter((d) => dayOf(d) < dayOf(today));
  if (overdue.length === 0) return none('Close');
  if (input.stage === CollectionStage.Abogado || input.stage === CollectionStage.Judicial) return none('Manual');

  const agreement = input.agreementUntil;
  if (agreement && dayOf(agreement) >= dayOf(today)) {
    return { ...none('Paused'), dueOn: addDays(agreement, 1) };
  }
  if (input.letterSentOn) {
    return {
      status: 'Scheduled',
      action: CollectionActionKind.DerivacionAbogado,
      dueOn: addDays(input.letterSentOn, policy.letterTermDays),
      level: null,
      manual: true,
    };
  }
  if (input.letterPreparedOn) {
    return { ...none('AwaitingLetterConfirmation'), action: CollectionActionKind.CartaDocumento, manual: true };
  }

  const sorted = [...input.unpaidDueDates].sort((a, b) => dayOf(a) - dayOf(b));
  const oldest = sorted[0];
  // Un acuerdo que ya pasó sin cumplirse retoma al día siguiente.
  const resumeFloor = agreement ? addDays(agreement, 1) : null;

  const nextRent = nextRentDueDate(sorted, input.nextRentBilled);
  const prejudicialOn = nextRent ? addDays(nextRent, 1) : null;
  const letterOn = prejudicialOn && resumeFloor ? maxDate(prejudicialOn, resumeFloor) : prejudicialOn;

  const sent = input.reminderDates.filter((d) => dayOf(d) >= dayOf(oldest)).sort((a, b) => dayOf(a) - dayOf(b));
  const levels = Math.min(policy.maxLevel, COLLECTION_MAX_LEVEL);
  // Con los niveles agotados el último se repite (si la política lo pide) hasta el prejudicial.
  const level = Math.min(sent.length + 1, levels);
  let reminderOn: Date | null = null;
  if (sent.length < levels || policy.repeatLastLevel) {
    reminderOn = addDays(oldest, policy.firstReminderDays + sent.length * policy.everyDays);
    if (sent.length > 0) reminderOn = maxDate(reminderOn, addDays(sent[sent.length - 1], policy.everyDays));
    if (resumeFloor) reminderOn = maxDate(reminderOn, resumeFloor);
  }

  // Si la carta ya tocaba (una mora vieja, por ejemplo cargada desde el sistema anterior), no se
  // manda antes un recordatorio amable: va directo a la etapa que corresponde.
  if (letterOn && (!reminderOn || dayOf(letterOn) <= dayOf(reminderOn) || dayOf(letterOn) <= dayOf(today))) {
    return { status: 'Scheduled', action: CollectionActionKind.CartaDocumento, dueOn: letterOn, level: null, manual: false };
  }
  if (reminderOn) {
    return { status: 'Scheduled', action: reminderKind(level), dueOn: reminderOn, level, manual: false };
  }
  // Recordatorios agotados sin repetición y sin alquiler siguiente a la vista: queda a la espera.
  return none('Scheduled');
}

/** La acción toca hoy o ya tocaba. */
export function isActionDue(plan: CollectionPlan, today: Date): boolean {
  return plan.action !== null && plan.dueOn !== null && dayOf(plan.dueOn) <= dayOf(today);
}

/** Etapa en que queda el caso después de realizar una acción. */
export function stageAfter(action: CollectionActionKind, current: CollectionStage): CollectionStage {
  if (action === CollectionActionKind.CartaDocumento && current === CollectionStage.Recordatorio) {
    return CollectionStage.Prejudicial;
  }
  if (action === CollectionActionKind.DerivacionAbogado) return CollectionStage.Abogado;
  return current;
}

// ─── Carta documento (borrador) ─────────────────────────

/** Campos editables del borrador de la carta documento. */
export interface LetterFields {
  recipientName: string;
  recipientAddress: string;
  propertyAddress: string;
  /** Períodos adeudados, por ejemplo «03/2026 y 04/2026». */
  periods: string;
  /** Importe adeudado al día del borrador, ya formateado. */
  amount: string;
  /** Fecha del borrador (dd/mm/aaaa). */
  issuedOn: string;
  termDays: number;
  /** Texto libre que el estudio o la inmobiliaria quiera agregar. */
  extraText: string;
}

/** «03/2026», «03/2026 y 04/2026», «03/2026, 04/2026 y 05/2026». */
export function joinPeriods(periods: readonly string[]): string {
  if (periods.length <= 1) return periods[0] ?? '';
  return `${periods.slice(0, -1).join(', ')} y ${periods[periods.length - 1]}`;
}
