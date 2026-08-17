import type { ContractClosureMetrics } from '@realfy/shared';

/**
 * Resumen de gestión al cierre de un contrato: piezas compartidas entre el
 * cálculo de las métricas, la redacción por plantilla y la redacción por modelo.
 *
 * La regla que ordena todo el módulo: **las cifras las calcula el servidor y el
 * modelo sólo las redacta**. Las métricas se computan de forma determinista
 * contra los registros reales del contrato; al modelo se le manda esa misma
 * grilla ya cerrada, seudonimizada, y se le pide únicamente prosa. Como la
 * respuesta esperada no tiene ni un campo numérico, no hay lugar donde pueda
 * aparecer un número inventado, y `containsOnlyKnownFigures` verifica que
 * tampoco se cuele uno en el texto.
 */

/**
 * Estados en los que un contrato ya terminó su vida útil y corresponde
 * resumirlo. `Renovado` cuenta como cierre: la vigencia sigue en un contrato
 * nuevo, pero la gestión del que se renovó ya está completa y vale resumirla.
 */
export const CLOSED_CONTRACT_STATUSES = [
  'Vencido',
  'Rescindido',
  'Renovado',
  'Archivado',
] as const;

export type ClosedContractStatus = (typeof CLOSED_CONTRACT_STATUSES)[number];

/** El contrato está en un estado de cierre. */
export function isClosedStatus(status: string): boolean {
  return (CLOSED_CONTRACT_STATUSES as readonly string[]).includes(status);
}

/**
 * Vista seudonimizada de las métricas: exactamente los mismos números, con los
 * nombres de campo en castellano y sin un solo lugar donde pueda entrar un dato
 * de las personas involucradas.
 *
 * No tiene campos para nombre, documento, correo, teléfono, domicilio,
 * propiedad ni identificadores internos, así que un dato personal no puede
 * filtrarse por agregar una columna a la consulta: hay que agregar el campo acá
 * a propósito.
 */
export interface ContractClosureFacts {
  tipoDeContrato: string;
  estadoDeCierre: string;
  inicioDeVigencia: string;
  finPactado: string;
  cierreEfectivo: string;
  mesesDeVigencia: number;
  diasDeVigencia: number;
  cerroAntesDeLoPactado: boolean;
  moneda: string;

  liquidacionesEmitidas: number;
  liquidacionesCobradas: number;
  pagosEnTermino: number;
  pagosConAtraso: number;
  liquidacionesSinCobrar: number;
  porcentajeDePuntualidad: number;
  atrasoPromedioEnDias: number;
  atrasoMaximoEnDias: number;
  montoFacturado: number;
  montoCobrado: number;
  montoPendiente: number;

  punitoriosAplicados: number;
  montoDePunitorios: number;
  punitoriosCondonados: number;

  reclamosRecibidos: number;
  reclamosResueltos: number;
  reclamosAnulados: number;
  reclamosSinCerrar: number;
  diasPromedioDeResolucion: number | null;
  costoDeReclamos: number;

  ajustesAplicados: number;
  alquilerInicial: number;
  alquilerFinal: number;
  variacionDelAlquilerEnPorcentaje: number;

  rendicionesEmitidas: number;
  montoNetoRendido: number;
}

/**
 * Proyecta las métricas a los hechos que se mandan al modelo.
 *
 * Copia campo por campo en lugar de descartar los que sobran: el default es no
 * compartir, y una métrica nueva queda afuera del pedido hasta que alguien la
 * agregue acá.
 */
