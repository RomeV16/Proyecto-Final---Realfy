'use client';

import { useTranslations } from 'next-intl';
import { usePathname, useParams } from 'next/navigation';
import Link from 'next/link';
import { useState, useEffect, useCallback } from 'react';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { TicketStatus } from '@realfy/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Reveal } from '@/components/ui/reveal';
import { Spinner } from '@/components/ui/spinner';

/* ──────────── Types ──────────── */

interface Party {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
}

interface Attachment {
  id: string;
  url: string;
  thumbnailUrl?: string;
}

interface TicketComment {
  id: string;
  content: string;
  createdAt: string;
  user?: Party | null;
  person?: Party | null;
  attachments?: Attachment[];
}

interface TicketDetail {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  slaDeadline?: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string | null;
  closedAt?: string | null;
  property?: { id: string; title: string; street?: string; number?: string; city?: string } | null;
  category?: { id: string; name: string } | null;
  createdBy?: Party | null;
  createdByPerson?: Party | null;
  assignedTo?: Party | null;
  provider?: Party | null;
  providerNotes?: string | null;
  comments: TicketComment[];
  validTransitions: string[];
}

interface ProviderOption {
  id: string;
  firstName: string;
  lastName: string;
  providerProfile?: { rubros?: string[]; coverageZones?: string[] } | null;
}

interface UserOption {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
}

/* ──────────── Helpers ──────────── */

function statusVariant(status: string): 'success' | 'danger' | 'warning' | 'info' | 'neutral' {
  switch (status) {
    case TicketStatus.Resuelto:
    case TicketStatus.Cerrado:
    case TicketStatus.TrabajoRealizado:
      return 'success';
    case TicketStatus.Cancelado:
      return 'danger';
    case TicketStatus.Abierto:
    case TicketStatus.Reabierto:
      return 'warning';
    default:
      return 'info';
  }
}

function priorityVariant(priority: string): 'danger' | 'warning' | 'info' | 'neutral' {
  switch (priority) {
    case 'Urgente':
      return 'danger';
    case 'Alta':
      return 'warning';
    case 'Media':
      return 'info';
    default:
      return 'neutral';
  }
}

function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function partyName(p?: Party | null): string {
  if (!p) return '—';
  return `${p.firstName} ${p.lastName}`;
}

const CAN_MANAGE_ROLES = ['Admin', 'Gerente', 'Soporte'];

/* ──────────── Detail Row ──────────── */

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="micro text-[var(--color-muted)]">{label}</p>
      <p className="text-sm font-medium text-[var(--color-text)] mt-0.5">{value}</p>
    </div>
  );
}

/* ──────────── Page ──────────── */

