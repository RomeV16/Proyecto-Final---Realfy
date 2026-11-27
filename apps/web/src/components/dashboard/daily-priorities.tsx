'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { EntityRow } from '@/components/ui/entity-card';
import { Icon, type IconName } from '@/components/ui/icon';
import { formatMoneyRounded } from '@/lib/format';
import { elapsedFromDays, elapsedFromHours, type Elapsed } from './elapsed';

/* ──────────────── Types ──────────────── */

type PriorityKind = 'cobranza' | 'reclamo' | 'contrato' | 'lead';
type Urgency = 'alta' | 'media' | 'baja';

interface DailyPriority {
  ref: string;
  kind: PriorityKind;
  entityId: string;
  title: string;
  subtitle: string | null;
  urgency: Urgency;
  reason: string;
  action: string;
  amount: number | null;
  currency: string | null;
  daysOverdue: number | null;
  daysToDue: number | null;
  slaHoursOverdue: number | null;
  daysSinceContact: number | null;
}

/** Cuánto se espera antes de volver a pedir el orden que el modelo dejó listo. */
const MODEL_RETRY_MS = 14_000;

interface DailyPrioritiesResponse {
  generatedAt: string;
  source: 'model' | 'rules';
  model: string | null;
  /** El servidor pidió el orden al modelo y todavía no volvió. */
  modelPending?: boolean;
  totals: {
    overdueAmount: number;
    pendingAmount: number;
    overdueCollections: number;
    openTickets: number;
    expiringContracts: number;
    staleLeads: number;
  };
  priorities: DailyPriority[];
}

/** Cuántas prioridades entran en el panel. */
const VISIBLE = 5;

/* ──────────────── Presentation maps ──────────────── */

const KIND_ICON: Record<PriorityKind, IconName> = {
  cobranza: 'liquidaciones',
  reclamo: 'tickets',
  contrato: 'contracts',
  lead: 'leads',
};

const URGENCY_TONE: Record<Urgency, 'danger' | 'warning' | 'brand'> = {
  alta: 'danger',
  media: 'warning',
  baja: 'brand',
};

/** El motivo que arma el servidor trae el atraso de un reclamo en horas. */
const SLA_REASON = /SLA excedido en (\d+) h/;


/* ──────────────── Small pieces ──────────────── */

/** Placa con el icono del frente, tintada según la urgencia. */
function PriorityIcon({ kind, urgency }: { kind: PriorityKind; urgency: Urgency }) {
  const tone = URGENCY_TONE[urgency];
  const color = tone === 'brand' ? 'var(--color-brand-500)' : `var(--color-${tone})`;
  return (
    <span
      className="flex h-10 w-10 items-center justify-center rounded-full"
      style={{
        backgroundColor: `color-mix(in oklab, ${color} 14%, var(--color-surface))`,
        color,
      }}
    >
      <Icon name={KIND_ICON[kind]} className="h-5 w-5" strokeWidth={1.9} />
    </span>
  );
}

function UrgencyBadge({ urgency, label }: { urgency: Urgency; label: string }) {
  const tone = URGENCY_TONE[urgency];
  const color = tone === 'brand' ? 'var(--color-brand-500)' : `var(--color-${tone})`;
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[var(--tracking-wide)]"
      style={{
        backgroundColor: `color-mix(in oklab, ${color} 14%, var(--color-surface))`,
        color: `color-mix(in oklab, ${color} 72%, var(--color-text))`,
      }}
    >
      {label}
    </span>
  );
}

function PriorityRowSkeleton() {
  return (
    <div
      className="flex items-center gap-4 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
      aria-hidden="true"
    >
      <Skeleton className="h-10 w-10 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="h-3 w-3/5" />
      </div>
      <Skeleton className="h-8 w-20 rounded-[var(--radius-lg)]" />
    </div>
  );
}

/* ──────────────── Component ──────────────── */

/**
 * Prioridades del día. Cuelga de `/ai/priorities`, restringido a Admin y
 * Gerencia. Si el orden lo sugirió el modelo de lenguaje configurado, se aclara
 * al pie; el orden por reglas propias no lleva aclaración.
 */
