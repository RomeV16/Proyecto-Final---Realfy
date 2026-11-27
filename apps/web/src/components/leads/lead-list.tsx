'use client';

import { useTranslations } from 'next-intl';
import { Spinner } from '@/components/ui/spinner';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { LeadSource } from '@realfy/shared';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Icon, type IconName } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from '@/i18n/navigation';
import { msSince, useElapsedText } from '@/components/tickets/elapsed';
import { useCan, can } from '@/lib/permissions';

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

const DAY_MS = 86_400_000;

/** `/pipelines` y `/users` devuelven la lista directa; se acepta también la forma paginada. */
function listOf<T>(res: T[] | { items?: T[] } | null | undefined): T[] {
  if (Array.isArray(res)) return res;
  return res?.items ?? [];
}

type NextStep = 'assign' | 'firstContact' | 'followUp' | 'onTrack' | 'converted' | 'lost';

/** Qué hay que hacer ahora con el lead. Sin responsable pesa más que sin contacto: nadie lo va a llamar. */
function nextStepOf(lead: LeadItem, now: Date): NextStep {
  if (lead.status === 'Convertido') return 'converted';
  if (lead.status === 'Perdido') return 'lost';
  if (!lead.assignedToUser) return 'assign';
  if (!lead.lastContactAt) return 'firstContact';
  const staleDays = lead.currentStage.staleDays;
  if (staleDays != null && msSince(lead.lastContactAt, now) > staleDays * DAY_MS) return 'followUp';
  return 'onTrack';
}

const STEP_TONE: Record<NextStep, string> = {
  assign: 'text-[var(--color-warning)]',
  firstContact: 'text-[var(--color-warning)]',
  followUp: 'text-[var(--color-danger)]',
  onTrack: 'text-[var(--color-text)]',
  converted: 'text-[var(--color-success)]',
  lost: 'text-[var(--color-muted)]',
};

const STEP_ICON: Record<NextStep, IconName> = {
  assign: 'persons',
  firstContact: 'phone',
  followUp: 'clock',
  onTrack: 'check',
  converted: 'check',
  lost: 'close',
};

/* ──────────── Lead Row ──────────── */

const ROW_GRID =
  'grid gap-x-4 gap-y-2 px-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,0.9fr)_9.5rem] lg:items-center';

function RowAction({ title, icon, onClick }: { title: string; icon: IconName; onClick: () => void }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-brand-500"
    >
      <Icon name={icon} className="h-4 w-4" strokeWidth={2} />
    </button>
  );
}

function LeadRow({
  lead,
  now,
  onAction,
}: {
  lead: LeadItem;
  now: Date;
  onAction: (action: string, lead: LeadItem) => void;
}) {
  const t = useTranslations('leads');
  const tCard = useTranslations('leads.card');
  const tNext = useTranslations('leads.next');
  const tSources = useTranslations('leads.sources');
  const elapsed = useElapsedText();

  const fullName = `${lead.person.firstName} ${lead.person.lastName}`;
  const isTerminal = lead.status === 'Convertido' || lead.status === 'Perdido';
  const step = nextStepOf(lead, now);
  const href = `/leads/${lead.id}`;
  const contact = lead.person.phone || lead.person.email || tCard('noContact');

  let detail: string;
  if (step === 'lost') detail = lead.lostReason || tNext('lostNoReason');
  else if (step === 'converted') detail = tNext('convertedDetail');
  else if (lead.lastContactAt) detail = tNext('lastContact', { time: elapsed(msSince(lead.lastContactAt, now)) });
  else detail = tNext('enteredAgo', { time: elapsed(msSince(lead.createdAt, now)) });

  return (
    <li className={`${ROW_GRID} py-3.5`}>
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={fullName} seed={lead.person.id} size="sm" />
        <div className="min-w-0">
          <Link
            href={href}
            className="block truncate font-medium text-[var(--color-text)] hover:text-brand-600 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500"
          >
            {fullName}
          </Link>
          <p className="truncate text-xs text-[var(--color-muted)]">{contact}</p>
        </div>
      </div>

      {/* La etapa manda: el estado solo se muestra cuando el lead ya se cerró. */}
      <div className="min-w-0">
        {isTerminal ? (
          <Badge variant={lead.status === 'Convertido' ? 'success' : 'danger'}>{t(`statuses.${lead.status}`)}</Badge>
        ) : (
          <Badge variant="neutral">{lead.currentStage.name}</Badge>
        )}
        <p className="mt-1 truncate text-xs text-[var(--color-muted)]">
          {isTerminal ? `${lead.currentStage.name} · ${lead.pipeline.name}` : lead.pipeline.name}
        </p>
      </div>

      <div className="min-w-0">
        <p className={`flex items-center gap-1.5 text-sm font-medium ${STEP_TONE[step]}`}>
          <Icon name={STEP_ICON[step]} className="h-3.5 w-3.5 shrink-0" strokeWidth={2.25} />
          <span className="truncate">{tNext(step)}</span>
        </p>
        <p className="mt-0.5 truncate text-xs text-[var(--color-muted)]" title={detail}>
          {detail}
        </p>
      </div>

      <div className="min-w-0 text-xs">
        <p className="truncate text-[var(--color-text)]">
          {lead.assignedToUser
            ? `${lead.assignedToUser.firstName} ${lead.assignedToUser.lastName.charAt(0)}.`
            : tCard('unassigned')}
        </p>
        <p className="mt-0.5 truncate text-[var(--color-muted)]">{tSources(lead.source as keyof typeof LeadSource)}</p>
      </div>

      <div className="flex items-center justify-end gap-0.5">
        {!isTerminal && (
          <>
            <RowAction title={t('actions.reassign')} icon="refresh" onClick={() => onAction('reassign', lead)} />
            <RowAction title={t('actions.convert')} icon="check" onClick={() => onAction('convert', lead)} />
            <RowAction title={t('actions.markLost')} icon="close" onClick={() => onAction('lose', lead)} />
          </>
        )}
        <Link
          href={href}
          aria-label={`${tCard('view')}: ${fullName}`}
          className="inline-flex h-9 items-center gap-1 rounded-md px-2 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-sunken)] focus-visible:outline-2 focus-visible:outline-brand-500"
        >
          <span className="lg:hidden">{tCard('view')}</span>
          <Icon name="chevronRight" className="h-4 w-4" strokeWidth={2} />
        </Link>
      </div>
    </li>
  );
}

function ListSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-[var(--color-border)] px-4 py-4 last:border-b-0">
          <Skeleton className="h-8 w-8 rounded-full" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="hidden h-4 w-28 lg:block" />
          <Skeleton className="hidden h-4 w-40 lg:block" />
        </div>
      ))}
    </div>
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
  const tSources = useTranslations('leads.sources');
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

  const ventasUsers = users.filter(u => can(u.role, 'leads.assignable'));

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
              {Object.values(LeadSource).map(s => <option key={s} value={s}>{tSources(s)}</option>)}
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
  const [error, setError] = useState('');

  useEffect(() => { if (open) { setUserId(''); setError(''); } }, [open]);

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
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t('error'));
    } finally { setSubmitting(false); }
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
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <select required value={userId} onChange={e => setUserId(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500">
            <option value="">{t('reassignPlaceholder')}</option>
            {users.filter(u => can(u.role, 'leads.assignable')).map(u => (
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
  const [error, setError] = useState('');

  useEffect(() => { if (open) setError(''); }, [open]);

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
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t('error'));
    } finally { setSubmitting(false); }
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
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
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
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t('error'));
    } finally { setSubmitting(false); }
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
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
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

  const canCreate = useCan('leads.manage');

  useEffect(() => {
    // Cada lista se carga por separado: `/users` es solo para Admin y Gerente y su 403 no debe vaciar las otras dos.
    async function loadRef<T>(path: string, apply: (res: T) => void) {
      try {
        apply(await apiClient<T>(path));
      } catch (err) {
        console.error(`[LeadList] ref data error (${path}):`, err);
      }
    }
    async function loadRefs() {
      await Promise.all([
        loadRef<PipelineOption[] | { items: PipelineOption[] }>('/pipelines', (res) => setPipelines(listOf(res))),
        loadRef<UserOption[] | { items: UserOption[] }>('/users', (res) => setUsers(listOf(res))),
        loadRef<{ items: PropertyOption[] }>('/properties?limit=100', (res) => setProperties(res.items || [])),
      ]);
    }
    void loadRefs();
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
    void fetchLeads(filters);
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
    void fetchLeads(filters);
  }

  const hasFilters = filters.search || filters.pipelineId || filters.currentStageId || filters.assignedToUserId || filters.source || filters.statusTab !== 'all';
  const items = data?.items || [];
  const total = data?.total || 0;
  const totalPages = data?.totalPages || 0;
  const now = new Date();

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
          <h1 className="h1">{t('title')}</h1>
          <p className="mt-2 text-sm text-[var(--color-muted)]">{t('subtitle')}</p>
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
                  aria-label={tFilters('clear')}
                >
                  <Icon name="close" className="h-4 w-4" strokeWidth={2} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {loading && !data ? (
        <ListSkeleton />
      ) : items.length === 0 ? (
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
      ) : (
        <div
          className={`overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] transition-opacity ${loading ? 'opacity-60' : ''}`}
        >
          <div
            aria-hidden="true"
            className={`${ROW_GRID} hidden border-b border-[var(--color-border)] bg-[var(--color-surface-sunken)] py-2 text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)] lg:grid`}
          >
            <span>{t('table.name')}</span>
            <span>{t('table.stage')}</span>
            <span>{t('table.nextStep')}</span>
            <span>{t('table.assignedTo')}</span>
            <span />
          </div>
          <ul aria-label={t('title')} className="divide-y divide-[var(--color-border)]">
            {items.map((lead) => (
              <LeadRow key={lead.id} lead={lead} now={now} onAction={handleAction} />
            ))}
          </ul>
        </div>
      )}

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
