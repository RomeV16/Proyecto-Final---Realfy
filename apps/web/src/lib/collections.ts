import { CollectionActionKind, CollectionActionStatus, CollectionStage } from '@realfy/shared';

/**
 * Ayudas de la cobranza escalonada para la web: etapas y filtros del listado,
 * enlaces y qué acciones admite un caso (las mismas reglas que aplica la API).
 */

export const COLLECTION_STAGES = Object.values(CollectionStage);

/** Cantidad de días de mora que ofrece el filtro del listado. */
export const MIN_DAYS_OPTIONS = ['5', '10', '15', '30', '60'] as const;

/** Filtros del listado; un `type` para que sirva con `usePaginatedList`. */
export type CaseFilterValues = {
  stage: string;
  minDays: string;
  assigneeId: string;
};

export const EMPTY_CASE_FILTERS: CaseFilterValues = { stage: '', minDays: '', assigneeId: '' };

export const caseHref = (id: string) => `/cobranza/${id}`;

/** `GET /collection-cases` de los casos abiertos de un contrato (el detalle del contrato). */
export const contractCasesPath = (contractId: string) => `/collection-cases?contractId=${contractId}&limit=5`;

export const letterPdfPath = (caseId: string, actionId: string) => `/collection-cases/${caseId}/actions/${actionId}/letter.pdf`;

/** Etapas desde las que la API deja derivar a un abogado (las mismas de la máquina de estados). */
const CAN_DERIVE: readonly string[] = [CollectionStage.Recordatorio, CollectionStage.Prejudicial];

export const canDerive = (stage: string) => CAN_DERIVE.includes(stage);
export const canJudicialize = (stage: string) => stage === CollectionStage.Abogado;
export const isOpen = (stage: string) => stage !== CollectionStage.Cerrado;

/** La carta documento preparada espera que alguien confirme que se mandó en papel. */
export const isLetterPending = (action: { kind: string; status: string }) =>
  action.kind === CollectionActionKind.CartaDocumento && action.status === CollectionActionStatus.Preparada;

/** Los avisos que salen por la bandeja de salida (llevan canal y mensaje). */
export const isReminder = (kind: string) =>
  kind === CollectionActionKind.Recordatorio || kind === CollectionActionKind.RecordatorioFirme;

/** Tono del aviso de los días de mora: del amarillo (primeros días) al rojo (más de un mes). */
export function overdueTone(days: number): 'warning' | 'danger' | 'neutral' {
  if (days >= 30) return 'danger';
  return days > 0 ? 'warning' : 'neutral';
}

/** Total adeudado hoy de una lista de casos de la misma moneda (para el resumen de la pantalla). */
export function totalPayoff(items: readonly { payoffToday: string; currency: string }[], currency: string): number {
  return items.filter((i) => i.currency === currency).reduce((sum, i) => sum + Number(i.payoffToday), 0);
}