export function DailyPriorities() {
  const t = useTranslations('dashboard.priorities');
  const tElapsed = useTranslations('dashboard.elapsed');

  const [data, setData] = useState<DailyPrioritiesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let reintento: ReturnType<typeof setTimeout> | undefined;

    async function load(esRelectura = false) {
      try {
        if (!esRelectura) setError(false);
        const result = await apiClient<DailyPrioritiesResponse>('/ai/priorities');
        if (cancelled) return;
        setData(result);
        // El servidor no espera al modelo: contesta con el orden por reglas y
        // deja el del modelo listo unos segundos después. Se vuelve a preguntar
        // una sola vez para mostrarlo sin que haya que recargar la página.
        if (result.modelPending && !esRelectura) {
          reintento = setTimeout(() => void load(true), MODEL_RETRY_MS);
        }
      } catch {
        // Una relectura que falla deja lo que ya se estaba mostrando.
        if (!cancelled && !esRelectura) setError(true);
      } finally {
        if (!cancelled && !esRelectura) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
      if (reintento) clearTimeout(reintento);
    };
  }, []);

  function hrefFor(priority: DailyPriority): string {
    switch (priority.kind) {
      case 'cobranza':
        return '/liquidaciones';
      case 'reclamo':
        return `/tickets/${priority.entityId}`;
      case 'contrato':
        return `/contracts/${priority.entityId}`;
      case 'lead':
        return `/leads/${priority.entityId}`;
    }
  }

  const elapsedText = (elapsed: Elapsed) => tElapsed(elapsed.unit, { count: elapsed.count });

  /** Dato duro que acompaña a la fila, distinto según el frente. */
  function trailingFor(priority: DailyPriority) {
    if (priority.kind === 'cobranza' && priority.amount !== null) {
      const overdue = priority.daysOverdue !== null && priority.daysOverdue > 0;
      return (
        <EntityRow.Amount
          value={formatMoneyRounded(priority.amount, priority.currency)}
          hint={
            overdue
              ? t('overdueFor', { elapsed: elapsedText(elapsedFromDays(priority.daysOverdue ?? 0)) })
              : t('pending')
          }
          tone={overdue ? 'danger' : 'default'}
        />
      );
    }
    if (priority.kind === 'contrato' && priority.daysToDue !== null) {
      return (
        <EntityRow.Amount
          value={priority.daysToDue === 0 ? t('today') : elapsedText(elapsedFromDays(priority.daysToDue))}
          hint={priority.daysToDue === 0 ? t('expires') : t('toExpiry')}
          tone={priority.daysToDue <= 30 ? 'danger' : 'default'}
        />
      );
    }
    if (priority.kind === 'reclamo' && priority.slaHoursOverdue !== null && priority.slaHoursOverdue > 0) {
      return (
        <EntityRow.Amount
          value={elapsedText(elapsedFromHours(priority.slaHoursOverdue))}
          hint={t('overSla')}
          tone="danger"
        />
      );
    }
    if (priority.kind === 'lead' && priority.daysSinceContact !== null) {
      return (
        <EntityRow.Amount
          value={elapsedText(elapsedFromDays(priority.daysSinceContact))}
          hint={t('withoutContact')}
          tone="muted"
        />
      );
    }
    return undefined;
  }

  /** El motivo, con el atraso de los reclamos pasado a una duración legible. */
  function reasonFor(priority: DailyPriority): string {
    return priority.reason.replace(SLA_REASON, (_match, hours: string) =>
      t('overSlaFor', { elapsed: elapsedText(elapsedFromHours(Number(hours))) }),
    );
  }

  const priorities = data?.priorities ?? [];
  const fromModel = data?.source === 'model' && Boolean(data.model);

  if (error) {
    return (
      <div className="card-lux p-6">
        <p className="text-sm text-[var(--color-muted)]">{t('loadError')}</p>
      </div>
    );
  }

  return (
      <div className="card-lux p-5 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="h3">{t('title')}</h3>
          <span className="micro">{t('hint')}</span>
        </div>

        {loading ? (
          <div className="space-y-2.5">
            {[0, 1, 2].map((i) => (
              <PriorityRowSkeleton key={i} />
            ))}
          </div>
        ) : priorities.length === 0 ? (
          <EmptyState iconName="check" title={t('emptyTitle')} subtitle={t('emptySubtitle')} />
        ) : (
          <div className="space-y-2.5">
            {priorities.slice(0, VISIBLE).map((priority) => {
              const trailing = trailingFor(priority);
              return (
                <EntityRow
                  key={priority.ref}
                  href={hrefFor(priority)}
                  label={priority.title}
                  accent={URGENCY_TONE[priority.urgency]}
                  leading={<PriorityIcon kind={priority.kind} urgency={priority.urgency} />}
                  title={priority.title}
                  subtitle={priority.subtitle ?? undefined}
                  meta={
                    <div className="flex flex-wrap items-center gap-2">
                      <UrgencyBadge
                        urgency={priority.urgency}
                        label={t(`urgency.${priority.urgency}`)}
                      />
                      <span className="text-xs text-[var(--color-muted)]">
                        {fromModel || !trailing ? reasonFor(priority) : priority.action}
                      </span>
                    </div>
                  }
                  trailing={trailing}
                  actions={
                    <EntityRow.Action
                      href={hrefFor(priority)}
                      icon="arrowRight"
                      variant="ghost"
                    >
                      {t(`kind.${priority.kind}`)}
                    </EntityRow.Action>
                  }
                />
              );
            })}
          </div>
        )}

        {/* Solo se aclara el origen cuando el orden no salió de las reglas propias. */}
        {!loading && fromModel && (
          <p className="mt-4 text-[11px] text-[var(--color-muted)]">
            {t('sourceModel', { model: data?.model ?? '' })}
          </p>
        )}
      </div>
  );
}
