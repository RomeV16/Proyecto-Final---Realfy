'use client';

import { useTranslations } from 'next-intl';
import { Spinner } from '@/components/ui/spinner';
import { usePathname, useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import {
  InteractionType,
  VisitStatus,
  VisitOutcome,
  renderTemplate,
} from '@realfy/shared';
import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { EmptyState } from '@/components/ui/empty-state';
import { RowList } from '@/components/ui/card-grid';
import { EntityRow } from '@/components/ui/entity-card';
import { ListTransition, AnimatedList, StaggerItem, type ListState } from '@/components/ui/motion';

/* ──────────── Types ──────────── */

interface LeadDetail {
  id: string;
  tenantId: string;
  personId: string;
  pipelineId: string;
  currentStageId: string;
  propertyId?: string | null;
  assignedToUserId?: string | null;
  source: string;
  status: string;
  notes?: string | null;
  budget?: number | null;
  budgetCurrency: string;
  lostReason?: string | null;
  lastContactAt?: string | null;
  createdAt: string;
  updatedAt: string;
  person: {
    id: string;
    firstName: string;
    lastName: string;
    email?: string | null;
    phone?: string | null;
  };
  pipeline: { id: string; name: string; type: string };
  currentStage: { id: string; name: string };
  assignedToUser?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  } | null;
}

interface Interaction {
  id: string;
  type: string;
  notes?: string | null;
  contactedBy?: string | null;
  occurredAt: string;
  user?: { firstName: string; lastName: string } | null;
}

interface Visit {
  id: string;
  scheduledAt: string;
  completedAt?: string | null;
  status: string;
  outcome?: string | null;
  notes?: string | null;
  conductedBy?: string | null;
  property?: {
    id: string;
    title?: string | null;
    street?: string | null;
    number?: string | null;
    city?: string | null;
  } | null;
  user?: { firstName: string; lastName: string } | null;
}

interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  variables: string[];
  isActive: boolean;
}

/* ──────────── Helpers ──────────── */

function buildWhatsAppLink(
  phone: string,
  leadName: string,
  propertyAddress?: string,
): string {
  const message = `Hola ${leadName}${propertyAddress ? `, te contacto por la propiedad en ${propertyAddress}` : ''}`;
  const cleanPhone = phone.replace(/\D/g, '');
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
}

const INTERACTION_ICON: Record<string, 'phone' | 'mail' | 'calendar' | 'edit'> = {
  Llamada: 'phone',
  Email: 'mail',
  WhatsApp: 'phone',
  Visita: 'calendar',
  Nota: 'edit',
};

const STATUS_VARIANT: Record<string, 'info' | 'warning' | 'success' | 'danger' | 'neutral'> = {
  Nuevo: 'info',
  Contactado: 'warning',
  Calificado: 'success',
  Convertido: 'success',
  Perdido: 'danger',
};

const VISIT_STATUS_VARIANT: Record<string, 'info' | 'warning' | 'success' | 'danger' | 'neutral'> = {
  Programada: 'info',
  Completada: 'success',
  Cancelada: 'danger',
  NoShow: 'warning',
};

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return 'ahora';
  if (diffMin < 60) return `hace ${diffMin} min`;
  if (diffHrs < 24) return `hace ${diffHrs}h`;
  if (diffDays < 7) return `hace ${diffDays}d`;
  return date.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function visitAddress(visit: Visit): string | undefined {
  if (!visit.property) return undefined;
  const p = visit.property;
  const parts = [p.street, p.number, p.city].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : (p.title ?? undefined);
}

/* ──────────── Detail Row ──────────── */

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="micro text-[var(--color-muted)]">{label}</p>
      <p className="text-sm font-medium text-[var(--color-text)] mt-0.5">{value}</p>
    </div>
  );
}

/* ──────────── Main Page ──────────── */