export default function TicketDetailPage() {
  const t = useTranslations('tickets');
  const pathname = usePathname();
  const params = useParams();
  const { user } = useAuth();
  const localePrefix = pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}|[a-z]{2})/)?.[0] || '/es';
  const ticketId = params.id as string;

  const canManage = CAN_MANAGE_ROLES.includes(user?.role || '');

  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Transition state
  const [transitioning, setTransitioning] = useState('');
  const [actionError, setActionError] = useState('');

  // Provider state
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [providersLoaded, setProvidersLoaded] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState('');
  const [providerNotes, setProviderNotes] = useState('');
  const [assigning, setAssigning] = useState(false);

  // Assignee state
  const [users, setUsers] = useState<UserOption[]>([]);
  const [selectedUser, setSelectedUser] = useState('');
  const [reassigning, setReassigning] = useState(false);

  // Comment state
  const [newComment, setNewComment] = useState('');
  const [postingComment, setPostingComment] = useState(false);
  const [commentError, setCommentError] = useState('');

  const loadTicket = useCallback(async () => {
    try {
      const data = await apiClient<TicketDetail>(`/tickets/${ticketId}`);
      setTicket(data);
    } catch (err) {
      if (err instanceof ApiRequestError && err.statusCode === 404) setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    loadTicket();
  }, [loadTicket]);

  async function loadProviders() {
    setProvidersLoaded(true);
    try {
      const list = await apiClient<ProviderOption[]>(`/providers/for-ticket/${ticketId}`);
      setProviders(Array.isArray(list) ? list : []);
    } catch {
      setProviders([]);
    }
  }

  /* Solo Admin y Gerente pueden listar usuarios: si vuelve 403 la seccion
     queda oculta en vez de romper la ficha. */
  const loadUsers = useCallback(async () => {
    try {
      const list = await apiClient<UserOption[]>('/users');
      setUsers(Array.isArray(list) ? list.filter((u) => u.isActive) : []);
    } catch {
      setUsers([]);
    }
  }, []);

  useEffect(() => {
    if (canManage) loadUsers();
  }, [canManage, loadUsers]);

  async function handleReassign() {
    if (!selectedUser) return;
    setReassigning(true);
    setActionError('');
    try {
      await apiClient(`/tickets/${ticketId}`, {
        method: 'PATCH',
        body: JSON.stringify({ assignedToUserId: selectedUser }),
      });
      setSelectedUser('');
      await loadTicket();
    } catch (err) {
      if (err instanceof ApiRequestError) setActionError(err.message);
      else setActionError(t('detail.reassignError'));
    } finally {
      setReassigning(false);
    }
  }

  async function handleTransition(status: string) {
    setTransitioning(status);
    setActionError('');
    try {
      await apiClient(`/tickets/${ticketId}/transition`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
      await loadTicket();
    } catch (err) {
      if (err instanceof ApiRequestError) setActionError(err.message);
      else setActionError(t('detail.transitionError'));
    } finally {
      setTransitioning('');
    }
  }

  async function handleAssignProvider() {
    if (!selectedProvider) return;
    setAssigning(true);
    setActionError('');
    try {
      const payload: Record<string, unknown> = { providerId: selectedProvider };
      if (providerNotes.trim()) payload.providerNotes = providerNotes.trim();
      await apiClient(`/tickets/${ticketId}/assign-provider`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setSelectedProvider('');
      setProviderNotes('');
      await loadTicket();
    } catch (err) {
      if (err instanceof ApiRequestError) setActionError(err.message);
      else setActionError(t('provider.assignError'));
    } finally {
      setAssigning(false);
    }
  }

  async function handlePostComment(e: React.FormEvent) {
    e.preventDefault();
    if (!newComment.trim()) return;
    setPostingComment(true);
    setCommentError('');
    try {
      await apiClient(`/tickets/${ticketId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ content: newComment.trim() }),
      });
      setNewComment('');
      await loadTicket();
    } catch (err) {
      if (err instanceof ApiRequestError) setCommentError(err.message);
      else setCommentError(t('timeline.commentError'));
    } finally {
      setPostingComment(false);
    }
  }

  /* ── Loading / Not found ── */

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner className="h-8 w-8 text-brand-500" />
      </div>
    );
  }

  if (notFound || !ticket) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
          <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
          </svg>
        </div>
        <h2 className="h3">{t('empty.detail')}</h2>
        <Link href={`${localePrefix}/tickets`} className="mt-4">
          <Button variant="secondary">{t('backToList')}</Button>
        </Link>
      </div>
    );
  }

  const propertyLabel = ticket.property
    ? [ticket.property.title, ticket.property.street, ticket.property.city].filter(Boolean).join(' · ')
    : '—';

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          href={`${localePrefix}/tickets`}
          className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          aria-label={t('backToList')}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
        </Link>
        <div>
          <p className="eyebrow">{t('detail.title')}</p>
          <h1 className="h2">{ticket.title}</h1>
        </div>
      </div>

      {actionError && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
          {actionError}
        </div>
      )}

      {/* Summary card */}
      <Reveal>
        <div className="card-lux p-6 space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={statusVariant(ticket.status)}>{t(`statuses.${ticket.status}`)}</Badge>
            <Badge variant={priorityVariant(ticket.priority)}>{t(`priorities.${ticket.priority}`)}</Badge>
          </div>

          {ticket.description && (
            <p className="text-sm text-[var(--color-text)] leading-relaxed whitespace-pre-wrap">
              {ticket.description}
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-[var(--color-border)]">
            <DetailRow label={t('detail.property')} value={propertyLabel} />
            <DetailRow label={t('detail.category')} value={ticket.category?.name || t('card.noCategory')} />
            <DetailRow label={t('detail.createdBy')} value={partyName(ticket.createdBy || ticket.createdByPerson)} />
            <DetailRow
              label={t('detail.assignedTo')}
              value={ticket.assignedTo ? partyName(ticket.assignedTo) : t('card.noAssignee')}
            />
            <DetailRow
              label="Fecha límite"
              value={ticket.slaDeadline ? formatDate(ticket.slaDeadline) : '—'}
            />
            <DetailRow label={t('detail.createdAt')} value={formatDate(ticket.createdAt)} />
          </div>
        </div>
      </Reveal>

      {/* Responsable */}
      {canManage && (
        <Reveal>
          <div className="card-lux space-y-4 p-6">
            <div>
              <p className="eyebrow">{t('detail.assignedTo')}</p>
              <h2 className="h3">
                {ticket.assignedTo ? partyName(ticket.assignedTo) : t('card.noAssignee')}
              </h2>
            </div>

            {users.length === 0 ? (
              <p className="text-sm text-[var(--color-muted)]">{t('detail.noUsers')}</p>
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <select
                  value={selectedUser}
                  onChange={(e) => setSelectedUser(e.target.value)}
                  className="h-11 flex-1 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 text-sm text-[var(--color-text)] focus:border-brand-500 focus:outline-none"
                >
                  <option value="">{t('detail.reassignPlaceholder')}</option>
                  {users
                    .filter((u) => u.id !== ticket.assignedTo?.id)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.firstName} {u.lastName} · {u.role}
                      </option>
                    ))}
                </select>
                <Button
                  variant="secondary"
                  onClick={handleReassign}
                  disabled={!selectedUser || reassigning}
                  className="shrink-0"
                >
                  {reassigning ? '…' : t('detail.reassign')}
                </Button>
              </div>
            )}
          </div>
        </Reveal>
      )}

      {/* Status transitions */}
      {canManage && (
        <Reveal>
          <div className="card-lux p-6 space-y-4">
            <div>
              <p className="eyebrow">{t('detail.transition')}</p>
              <h2 className="h3">¿Qué pasó con este ticket?</h2>
            </div>
            {ticket.validTransitions.length === 0 ? (
              <p className="text-sm text-[var(--color-muted)]">{t('detail.noTransitions')}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {ticket.validTransitions.map((status) => (
                  <Button
                    key={status}
                    variant="secondary"
                    size="sm"
                    disabled={!!transitioning}
                    onClick={() => handleTransition(status)}
                  >
                    {transitioning === status ? '…' : t(`statuses.${status}`)}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </Reveal>
      )}

      {/* Provider */}
      <Reveal>
        <div className="card-lux p-6 space-y-4">
          <div>
            <p className="eyebrow">{t('provider.title')}</p>
            <h2 className="h3">{t('provider.assign')}</h2>
          </div>

          {ticket.provider ? (
            <div className="space-y-1">
              <p className="text-sm font-medium text-[var(--color-text)]">
                {partyName(ticket.provider)}
              </p>
              <p className="micro text-[var(--color-muted)]">{t('provider.assigned')}</p>
              {ticket.providerNotes && (
                <p className="text-sm text-[var(--color-text)] mt-2 whitespace-pre-wrap">
                  {ticket.providerNotes}
                </p>
              )}
            </div>
          ) : canManage ? (
            <div className="space-y-3">
              {!providersLoaded ? (
                <Button variant="secondary" size="sm" onClick={loadProviders} type="button">
                  {t('provider.search')}
                </Button>
              ) : providers.length === 0 ? (
                <p className="text-sm text-[var(--color-muted)]">{t('provider.noProviders')}</p>
              ) : (
                <>
                  <select
                    value={selectedProvider}
                    onChange={(e) => setSelectedProvider(e.target.value)}
                    className="h-11 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 text-sm text-[var(--color-text)] focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-[color-mix(in_srgb,var(--color-brand-500)_15%,transparent)]"
                  >
                    <option value="">{t('provider.assignPlaceholder')}</option>
                    {providers.map((p) => {
                      const rubros = p.providerProfile?.rubros ?? [];
                      return (
                        <option key={p.id} value={p.id}>
                          {p.firstName} {p.lastName}
                          {rubros.length > 0 ? ` · ${rubros.join(', ')}` : ''}
                        </option>
                      );
                    })}
                  </select>
                  <textarea
                    value={providerNotes}
                    onChange={(e) => setProviderNotes(e.target.value)}
                    placeholder={t('provider.notesPlaceholder')}
                    rows={2}
                    className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2.5 text-sm text-[var(--color-text)] placeholder:text-[var(--color-muted)] focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-[color-mix(in_srgb,var(--color-brand-500)_15%,transparent)] resize-y"
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    type="button"
                    disabled={!selectedProvider || assigning}
                    onClick={handleAssignProvider}
                  >
                    {assigning ? '…' : t('provider.assign')}
                  </Button>
                </>
              )}
            </div>
          ) : (
            <p className="text-sm text-[var(--color-muted)]">{t('card.noAssignee')}</p>
          )}
        </div>
      </Reveal>

      {/* Activity / Comments */}
      <Reveal>
        <div className="card-lux p-6 space-y-4">
          <div>
            <p className="eyebrow">{t('timeline.title')}</p>
            <h2 className="h3">{t('timeline.addComment')}</h2>
          </div>

          {ticket.comments.length === 0 ? (
            <p className="text-sm text-[var(--color-muted)]">{t('timeline.noComments')}</p>
          ) : (
            <ul className="space-y-4">
              {ticket.comments.map((c) => (
                <li key={c.id} className="flex gap-3">
                  <div className="w-9 h-9 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-bold shrink-0">
                    {(c.user?.firstName || c.person?.firstName || '?').charAt(0)}
                    {(c.user?.lastName || c.person?.lastName || '').charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium text-[var(--color-text)]">
                        {partyName(c.user || c.person)}
                      </span>
                      <span className="micro text-[var(--color-muted)]">{formatDate(c.createdAt)}</span>
                    </div>
                    <p className="text-sm text-[var(--color-text)] mt-0.5 whitespace-pre-wrap">{c.content}</p>
                    {c.attachments && c.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {c.attachments.map((a) => (
                          <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={a.thumbnailUrl || a.url}
                              alt={t('timeline.photo')}
                              className="w-20 h-20 object-cover rounded-lg border border-[var(--color-border)]"
                            />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {canManage && (
            <form onSubmit={handlePostComment} className="space-y-3 pt-2 border-t border-[var(--color-border)]">
              {commentError && (
                <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">
                  {commentError}
                </div>
              )}
              <textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder={t('timeline.commentPlaceholder')}
                rows={3}
                maxLength={10000}
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2.5 text-sm text-[var(--color-text)] placeholder:text-[var(--color-muted)] focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-[color-mix(in_srgb,var(--color-brand-500)_15%,transparent)] resize-y"
              />
              <Button type="submit" variant="primary" size="sm" disabled={!newComment.trim() || postingComment}>
                {postingComment ? t('timeline.submitting') : t('timeline.submit')}
              </Button>
            </form>
          )}
        </div>
      </Reveal>
    </div>
  );
}
