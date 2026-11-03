import { useEffect, useState } from 'react';
import { ConversationChannel, ConversationStatus, type SlaState } from '@realfy/shared';

export { slaState } from '@realfy/shared';

export const INBOX_CHANNELS = [
  ConversationChannel.WhatsApp,
  ConversationChannel.Email,
  ConversationChannel.Web,
  ConversationChannel.Telefono,
] as const;

export const INBOX_STATUSES = [
  ConversationStatus.Nueva,
  ConversationStatus.Asignada,
  ConversationStatus.EnCurso,
  ConversationStatus.Esperando,
  ConversationStatus.Resuelta,
  ConversationStatus.Archivada,
] as const;

export interface ConversationListItem {
  id: string;
  channel: ConversationChannel;
  subject: string | null;
  counterpartName: string | null;
  address: string;
  status: ConversationStatus;
  assigneeUserId: string | null;
  assigneeName: string | null;
  unread: number;
  slaDueAt: string | null;
  slaBreachedAt: string | null;
  firstResponseAt: string | null;
  slaState: SlaState;
  lastMessageAt: string;
  preview: string | null;
}

export interface ConversationPage {
  items: ConversationListItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ConversationMessageView {
  id: string;
  direction: 'In' | 'Out';
  body: string;
  at: string;
  isAutoReply: boolean;
  authorUserId: string | null;
  delivery: { status: string; reason: string | null; error: string | null } | null;
}

export type ReplyBlockedReason = 'CONTACT_OPTED_OUT' | 'WHATSAPP_WINDOW_CLOSED' | 'NO_REPLY_CHANNEL';

export interface ConversationDetail {
  id: string;
  channel: ConversationChannel;
  address: string;
  counterpartName: string | null;
  subject: string | null;
  status: ConversationStatus;
  assignee: { id: string; name: string } | null;
  person: { id: string; firstName: string; lastName: string; email: string | null; phone: string | null } | null;
  lead: { id: string; status: string; propertyId: string | null } | null;
  related: { type: 'Property' | 'Contract'; id: string } | null;
  unread: number;
  firstResponseAt: string | null;
  slaDueAt: string | null;
  slaBreachedAt: string | null;
  slaState: SlaState;
  lastMessageAt: string;
  replyRoute: { channel: string; to: string } | null;
  replyBlockedReason: ReplyBlockedReason | null;
  messages: ConversationMessageView[];
}

export interface InboxSummary {
  unread: number;
  breached: number;
  unassigned: number;
}

export interface InboxFilters {
  scope: 'open' | 'all';
  status: '' | ConversationStatus;
  channel: '' | ConversationChannel;
  assignee: '' | 'me' | 'none';
  slaBreached: boolean;
  search: string;
}

export const EMPTY_INBOX_FILTERS: InboxFilters = {
  scope: 'open',
  status: '',
  channel: '',
  assignee: '',
  slaBreached: false,
  search: '',
};

/** Query string de la lista a partir de los filtros de la pantalla. */
export function inboxQuery(filters: InboxFilters, page = 1, limit = 50): string {
  const q = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (filters.status) q.set('status', filters.status);
  else if (filters.scope === 'open') q.set('open', 'true');
  if (filters.channel) q.set('channel', filters.channel);
  if (filters.assignee) q.set('assignee', filters.assignee);
  if (filters.slaBreached) q.set('slaBreached', 'true');
  if (filters.search.trim()) q.set('search', filters.search.trim());
  return q.toString();
}

/** Tiempo que falta (o que pasó) hasta el vencimiento: "12:05" o "1 h 05" para plazos largos; el signo lo da `overdue`. */
export function formatCountdown(ms: number): { text: string; overdue: boolean } {
  const overdue = ms <= 0;
  const total = Math.floor(Math.abs(ms) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  const text = hours > 0 ? `${hours} h ${two(minutes)}` : `${two(minutes)}:${two(seconds)}`;
  return { text, overdue };
}

/** Reloj de pantalla: un `Date` que se actualiza cada `everyMs`. */
export function useNow(everyMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

/** Completa {name} de una respuesta rápida con el nombre de pila de quien escribió. */
export function fillQuickReply(body: string, counterpartName: string | null | undefined): string {
  const first = (counterpartName ?? '').trim().split(/\s+/)[0] ?? '';
  return body.replaceAll(' {name}', first ? ` ${first}` : '').replaceAll('{name}', first);
}