export function toClosureFacts(metrics: ContractClosureMetrics): ContractClosureFacts {
  return {
    tipoDeContrato: metrics.contractType,
    estadoDeCierre: metrics.closureStatus,
    inicioDeVigencia: metrics.startDate,
    finPactado: metrics.endDate,
    cierreEfectivo: metrics.closedOn,
    mesesDeVigencia: metrics.durationMonths,
    diasDeVigencia: metrics.durationDays,
    cerroAntesDeLoPactado: metrics.endedEarly,
    moneda: metrics.currency,

    liquidacionesEmitidas: metrics.billedCount,
    liquidacionesCobradas: metrics.paidCount,
    pagosEnTermino: metrics.onTimeCount,
    pagosConAtraso: metrics.lateCount,
    liquidacionesSinCobrar: metrics.unpaidCount,
    porcentajeDePuntualidad: metrics.onTimeRate,
    atrasoPromedioEnDias: metrics.averageDelayDays,
    atrasoMaximoEnDias: metrics.maxDelayDays,
    montoFacturado: metrics.billedAmount,
    montoCobrado: metrics.collectedAmount,
    montoPendiente: metrics.outstandingAmount,

    punitoriosAplicados: metrics.penaltyCount,
    montoDePunitorios: metrics.penaltyAmount,
    punitoriosCondonados: metrics.penaltyWaivedCount,

    reclamosRecibidos: metrics.ticketCount,
    reclamosResueltos: metrics.ticketsResolved,
    reclamosAnulados: metrics.ticketsCancelled,
    reclamosSinCerrar: metrics.ticketsOpen,
    diasPromedioDeResolucion: metrics.averageResolutionDays,
    costoDeReclamos: metrics.ticketCostAmount,

    ajustesAplicados: metrics.adjustmentCount,
    alquilerInicial: metrics.firstRent,
    alquilerFinal: metrics.lastRent,
    variacionDelAlquilerEnPorcentaje: metrics.rentIncreasePct,

    rendicionesEmitidas: metrics.rendicionCount,
    montoNetoRendido: metrics.rendicionNetAmount,
  };
}

// ─── Guardia de cifras ────────────────────────────────────

/** Separador de miles entre dígitos, tal como se escribe en castellano. */
const THOUSANDS_SEPARATOR = /(?<=\d)[.,\s](?=\d{3}(?:\D|$))/g;

/** Cualquier número escrito con dígitos, con o sin decimales. */
const NUMBER_TOKEN = /\d+(?:[.,]\d+)?/g;

/** Redondeos con los que es razonable que alguien cite una métrica. */
function renderings(value: number): string[] {
  const abs = Math.abs(value);
  return [
    String(abs),
    String(Math.round(abs)),
    String(Math.trunc(abs)),
    String(Math.round(abs * 10) / 10),
    abs.toFixed(1),
    abs.toFixed(2),
  ];
}

/**
 * Las cifras que el texto puede citar: las de la grilla y nada más.
 *
 * Toma los valores numéricos con sus redondeos razonables y también los números
 * que aparecen dentro de los valores de texto — las fechas de vigencia — para
 * que se pueda escribir "hasta diciembre de 2025" sin que cuente como una cifra
 * inventada.
 */
export function knownFigures(facts: ContractClosureFacts): Set<string> {
  const allowed = new Set<string>();

  for (const value of Object.values(facts)) {
    if (typeof value === 'number') {
      for (const rendering of renderings(value)) {
        allowed.add(normalizeFigure(rendering));
      }
      continue;
    }
    if (typeof value !== 'string') continue;
    for (const match of value.matchAll(NUMBER_TOKEN)) {
      allowed.add(normalizeFigure(match[0]));
    }
  }

  return allowed;
}

/** Deja el número en una forma comparable: sin miles y con punto decimal. */
function normalizeFigure(token: string): string {
  const withoutThousands = token.replace(THOUSANDS_SEPARATOR, '');
  const normalized = withoutThousands.replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? String(parsed) : normalized;
}

/**
 * Todas las cifras del texto salen de las métricas.
 *
 * Es la contracara verificable de "el modelo no calcula": si el texto trae un
 * número que no está en la grilla que se le mandó, el resumen se descarta y lo
 * redactan las plantillas. Devuelve el primer número ajeno encontrado, o `null`
 * si el texto está limpio.
 */
export function findUnknownFigure(
  text: string,
  facts: ContractClosureFacts,
): string | null {
  const allowed = knownFigures(facts);
  const flattened = text.replace(THOUSANDS_SEPARATOR, '');

  for (const match of flattened.matchAll(NUMBER_TOKEN)) {
    if (!allowed.has(normalizeFigure(match[0]))) return match[0];
  }
  return null;
}
