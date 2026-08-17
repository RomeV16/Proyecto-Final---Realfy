/**
 * Contexto del día: qué está pendiente hoy en la operación, expresado de una
 * forma que se pueda ordenar por reglas o mandar a un modelo de lenguaje.
 *
 * Cada item guarda dos capas bien separadas: la identificación real (id, título,
 * contraparte), que no sale del servidor, y los datos objetivos (importes, días
 * de atraso, estado, prioridad), que son los únicos que viajan junto al
 * identificador opaco `ref`.
 */

/** Los cuatro frentes que compiten por la atención de un día de trabajo. */
export type PriorityKind = 'cobranza' | 'reclamo' | 'contrato' | 'lead';

/** Prefijo del identificador opaco de cada frente. */
export const REF_PREFIX: Record<PriorityKind, string> = {
  cobranza: 'C',
  reclamo: 'R',
  contrato: 'V',
  lead: 'L',
};

export interface DailyContextItem {
  /**
   * Identificador opaco y estable dentro del pedido (`C1`, `R2`, `V3`…).
   * Es lo único con lo que se puede referir al item fuera del servidor.
   */
  ref: string;
  kind: PriorityKind;

  // ── Identificación real — no sale del servidor ──
  /** Id de la entidad, para armar el enlace del panel. */
  entityId: string;
  /** Título legible: propiedad o asunto del reclamo. */
  title: string;
  /** Contraparte o detalle secundario. */
  subtitle: string | null;

  // ── Datos objetivos ──
  amount: number | null;
  currency: string | null;
  /** Días transcurridos desde el vencimiento (cobranzas). */
  daysOverdue: number | null;
  /** Días que faltan para el vencimiento (contratos). */
  daysToDue: number | null;
  /** Horas de exceso sobre el SLA (reclamos). */
  slaHoursOverdue: number | null;
  /** Sin responsable asignado ni proveedor derivado (reclamos). */
  unassigned: boolean;
  /** Prioridad declarada del reclamo. */
  ticketPriority: string | null;
  /** Estado de la entidad de origen. */
  status: string | null;
  /** Días sin contacto registrado (leads). */
  daysSinceContact: number | null;
}

export interface DailyContextTotals {
  overdueAmount: number;
  pendingAmount: number;
  overdueCollections: number;
  openTickets: number;
  expiringContracts: number;
  staleLeads: number;
}

export interface DailyContext {
  generatedAt: string;
  totals: DailyContextTotals;
  items: DailyContextItem[];
}

/**
 * Vista seudonimizada de un item: el identificador opaco más datos objetivos.
 * Deliberadamente no tiene lugar donde meter un nombre, un documento, un
 * correo, un teléfono ni un domicilio, así que un dato personal no puede
 * filtrarse por agregar un campo al item.
 */
export interface DailyContextFact {
  ref: string;
  tipo: PriorityKind;
  estado?: string;
  importe?: number;
  moneda?: string;
  diasDeAtraso?: number;
  diasParaVencer?: number;
  horasFueraDeSla?: number;
  sinResponsable?: boolean;
  prioridad?: string;
  diasSinContacto?: number;
}

/** Días enteros transcurridos entre dos instantes (negativo si `to` es anterior). */
export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

/** Horas enteras transcurridas entre dos instantes. */
export function hoursBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 3_600_000);
}

/** `C1`, `C2`, … para el enésimo item de un frente. */
export function buildRef(kind: PriorityKind, index: number): string {
  return `${REF_PREFIX[kind]}${index}`;
}

/**
 * Proyecta el contexto a la lista de hechos que se manda al modelo.
 * Copia campo por campo en lugar de descartar los que sobran: así el default es
 * no compartir, y un campo nuevo del item queda afuera hasta que alguien lo
 * agregue acá a propósito.
 */
export function toModelFacts(items: DailyContextItem[]): DailyContextFact[] {
  return items.map((item) => {
    const fact: DailyContextFact = { ref: item.ref, tipo: item.kind };
    if (item.status) fact.estado = item.status;
    if (item.amount !== null) fact.importe = item.amount;
    if (item.currency) fact.moneda = item.currency;
    if (item.daysOverdue !== null) fact.diasDeAtraso = item.daysOverdue;
    if (item.daysToDue !== null) fact.diasParaVencer = item.daysToDue;
    if (item.slaHoursOverdue !== null) fact.horasFueraDeSla = item.slaHoursOverdue;
    if (item.unassigned) fact.sinResponsable = true;
    if (item.ticketPriority) fact.prioridad = item.ticketPriority;
    if (item.daysSinceContact !== null) fact.diasSinContacto = item.daysSinceContact;
    return fact;
  });
}