export default function LeadDetailPage() {
  const t = useTranslations('interactions');
  const tLeads = useTranslations('leads');
  const tCommon = useTranslations('common');
  const pathname = usePathname();
  const params = useParams();
  const { user } = useAuth();
  const localePrefix = pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}|[a-z]{2})/)?.[0] || '/es';
  const leadId = params.id as string;

  // ── Core state ──
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // ── Modal state ──
  const [showInteractionModal, setShowInteractionModal] = useState(false);
  const [showVisitModal, setShowVisitModal] = useState(false);
  const [showUpdateVisitModal, setShowUpdateVisitModal] = useState(false);
  const [selectedVisit, setSelectedVisit] = useState<Visit | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // ── Send email state ──
  const [showSendEmailModal, setShowSendEmailModal] = useState(false);
  const [emailTemplates, setEmailTemplates] = useState<EmailTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);

  // ── Interaction form ──
  const [interactionType, setInteractionType] = useState<string>(InteractionType.Llamada);
  const [interactionNotes, setInteractionNotes] = useState('');

  // ── Visit form ──
  const [visitScheduledAt, setVisitScheduledAt] = useState('');
  const [visitNotes, setVisitNotes] = useState('');

  // ── Update visit form ──
  const [visitStatus, setVisitStatus] = useState<string>(VisitStatus.Programada);
  const [visitOutcome, setVisitOutcome] = useState<string>('');

  const canEdit = ['Admin', 'Gerente', 'Ventas'].includes(user?.role || '');

  // ── Flash message auto-dismiss ──
  useEffect(() => {
    if (successMsg) {
      const timer = setTimeout(() => setSuccessMsg(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [successMsg]);

  // ── Data fetching ──
  const loadData = useCallback(async () => {
    try {
      const [leadData, interactionsData, visitsData] = await Promise.all([
        apiClient<LeadDetail>(`/leads/${leadId}`),
        apiClient<PaginatedResponse<Interaction>>(`/leads/${leadId}/interactions?limit=50`),
        apiClient<PaginatedResponse<Visit>>(`/leads/${leadId}/visits?limit=50`),
      ]);
      setLead(leadData);
      setInteractions(interactionsData.items);
      setVisits(visitsData.items);
      setError(null);
    } catch (err) {
      if (err instanceof ApiRequestError && err.statusCode === 404) {
        setNotFound(true);
      } else {
        setError(err instanceof Error ? err.message : 'Error al cargar datos');
      }
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Handlers ──
  async function handleCreateInteraction() {
    setSubmitting(true);
    try {
      await apiClient(`/leads/${leadId}/interactions`, {
        method: 'POST',
        body: JSON.stringify({
          type: interactionType,
          notes: interactionNotes || undefined,
        }),
      });
      setShowInteractionModal(false);
      setInteractionType(InteractionType.Llamada);
      setInteractionNotes('');
      setSuccessMsg(t('success.interactionCreated'));
      await loadData();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t('errors.createFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateVisit() {
    setSubmitting(true);
    try {
      await apiClient(`/leads/${leadId}/visits`, {
        method: 'POST',
        body: JSON.stringify({
          scheduledAt: new Date(visitScheduledAt).toISOString(),
          propertyId: lead?.propertyId || undefined,
          notes: visitNotes || undefined,
        }),
      });
      setShowVisitModal(false);
      setVisitScheduledAt('');
      setVisitNotes('');
      setSuccessMsg(t('success.visitCreated'));
      await loadData();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t('errors.visitCreateFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateVisit() {
    if (!selectedVisit) return;
    setSubmitting(true);
    try {
      const body: Record<string, string> = { status: visitStatus };
      if (visitStatus === VisitStatus.Completada && visitOutcome) {
        body.outcome = visitOutcome;
      }
      await apiClient(`/leads/${leadId}/visits/${selectedVisit.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setShowUpdateVisitModal(false);
      setSelectedVisit(null);
      setSuccessMsg(t('success.visitUpdated'));
      await loadData();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t('errors.visitUpdateFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  function openUpdateVisit(visit: Visit) {
    setSelectedVisit(visit);
    setVisitStatus(visit.status);
    setVisitOutcome(visit.outcome || '');
    setShowUpdateVisitModal(true);
  }

  async function openSendEmailModal() {
    setShowSendEmailModal(true);
    setSelectedTemplateId('');
    try {
      const data = await apiClient<PaginatedResponse<EmailTemplate>>('/email-templates?limit=100&isActive=true');
      setEmailTemplates(data.items);
    } catch {
      setEmailTemplates([]);
    }
  }

  // Arma el mapa de variables a partir del lead actual, para la vista previa
  function buildVariableMap(): Record<string, string> {
    if (!lead) return {};
    const vars: Record<string, string> = {};
    if (lead.person.firstName) vars.nombre = lead.person.firstName;
    if (lead.person.lastName) vars.apellido = lead.person.lastName;
    if (lead.person.firstName && lead.person.lastName) {
      vars.nombreCompleto = `${lead.person.firstName} ${lead.person.lastName}`;
    }
    if (lead.person.email) vars.email = lead.person.email;
    if (lead.person.phone) vars.telefono = lead.person.phone;
    if (lead.pipeline) vars.pipeline = lead.pipeline.name;
    if (lead.currentStage) vars.etapa = lead.currentStage.name;
    if (lead.assignedToUser) {
      vars.agente = `${lead.assignedToUser.firstName} ${lead.assignedToUser.lastName}`;
    }
    return vars;
  }

  const selectedTemplate = emailTemplates.find((tmpl) => tmpl.id === selectedTemplateId);
  const variableMap = buildVariableMap();
  const previewSubjectEmail = selectedTemplate ? renderTemplate(selectedTemplate.subject, variableMap) : '';
  const previewBodyEmail = selectedTemplate ? renderTemplate(selectedTemplate.body, variableMap) : '';

  async function handleSendEmail() {
    if (!selectedTemplateId || !lead?.person.email) return;
    setSendingEmail(true);
    try {
      await apiClient(`/leads/${leadId}/send-email`, {
        method: 'POST',
        body: JSON.stringify({
          templateId: selectedTemplateId,
          leadId,
          to: lead.person.email,
        }),
      });
      setShowSendEmailModal(false);
      setSuccessMsg(t('sent'));
      await loadData();
    } catch (err) {
      if (err instanceof ApiRequestError && err.errorCode === 'EMAIL_NOT_CONFIGURED') {
        setError(t('emailNotConfigured'));
      } else {
        setError(t('sendEmailError'));
      }
      setShowSendEmailModal(false);
    } finally {
      setSendingEmail(false);
    }
  }

  // ── Timeline fusionado ──
  type TimelineEntry =
    | { kind: 'interaction'; date: string; item: Interaction }
    | { kind: 'visit'; date: string; item: Visit };

  const timeline: TimelineEntry[] = [
    ...interactions.map((i) => ({ kind: 'interaction', date: i.occurredAt, item: i }) as TimelineEntry),
    ...visits.map((v) => ({ kind: 'visit', date: v.scheduledAt, item: v }) as TimelineEntry),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const timelineState: ListState = timeline.length === 0 ? 'empty' : 'ready';

  // ── Loading ──
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner className="h-8 w-8 text-brand-500" />
      </div>
    );
  }

  // ── Not found ──
  if (notFound || !lead) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
          <Icon name="alert" className="w-8 h-8 text-slate-400" strokeWidth={1.5} />
        </div>
        <h2 className="h3">{t('leadDetail.notFound')}</h2>
        <Link href={`${localePrefix}/leads`} className="mt-4">
          <Button variant="secondary">{t('leadDetail.back')}</Button>
        </Link>
      </div>
    );
  }

  const fullName = `${lead.person.firstName} ${lead.person.lastName}`;
  const phone = lead.person.phone;

  return (
    <div className="space-y-6 max-w-3xl">
      {/* ── Flashes ── */}
      {successMsg && (
        <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">
          {successMsg}
        </div>
      )}
      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-500 hover:text-red-700">
            ✕
          </button>
        </div>
      )}

      {/* ── Header ── */}
      <div className="flex items-center gap-4">
        <Link
          href={`${localePrefix}/leads`}
          className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          aria-label={t('leadDetail.back')}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
        </Link>
        <div>
          <p className="eyebrow">{t('leadDetail.title')}</p>
          <h1 className="h2">{fullName}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant={STATUS_VARIANT[lead.status] || 'neutral'}>{tLeads(`statuses.${lead.status}`)}</Badge>
            <span className="text-sm text-[var(--color-muted)]">
              {lead.pipeline.name} · {lead.currentStage.name}
            </span>
          </div>
        </div>
      </div>

      {/* ── Info card ── */}
      <div className="card-lux p-6 space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <DetailRow label={t('leadDetail.source')} value={tLeads(`sources.${lead.source}`)} />
          {lead.budget != null && (
            <DetailRow
              label={t('leadDetail.budget')}
              value={`${lead.budgetCurrency} ${lead.budget.toLocaleString('es-AR')}`}
            />
          )}
          <DetailRow label={t('leadDetail.pipeline')} value={lead.pipeline.name} />
          <DetailRow label={t('leadDetail.stage')} value={lead.currentStage.name} />
          {lead.assignedToUser && (
            <DetailRow
              label={t('leadDetail.assignedTo')}
              value={`${lead.assignedToUser.firstName} ${lead.assignedToUser.lastName}`}
            />
          )}
          {lead.lastContactAt && (
            <DetailRow label={t('leadDetail.lastContact')} value={formatRelativeTime(lead.lastContactAt)} />
          )}
          {lead.person.email && <DetailRow label="Email" value={lead.person.email} />}
          {phone && <DetailRow label="Teléfono" value={phone} />}
        </div>
      </div>

      {/* ── Action bar ── */}
      {canEdit && (
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" size="sm" onClick={() => setShowInteractionModal(true)}>
            <Icon name="plus" className="h-4 w-4" strokeWidth={2} />
            {t('logInteraction')}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setShowVisitModal(true)}>
            <Icon name="calendar" className="h-4 w-4" strokeWidth={1.75} />
            {t('scheduleVisit')}
          </Button>
          {phone && (
            <Button variant="secondary" size="sm" onClick={() => window.open(buildWhatsAppLink(phone, fullName), '_blank')}>
              <Icon name="phone" className="h-4 w-4" strokeWidth={1.75} />
              {t('whatsapp')}
            </Button>
          )}
          {lead.person.email && (
            <Button variant="secondary" size="sm" onClick={openSendEmailModal}>
              <Icon name="mail" className="h-4 w-4" strokeWidth={1.75} />
              {t('sendEmail')}
            </Button>
          )}
        </div>
      )}

      {/* ── Timeline ── */}
      <div className="card-lux p-6 space-y-4">
        <div>
          <p className="eyebrow">{t('leadDetail.title')}</p>
          <h2 className="h3">{t('timeline')}</h2>
        </div>
        <ListTransition
          state={timelineState}
          skeleton={null}
          empty={<EmptyState iconName="calendarClock" title={t('empty')} />}
        >
          <AnimatedList className="space-y-3">
            {timeline.map((entry, i) => {
              if (entry.kind === 'interaction') {
                const interaction = entry.item;
                return (
                  <StaggerItem key={`int-${interaction.id}`} index={i}>
                    <div className="flex items-start gap-3 p-3 rounded-[var(--radius-lg)] bg-[var(--color-bg)] border border-[var(--color-border)]">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface)] text-[var(--color-muted)]">
                        <Icon name={INTERACTION_ICON[interaction.type] || 'edit'} className="h-4 w-4" strokeWidth={1.75} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="neutral">{t(`types.${interaction.type}`)}</Badge>
                          <span className="text-xs text-[var(--color-muted)]">{formatRelativeTime(interaction.occurredAt)}</span>
                        </div>
                        {interaction.notes && (
                          <p className="text-sm text-[var(--color-text)] mt-1 whitespace-pre-wrap">{interaction.notes}</p>
                        )}
                        {interaction.user && (
                          <p className="text-xs text-[var(--color-muted)] mt-1">
                            {t('contactedBy')}: {interaction.user.firstName} {interaction.user.lastName}
                          </p>
                        )}
                      </div>
                    </div>
                  </StaggerItem>
                );
              }

              const visit = entry.item;
              const addr = visitAddress(visit);
              return (
                <StaggerItem key={`visit-${visit.id}`} index={i}>
                  <div className="flex items-start gap-3 p-3 rounded-[var(--radius-lg)] bg-[var(--color-bg)] border border-[var(--color-border)]">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface)] text-[var(--color-muted)]">
                      <Icon name="calendar" className="h-4 w-4" strokeWidth={1.75} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="brand">{t('visits.title')}</Badge>
                        <Badge variant={VISIT_STATUS_VARIANT[visit.status] || 'neutral'}>
                          {t(`visits.statuses.${visit.status}`)}
                        </Badge>
                        <span className="text-xs text-[var(--color-muted)]">{formatDateTime(visit.scheduledAt)}</span>
                      </div>
                      {addr && (
                        <p className="text-xs text-[var(--color-muted)] mt-1 flex items-center gap-1">
                          <Icon name="mapPin" className="h-3.5 w-3.5" strokeWidth={1.75} />
                          {addr}
                        </p>
                      )}
                      {visit.outcome && (
                        <p className="text-xs font-medium text-[var(--color-text)] mt-1">
                          {t('visits.outcome')}: {t(`visits.outcomes.${visit.outcome}`)}
                        </p>
                      )}
                      {visit.notes && (
                        <p className="text-sm text-[var(--color-text)] mt-1 whitespace-pre-wrap">{visit.notes}</p>
                      )}
                      {visit.user && (
                        <p className="text-xs text-[var(--color-muted)] mt-1">
                          {t('contactedBy')}: {visit.user.firstName} {visit.user.lastName}
                        </p>
                      )}
                    </div>
                  </div>
                </StaggerItem>
              );
            })}
          </AnimatedList>
        </ListTransition>
      </div>

      {/* ── Visitas ── */}
      <div className="card-lux p-6 space-y-4">
        <div>
          <p className="eyebrow">{t('leadDetail.title')}</p>
          <h2 className="h3">{t('visits.title')}</h2>
        </div>
        <RowList
          items={visits}
          loading={false}
          keyOf={(v) => v.id}
          renderItem={(v) => {
            const addr = visitAddress(v);
            return (
              <EntityRow
                accent="none"
                leading={
                  <span
                    className="flex h-10 w-10 items-center justify-center rounded-full"
                    style={{
                      backgroundColor: 'color-mix(in oklab, var(--color-brand-500) 14%, var(--color-surface))',
                      color: 'var(--color-brand-600)',
                    }}
                  >
                    <Icon name="calendar" className="h-5 w-5" strokeWidth={1.75} />
                  </span>
                }
                title={
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <span>{formatDateTime(v.scheduledAt)}</span>
                    <Badge variant={VISIT_STATUS_VARIANT[v.status] || 'neutral'}>{t(`visits.statuses.${v.status}`)}</Badge>
                    {v.outcome && <Badge variant="brand">{t(`visits.outcomes.${v.outcome}`)}</Badge>}
                  </span>
                }
                subtitle={v.notes || undefined}
                meta={addr && <EntityRow.Meta items={[{ icon: 'mapPin', label: addr }]} />}
                actions={
                  canEdit && (
                    <EntityRow.Action onClick={() => openUpdateVisit(v)} variant="ghost">
                      {t('visits.updateVisit')}
                    </EntityRow.Action>
                  )
                }
              />
            );
          }}
          empty={<EmptyState iconName="calendarClock" title={t('emptyVisits')} />}
        />
      </div>

      {/* ──────── Log Interaction Modal ──────── */}
      {showInteractionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowInteractionModal(false)} />
          <div className="relative bg-white rounded-xl border border-slate-200 shadow-xl w-full max-w-md p-6 mx-4 animate-zoom-in">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">{t('logInteraction')}</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('type')}</label>
                <select
                  value={interactionType}
                  onChange={(e) => setInteractionType(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
                >
                  {Object.values(InteractionType).map((type) => (
                    <option key={type} value={type}>
                      {t(`types.${type}`)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('notes')}</label>
                <textarea
                  value={interactionNotes}
                  onChange={(e) => setInteractionNotes(e.target.value)}
                  rows={4}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 resize-none"
                  placeholder="Detalles de la interacción..."
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowInteractionModal(false)}
                className="px-4 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                {tCommon('cancel')}
              </button>
              <button
                onClick={handleCreateInteraction}
                disabled={submitting}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors disabled:opacity-50"
              >
                {submitting && <Spinner className="w-4 h-4 text-white" />}
                {submitting ? 'Guardando...' : tCommon('save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ──────── Schedule Visit Modal ──────── */}
      {showVisitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowVisitModal(false)} />
          <div className="relative bg-white rounded-xl border border-slate-200 shadow-xl w-full max-w-md p-6 mx-4 animate-zoom-in">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">{t('scheduleVisit')}</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('visits.scheduledAt')}</label>
                <input
                  type="datetime-local"
                  value={visitScheduledAt}
                  onChange={(e) => setVisitScheduledAt(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('notes')}</label>
                <textarea
                  value={visitNotes}
                  onChange={(e) => setVisitNotes(e.target.value)}
                  rows={3}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 resize-none"
                  placeholder="Notas sobre la visita..."
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowVisitModal(false)}
                className="px-4 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                {tCommon('cancel')}
              </button>
              <button
                onClick={handleCreateVisit}
                disabled={submitting || !visitScheduledAt}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors disabled:opacity-50"
              >
                {submitting && <Spinner className="w-4 h-4 text-white" />}
                {submitting ? 'Guardando...' : tCommon('save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ──────── Update Visit Modal ──────── */}
      {showUpdateVisitModal && selectedVisit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowUpdateVisitModal(false)} />
          <div className="relative bg-white rounded-xl border border-slate-200 shadow-xl w-full max-w-md p-6 mx-4 animate-zoom-in">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">{t('visits.updateVisit')}</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('visits.status')}</label>
                <select
                  value={visitStatus}
                  onChange={(e) => setVisitStatus(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
                >
                  {Object.values(VisitStatus).map((s) => (
                    <option key={s} value={s}>
                      {t(`visits.statuses.${s}`)}
                    </option>
                  ))}
                </select>
              </div>

              {visitStatus === VisitStatus.Completada && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('visits.outcome')}</label>
                  <select
                    value={visitOutcome}
                    onChange={(e) => setVisitOutcome(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
                  >
                    <option value="">— Seleccionar —</option>
                    {Object.values(VisitOutcome).map((o) => (
                      <option key={o} value={o}>
                        {t(`visits.outcomes.${o}`)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowUpdateVisitModal(false)}
                className="px-4 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                {tCommon('cancel')}
              </button>
              <button
                onClick={handleUpdateVisit}
                disabled={submitting}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors disabled:opacity-50"
              >
                {submitting && <Spinner className="w-4 h-4 text-white" />}
                {submitting ? 'Guardando...' : tCommon('save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ──────── Send Email Modal ──────── */}
      {showSendEmailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowSendEmailModal(false)} />
          <div className="relative bg-white rounded-xl border border-slate-200 shadow-xl w-full max-w-lg p-6 mx-4 max-h-[90vh] overflow-y-auto animate-zoom-in">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">{t('sendEmail')}</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('selectTemplate')}</label>
                <select
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
                >
                  <option value="">— {t('selectTemplate')} —</option>
                  {emailTemplates.map((tmpl) => (
                    <option key={tmpl.id} value={tmpl.id}>
                      {tmpl.name}
                    </option>
                  ))}
                </select>
              </div>

              {lead?.person.email && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Email</label>
                  <p className="text-sm text-slate-600 bg-slate-50 rounded-lg px-3 py-2.5 border border-slate-200">
                    {lead.person.email}
                  </p>
                </div>
              )}

              {selectedTemplate && (
                <div className="bg-slate-50 rounded-lg border border-slate-200 p-4 space-y-3">
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">{t('previewEmail')}</p>
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Asunto:</p>
                    <p className="text-sm font-medium text-slate-900 bg-white rounded-md border border-slate-200 px-3 py-2">
                      {previewSubjectEmail}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Cuerpo:</p>
                    <div
                      className="text-sm text-slate-900 bg-white rounded-md border border-slate-200 px-3 py-2 max-h-48 overflow-y-auto"
                      dangerouslySetInnerHTML={{ __html: previewBodyEmail }}
                    />
                  </div>

                  {selectedTemplate.variables.length > 0 && (
                    <div>
                      <p className="text-xs text-slate-500 mb-1">{t('variablesPreview')}:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedTemplate.variables.map((v) => (
                          <span
                            key={v}
                            className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              variableMap[v]
                                ? 'bg-green-50 text-green-700 border border-green-200'
                                : 'bg-amber-50 text-amber-700 border border-amber-200'
                            }`}
                          >
                            {v}: {variableMap[v] || `{{${v}}}`}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowSendEmailModal(false)}
                className="px-4 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                {tCommon('cancel')}
              </button>
              <button
                onClick={handleSendEmail}
                disabled={sendingEmail || !selectedTemplateId}
                className="px-4 py-2.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors disabled:opacity-50"
              >
                {sendingEmail ? t('sending') : t('sendEmail')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
