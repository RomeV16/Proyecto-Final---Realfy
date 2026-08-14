'use client';

import { useTranslations } from 'next-intl';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/lib/auth-context';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { LeadSource } from '@realfy/shared';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { EmptyState } from '@/components/ui/empty-state';
import { EntityCard } from '@/components/ui/entity-card';
import { CardGrid } from '@/components/ui/card-grid';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';

/* ──────────── Types ──────────── */

interface LeadPerson {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
}

interface LeadPipeline {
  id: string;
  name: string;
}

interface LeadStage {
  id: string;
  name: string;
  staleDays?: number | null;
}

interface LeadAssignee {
  id: string;
  firstName: string;
  lastName: string;
}

interface LeadItem {
  id: string;
  source: string;
  status: string;
  notes?: string;
  lostReason?: string;
  person: LeadPerson;
  pipeline: LeadPipeline;
  currentStage: LeadStage;
  assignedToUser?: LeadAssignee | null;
  createdAt: string;
  updatedAt: string;
  lastContactAt?: string | null;
}

interface PaginatedLeads {
  items: LeadItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface PipelineOption {
  id: string;
  name: string;
  stages: { id: string; name: string; sortOrder: number }[];
}

interface UserOption {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
}

interface PropertyOption {
  id: string;
  title: string;
}

/* ──────────── Filters ──────────── */

type StatusTab = 'all' | 'active' | 'Convertido' | 'Perdido';

interface Filters {
  search: string;
  pipelineId: string;
  currentStageId: string;
  assignedToUserId: string;
  source: string;
  statusTab: StatusTab;
  page: number;
}

const INITIAL_FILTERS: Filters = {
  search: '',
  pipelineId: '',
  currentStageId: '',
  assignedToUserId: '',
  source: '',
  statusTab: 'all',
  page: 1,
};

const LIMIT = 12;

/** Mapea las pestañas de estado al filtro que espera la API. */
function statusTabToFilter(tab: StatusTab): string | undefined {
  switch (tab) {
    case 'active':
      return 'Nuevo,Contactado,Calificado';
    case 'Convertido':
      return 'Convertido';
    case 'Perdido':
      return 'Perdido';
    default:
      return undefined;
  }
}

/* ──────────── Helpers ──────────── */

function daysAgo(dateStr: string): number {
  const now = new Date();
  const d = new Date(dateStr);
  return Math.max(0, Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24)));
}

/** Estado → tono de la chapa. Sigue la misma progresión del pipeline. */
const STATUS_VARIANT: Record<string, 'info' | 'warning' | 'success' | 'danger' | 'neutral'> = {
  Nuevo: 'info',
  Contactado: 'warning',
  Calificado: 'success',
  Convertido: 'success',
  Perdido: 'danger',
};

/* ──────────── Lead Card ──────────── */

