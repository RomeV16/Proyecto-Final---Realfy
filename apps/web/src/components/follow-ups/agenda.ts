import type { FollowUp } from '@/lib/follow-ups';

/** Tramos de la agenda de vencimientos, del más urgente al menos; los cerrados van al final. */
export const AGENDA_KEYS = ['overdue', 'today', 'week', 'month', 'later', 'closed'] as const;

export type AgendaKey = (typeof AGENDA_KEYS)[number];

/** Tramo de un seguimiento según los días que faltan para el fin real del contrato. */
export function agendaKeyOf(followUp: Pick<FollowUp, 'status' | 'daysLeft'>): AgendaKey {
  if (followUp.status === 'Cerrado') return 'closed';
  const days = followUp.daysLeft;
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  if (days <= 7) return 'week';
  return days <= 30 ? 'month' : 'later';
}

export interface AgendaGroup {
  key: AgendaKey;
  items: FollowUp[];
}

/** Agrupa los seguimientos por tramo; dentro de cada uno, primero el que vence antes. */
export function groupAgenda(items: readonly FollowUp[]): AgendaGroup[] {
  return AGENDA_KEYS.map((key) => ({
    key,
    items: items.filter((f) => agendaKeyOf(f) === key).sort((a, b) => a.daysLeft - b.daysLeft),
  }));
}