function LeadCard({
  lead,
  localePrefix,
  onAction,
}: {
  lead: LeadItem;
  localePrefix: string;
  onAction: (action: string, lead: LeadItem) => void;
}) {
  const t = useTranslations('leads');
  const tCard = useTranslations('leads.card');
  const tSources = useTranslations('leads.sources');
  const tTable = useTranslations('leads.table');

  const fullName = `${lead.person.firstName} ${lead.person.lastName}`;
  const isTerminal = lead.status === 'Convertido' || lead.status === 'Perdido';
  const days = daysAgo(lead.updatedAt);
  const contactDays = daysAgo(lead.lastContactAt ?? lead.updatedAt);
  const isStale = !isTerminal && lead.currentStage.staleDays != null && contactDays > lead.currentStage.staleDays;
  const unassigned = !isTerminal && !lead.assignedToUser;
  const href = `${localePrefix}/leads/${lead.id}`;

  /* La tarjeta muestra lo que necesita atención ahora, así la grilla también
     sirve como lista de tareas. Sin contacto pesa más que sin asignar — es
     la señal más urgente. */
  const blocker = isStale
    ? { icon: 'clock' as const, text: tCard('stale', { days: contactDays }) }
    : unassigned
      ? { icon: 'alert' as const, text: tCard('unassigned') }
      : null;

  const accent: 'brand' | 'success' | 'warning' | 'danger' =
    lead.status === 'Perdido'
      ? 'danger'
      : lead.status === 'Convertido'
        ? 'success'
        : blocker
          ? 'warning'
          : 'brand';

  return (
    <EntityCard href={href} label={fullName} accent={accent}>
      <EntityCard.Body>
        <div className="flex items-start gap-3">
          <Avatar name={fullName} seed={lead.person.id} size="md" />
          <div className="min-w-0 flex-1">
            <EntityCard.Title>{fullName}</EntityCard.Title>
            <EntityCard.Subtitle>{lead.pipeline.name}</EntityCard.Subtitle>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={STATUS_VARIANT[lead.status] || 'neutral'}>{lead.currentStage.name}</Badge>
          <Badge variant="neutral">{tSources(lead.source as keyof typeof LeadSource)}</Badge>
        </div>

        <EntityCard.Meta
          items={[
            {
              icon: 'persons',
              label: lead.assignedToUser
                ? `${lead.assignedToUser.firstName} ${lead.assignedToUser.lastName.charAt(0)}.`
                : tCard('unassigned'),
            },
          ]}
        />

        {blocker && (
          <EntityCard.Alert tone="warning" icon={blocker.icon}>
            {blocker.text}
          </EntityCard.Alert>
        )}
      </EntityCard.Body>

      <EntityCard.Footer>
        <EntityCard.Amount value={`${days}d`} hint={tTable('daysInStage')} tone={isStale ? 'danger' : 'muted'} />
        <EntityCard.Actions>
          {!isTerminal && (
            <>
              <EntityCard.Action
                onClick={() => onAction('reassign', lead)}
                icon="refresh"
                variant="quiet"
                title={t('actions.reassign')}
              >
                <span className="sr-only">{t('actions.reassign')}</span>
              </EntityCard.Action>
              <EntityCard.Action
                onClick={() => onAction('convert', lead)}
                icon="check"
                variant="quiet"
                title={t('actions.convert')}
              >
                <span className="sr-only">{t('actions.convert')}</span>
              </EntityCard.Action>
              <EntityCard.Action
                onClick={() => onAction('lose', lead)}
                icon="close"
                variant="quiet"
                title={t('actions.markLost')}
              >
                <span className="sr-only">{t('actions.markLost')}</span>
              </EntityCard.Action>
            </>
          )}
          <EntityCard.Action href={href} icon="arrowRight" variant="ghost">
            {tCard('view')}
          </EntityCard.Action>
        </EntityCard.Actions>
      </EntityCard.Footer>
    </EntityCard>
  );
}

/* ──────────── Modals ──────────── */

function CreateLeadModal({ open, onClose, onCreated, pipelines, users, properties }: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  pipelines: PipelineOption[];
  users: UserOption[];
  properties: PropertyOption[];
}) {
  const t = useTranslations('leads.form');
  const tCommon = useTranslations('common');

  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', phone: '',
    pipelineId: '', currentStageId: '', source: '' as string,
    propertyId: '', assignedToUserId: '', notes: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const selectedPipeline = pipelines.find(p => p.id === form.pipelineId);
  const stages = useMemo(() => selectedPipeline?.stages || [], [selectedPipeline]);

  useEffect(() => {
    if (open) {
      setForm({ firstName: '', lastName: '', email: '', phone: '', pipelineId: '', currentStageId: '', source: '', propertyId: '', assignedToUserId: '', notes: '' });
      setError('');
    }
  }, [open]);

  useEffect(() => {
    if (pipelines.length === 1 && !form.pipelineId) {
      setForm(f => ({ ...f, pipelineId: pipelines[0].id }));
    }
  }, [pipelines, form.pipelineId]);

  useEffect(() => {
    if (stages.length > 0 && !stages.find(s => s.id === form.currentStageId)) {
      setForm(f => ({ ...f, currentStageId: stages[0].id }));
    }
  }, [stages, form.currentStageId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!form.email && !form.phone) {
      setError(t('contactRequired'));
      return;
    }

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        firstName: form.firstName,
        lastName: form.lastName,
        source: form.source || 'Other',
      };
      if (form.email) body.email = form.email;
      if (form.phone) body.phone = form.phone;
      if (form.pipelineId) body.pipelineId = form.pipelineId;
      if (form.currentStageId) body.currentStageId = form.currentStageId;
      if (form.propertyId) body.propertyId = form.propertyId;
      if (form.assignedToUserId) body.assignedToUserId = form.assignedToUserId;
      if (form.notes) body.notes = form.notes;

      await apiClient('/leads', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      onCreated();
      onClose();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.message);
      } else {
        setError(t('error'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  const ventasUsers = users.filter(u => ['Admin', 'Gerente', 'Ventas'].includes(u.role));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-zoom-in" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">{t('title')}</h2>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">{t('firstName')}</label>
              <input required type="text" value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))}
                placeholder={t('firstNamePlaceholder')}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">{t('lastName')}</label>
              <input required type="text" value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))}
                placeholder={t('lastNamePlaceholder')}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">{t('email')}</label>
              <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder={t('emailPlaceholder')}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">{t('phone')}</label>
              <input type="text" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                placeholder={t('phonePlaceholder')}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">{t('pipeline')}</label>
              <select value={form.pipelineId} onChange={e => setForm(f => ({ ...f, pipelineId: e.target.value, currentStageId: '' }))}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500">
                <option value="">{t('pipelinePlaceholder')}</option>
                {pipelines.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">{t('stage')}</label>
              <select value={form.currentStageId} onChange={e => setForm(f => ({ ...f, currentStageId: e.target.value }))}
                disabled={!form.pipelineId}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 disabled:opacity-50">
                <option value="">{t('stagePlaceholder')}</option>
                {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">{t('source')}</label>
            <select value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500">
              <option value="">{t('sourcePlaceholder')}</option>
              {Object.values(LeadSource).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">{t('property')}</label>
              <select value={form.propertyId} onChange={e => setForm(f => ({ ...f, propertyId: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500">
                <option value="">{t('propertyPlaceholder')}</option>
                {properties.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">{t('assignedTo')}</label>
              <select value={form.assignedToUserId} onChange={e => setForm(f => ({ ...f, assignedToUserId: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500">
                <option value="">{t('assignedToPlaceholder')}</option>
                {ventasUsers.map(u => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">{t('notes')}</label>
            <textarea rows={3} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder={t('notesPlaceholder')}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 resize-none" />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 transition-colors">
              {tCommon('cancel')}
            </button>
            <button type="submit" disabled={submitting}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 active:bg-brand-700 transition-colors shadow-sm disabled:opacity-50">
              {submitting && <Spinner className="w-4 h-4 text-white" />}
              {submitting ? t('creating') : t('submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ReassignModal({ open, lead, users, onClose, onDone }: {
  open: boolean;
  lead: LeadItem | null;
  users: UserOption[];
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('leads.actions');
  const tCommon = useTranslations('common');
  const [userId, setUserId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { if (open) setUserId(''); }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!lead || !userId) return;
    setSubmitting(true);
    try {
      await apiClient(`/leads/${lead.id}/assign`, {
        method: 'PATCH',
        body: JSON.stringify({ assignedToUserId: userId }),
      });
      onDone();
      onClose();
    } catch { /* silencioso */ } finally { setSubmitting(false); }
  }

  if (!open || !lead) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm animate-zoom-in" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">{t('reassignTitle')}</h2>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          <select required value={userId} onChange={e => setUserId(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500">
            <option value="">Seleccionar usuario…</option>
            {users.filter(u => ['Admin', 'Gerente', 'Ventas'].includes(u.role)).map(u => (
              <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>
            ))}
          </select>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 transition-colors">{tCommon('cancel')}</button>
            <button type="submit" disabled={submitting || !userId} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors disabled:opacity-50">
              {submitting && <Spinner className="w-4 h-4 text-white" />}
              {tCommon('confirm')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ConvertModal({ open, lead, onClose, onDone }: {
  open: boolean;
  lead: LeadItem | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('leads.actions');
  const tRoles = useTranslations('leads.roles');
  const tCommon = useTranslations('common');
  const [role, setRole] = useState('Inquilino');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!lead) return;
    setSubmitting(true);
    try {
      await apiClient(`/leads/${lead.id}/convert`, {
        method: 'POST',
        body: JSON.stringify({ targetRole: role }),
      });
      onDone();
      onClose();
    } catch { /* silencioso */ } finally { setSubmitting(false); }
  }

  if (!open || !lead) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm animate-zoom-in" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">{t('convertTitle')}</h2>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          <label className="block text-xs font-medium text-slate-500 mb-1">{t('convertAs')}</label>
          <div className="flex gap-3">
            {(['Inquilino', 'Comprador'] as const).map(r => (
              <label key={r} className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border cursor-pointer transition-colors ${role === r ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 hover:bg-slate-50'}`}>
                <input type="radio" name="role" value={r} checked={role === r} onChange={() => setRole(r)} className="sr-only" />
                <span className="text-sm font-medium">{tRoles(r)}</span>
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 transition-colors">{tCommon('cancel')}</button>
            <button type="submit" disabled={submitting} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50">
              {submitting && <Spinner className="w-4 h-4 text-white" />}
              {t('convert')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function LoseModal({ open, lead, onClose, onDone }: {
  open: boolean;
  lead: LeadItem | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('leads.actions');
  const tCommon = useTranslations('common');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (open) { setReason(''); setError(''); } }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!lead) return;
    if (!reason.trim()) { setError(t('lostReasonRequired')); return; }
    setSubmitting(true);
    try {
      await apiClient(`/leads/${lead.id}/lose`, {
        method: 'POST',
        body: JSON.stringify({ lostReason: reason }),
      });
      onDone();
      onClose();
    } catch { /* silencioso */ } finally { setSubmitting(false); }
  }

  if (!open || !lead) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm animate-zoom-in" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">{t('markLostTitle')}</h2>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">{t('lostReason')}</label>
            <textarea required rows={3} value={reason} onChange={e => setReason(e.target.value)}
              placeholder={t('lostReasonPlaceholder')}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 resize-none" />
          </div>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 transition-colors">{tCommon('cancel')}</button>
            <button type="submit" disabled={submitting || !reason.trim()} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-50">
              {submitting && <Spinner className="w-4 h-4 text-white" />}
              {t('markLost')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ──────────── Main Component ──────────── */

export function LeadList() {
  const t = useTranslations('leads');
  const tFilters = useTranslations('leads.filters');
  const tPagination = useTranslations('leads.pagination');
  const tCommon = useTranslations('common');
  const { user } = useAuth();
  const pathname = usePathname();
  const localePrefix = pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}|[a-z]{2})/)?.[0] || '/es';

  const [data, setData] = useState<PaginatedLeads | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);

  // Datos de referencia
  const [pipelines, setPipelines] = useState<PipelineOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [properties, setProperties] = useState<PropertyOption[]>([]);

  // Modales
  const [showCreate, setShowCreate] = useState(false);
  const [reassignLead, setReassignLead] = useState<LeadItem | null>(null);
  const [convertLead, setConvertLead] = useState<LeadItem | null>(null);
  const [loseLead, setLoseLead] = useState<LeadItem | null>(null);

  const canCreate = ['Admin', 'Gerente', 'Ventas'].includes(user?.role || '');

  useEffect(() => {
    async function loadRefs() {
      try {
        const [pRes, uRes, prRes] = await Promise.all([
          apiClient<{ items: PipelineOption[] }>('/pipelines'),
          apiClient<{ items: UserOption[] }>('/users'),
          apiClient<{ items: PropertyOption[] }>('/properties?limit=100'),
        ]);
        setPipelines(pRes.items || []);
        setUsers(uRes.items || []);
        setProperties(prRes.items || []);
      } catch (err) {
        console.error('[LeadList] ref data error:', err);
      }
    }
    loadRefs();
  }, []);

  const selectedPipelineStages = pipelines.find(p => p.id === filters.pipelineId)?.stages || [];

  const fetchLeads = useCallback(async (f: Filters) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(f.page));
      params.set('limit', String(LIMIT));
      if (f.search) params.set('search', f.search);
      if (f.pipelineId) params.set('pipelineId', f.pipelineId);
      if (f.currentStageId) params.set('currentStageId', f.currentStageId);
      if (f.assignedToUserId) params.set('assignedToUserId', f.assignedToUserId);
      if (f.source) params.set('source', f.source);
      const statusVal = statusTabToFilter(f.statusTab);
      if (statusVal) params.set('status', statusVal);

      const res = await apiClient<PaginatedLeads>(`/leads?${params.toString()}`);
      setData(res);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        console.error(`[LeadList] fetch error: ${err.statusCode} ${err.errorCode}`);
      }
      setData({ items: [], total: 0, page: 1, limit: LIMIT, totalPages: 0 });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLeads(filters);
  }, [filters, fetchLeads]);

  function updateFilter(key: keyof Filters, value: string | number) {
    setFilters(prev => ({ ...prev, [key]: value, page: key === 'page' ? (value as number) : 1 }));
  }

  function clearFilters() {
    setFilters(INITIAL_FILTERS);
  }

  function handleAction(action: string, lead: LeadItem) {
    if (action === 'reassign') setReassignLead(lead);
    if (action === 'convert') setConvertLead(lead);
    if (action === 'lose') setLoseLead(lead);
  }

  function refresh() {
    fetchLeads(filters);
  }

  const hasFilters = filters.search || filters.pipelineId || filters.currentStageId || filters.assignedToUserId || filters.source || filters.statusTab !== 'all';
  const items = data?.items || [];
  const total = data?.total || 0;
  const totalPages = data?.totalPages || 0;

  const statusTabs: { key: StatusTab; label: string }[] = [
    { key: 'all', label: t('statusTabs.all') },
    { key: 'active', label: t('statusTabs.active') },
    { key: 'Convertido', label: t('statusTabs.Convertido') },
    { key: 'Perdido', label: t('statusTabs.Perdido') },
  ];

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t('title')}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{t('subtitle')}</p>
        </div>
        {canCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="w-full sm:w-auto px-4 py-2.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 active:bg-brand-700 transition-colors shadow-sm flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            {t('newLead')}
          </button>
        )}
      </div>

      {/* Pestañas de estado */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
        {statusTabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => updateFilter('statusTab', tab.key)}
            className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              filters.statusTab === tab.key
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">{tFilters('search')}</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={filters.search}
                onChange={e => updateFilter('search', e.target.value)}
                placeholder={tFilters('searchPlaceholder')}
                className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">{tFilters('pipeline')}</label>
            <select value={filters.pipelineId} onChange={e => { updateFilter('pipelineId', e.target.value); setFilters(f => ({ ...f, currentStageId: '' })); }}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500">
              <option value="">{tFilters('pipelinePlaceholder')}</option>
              {pipelines.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">{tFilters('stage')}</label>
            <select value={filters.currentStageId} onChange={e => updateFilter('currentStageId', e.target.value)}
              disabled={!filters.pipelineId}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 disabled:opacity-50">
              <option value="">{tFilters('stagePlaceholder')}</option>
              {selectedPipelineStages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">{tFilters('source')}</label>
            <select value={filters.source} onChange={e => updateFilter('source', e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500">
              <option value="">{tFilters('sourcePlaceholder')}</option>
              {Object.values(LeadSource).map(s => <option key={s} value={s}>{t(`sources.${s}`)}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">{tFilters('assignee')}</label>
            <div className="flex gap-2">
              <select value={filters.assignedToUserId} onChange={e => updateFilter('assignedToUserId', e.target.value)}
                className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500">
                <option value="">{tFilters('assigneePlaceholder')}</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
              </select>
              {hasFilters && (
                <button
                  onClick={clearFilters}
                  className="px-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
                  title={tFilters('clear')}
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Grilla — dueña de la transición carga → contenido → vacío */}
      <CardGrid
        items={items}
        loading={loading && !data}
        busy={loading && !!data}
        columns={3}
        skeletonCount={6}
        skeletonMedia={false}
        keyOf={(lead) => lead.id}
        renderItem={(lead) => (
          <LeadCard lead={lead} localePrefix={localePrefix} onAction={handleAction} />
        )}
        empty={
          hasFilters ? (
            <EmptyState
              variant="filtered"
              iconName="search"
              title={tCommon('noResults')}
              subtitle={t('empty.filtered')}
              action={
                <button
                  onClick={clearFilters}
                  className="rounded-[var(--radius-lg)] border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg)]"
                >
                  {tFilters('clear')}
                </button>
              }
            />
          ) : (
            <EmptyState
              iconName="leads"
              title={t('empty.title')}
              subtitle={t('empty.subtitle')}
              steps={[t('empty.step1'), t('empty.step2'), t('empty.step3')]}
              action={
                canCreate && (
                  <button
                    onClick={() => setShowCreate(true)}
                    className="inline-flex items-center gap-2 rounded-[var(--radius-lg)] bg-[var(--color-brand-500)] px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[var(--color-brand-600)]"
                  >
                    {t('newLead')}
                  </button>
                )
              }
            />
          )
        }
      />

      {/* Paginación */}
      {!loading && totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
          <p className="text-sm text-slate-500">
            {tPagination('showing', {
              from: (filters.page - 1) * LIMIT + 1,
              to: Math.min(filters.page * LIMIT, total),
              total,
            })}
          </p>
          <div className="flex items-center gap-2">
            <button onClick={() => updateFilter('page', filters.page - 1)} disabled={filters.page <= 1}
              className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {tPagination('prev')}
            </button>
            <span className="text-sm text-slate-600 tabular-nums px-2">
              {tCommon('page')} {filters.page} {tCommon('of')} {totalPages}
            </span>
            <button onClick={() => updateFilter('page', filters.page + 1)} disabled={filters.page >= totalPages}
              className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {tPagination('next')}
            </button>
          </div>
        </div>
      )}

      {/* Modales */}
      <CreateLeadModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={refresh}
        pipelines={pipelines}
        users={users}
        properties={properties}
      />
      <ReassignModal
        open={!!reassignLead}
        lead={reassignLead}
        users={users}
        onClose={() => setReassignLead(null)}
        onDone={refresh}
      />
      <ConvertModal
        open={!!convertLead}
        lead={convertLead}
        onClose={() => setConvertLead(null)}
        onDone={refresh}
      />
      <LoseModal
        open={!!loseLead}
        lead={loseLead}
        onClose={() => setLoseLead(null)}
        onDone={refresh}
      />
    </div>
  );
}
