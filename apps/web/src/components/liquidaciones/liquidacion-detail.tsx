'use client';

import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useAuth } from '@/lib/auth-context';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import {
  LiquidacionStatus,
  LineItemType,
  getValidLiquidacionTransitions,
} from '@realfy/shared';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from '@/i18n/navigation';
import { StatusBadge } from '@/components/ui/status-badge';
import { PaymentForm } from './payment-form';
import { CompensationDialog, type LessorOption } from './compensation-dialog';
import { PayoffPanel } from './payoff-panel';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { Icon } from '@/components/ui/icon';
import { formatMoneyFixed, formatDate, formatLocalDate, toUtcDay } from '@/lib/format';
import { useCan } from '@/lib/permissions';
import { downloadFile } from '@/lib/download';
import { toast } from '@/lib/toast';
import { printReceipt } from '@/components/cash/print-receipt';

/* ──────────── Types ──────────── */

interface LineItem {
  id: string;
  type: string;
  description: string;
  amount: string | number;
  meta?: { daysOverdue?: number } | null;
  beneficiary?: string;
  commissionable?: boolean;
}

interface Payment {
  id: string;
  amount: string | number;
  method: string;
  reference?: string;
  notes?: string;
  paidAt: string;
  receivedBy?: string | null;
  inCustody?: boolean;
  account?: { id: string; name: string; kind: string; currency: string } | null;
  /** `label` es el número del recibo como se imprime (lo arma la API). */
  receipt?: { id: string; series: string; number: number; label: string } | null;
  compensations?: { id: string; fromLessorId: string; toLessorId: string; amount: string | number }[];
}

interface LiquidacionData {
  id: string;
  status: string;
  period?: string;
  month?: number;
  year?: number;
  dueDate?: string;
  sentAt?: string | null;
  paidAt?: string | null;
  total?: string | number;
  subtotal?: string | number;
  totalAmount?: string | number;
  currency?: string;
  createdAt: string;
  updatedAt: string;
  kind?: string;
  isProvisional?: boolean;
  receiptNumber?: string | null;
  /** Advertencias de una liquidación editable; `ADJUSTMENT_PENDING` bloquea la aprobación. */
  warnings?: { code: string; adjustmentDate?: string }[];
  contract?: {
    id: string;
    property?: { id: string; title: string; street?: string; number?: string | null; city?: string };
    persons?: { role: string; person?: { firstName?: string; lastName?: string } | null }[];
    lessors?: { personId: string; person?: { firstName: string; lastName: string } | null }[];
  };
  lineItems: LineItem[];
  payments: Payment[];
}

interface LiquidacionDetailProps {
  liquidacionId: string;
}

/* ──────────── Helpers ──────────── */



const MINUS = '\u2212';
const LABEL = 'text-[11px] uppercase tracking-wider text-[var(--color-muted)]';
const BACK_LINK = 'inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-brand-600)] hover:underline';
const ICON_BUTTON =
  'inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-text)]';
const FIELD =
  'mt-1 block h-10 w-full rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)] focus:border-[var(--color-brand-500)] focus:outline-none focus:ring-2 focus:ring-[color-mix(in_oklab,var(--color-brand-500)_30%,transparent)]';

function toneStyle(tone: 'success' | 'danger' | 'warning') {
  return {
    borderColor: `color-mix(in oklab, var(--color-${tone}) 28%, var(--color-border))`,
    backgroundColor: `color-mix(in oklab, var(--color-${tone}) 9%, var(--color-surface))`,
    color: `color-mix(in oklab, var(--color-${tone}) 72%, var(--color-text))`,
  };
}

function transitionVariant(target: string): 'primary' | 'secondary' | 'ghost' {
  if (target === LiquidacionStatus.Anulada) return 'ghost';
  if (target === LiquidacionStatus.Borrador) return 'secondary';
  return 'primary';
}

/** Imprime el recibo de cobro numerado de un pago. */
function PaymentReceiptButton({ receipt }: { receipt: NonNullable<Payment['receipt']> }) {
  const tPayments = useTranslations('liquidaciones.payments');
  const tCommon = useTranslations('common');
  const { label } = receipt;
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => void printReceipt(receipt.id, label, tCommon('downloadFailed'))}
    >
      {tPayments('printReceiptNumber', { number: label })}
    </Button>
  );
}

/* ──────────── Main Component ──────────── */

export function LiquidacionDetail({ liquidacionId }: LiquidacionDetailProps) {
  const t = useTranslations('liquidaciones');
  const tDetail = useTranslations('liquidaciones.detail');
  const tDoc = useTranslations('liquidaciones.document');
  const tLineItems = useTranslations('liquidaciones.lineItems');
  const tTotals = useTranslations('liquidaciones.totals');
  const tTransitions = useTranslations('liquidaciones.transitions');
  const tPayments = useTranslations('liquidaciones.payments');
  const tMethods = useTranslations('liquidaciones.paymentMethods');
  const tTypes = useTranslations('liquidaciones.lineItemTypes');
  const tBeneficiary = useTranslations('liquidaciones.beneficiary');
  const tKinds = useTranslations('liquidaciones.kinds');
  const tReceipt = useTranslations('liquidaciones.receipt');
  const tCash = useTranslations('cash');
  const tMonths = useTranslations('liquidaciones.months');
  const tErrors = useTranslations('liquidaciones.errors');
  const tCommon = useTranslations('common');
  const confirm = useConfirm();
  const { user } = useAuth();

  const [data, setData] = useState<LiquidacionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [payoff, setPayoff] = useState<{ amount: string; date: string } | null>(null);
  const [showLineItemForm, setShowLineItemForm] = useState(false);
  const [editingLineItem, setEditingLineItem] = useState<LineItem | null>(null);

  // Line item form state
  const [liType, setLiType] = useState('');
  const [liDescription, setLiDescription] = useState('');
  const [liAmount, setLiAmount] = useState('');

  const canAct = useCan('liquidaciones.act');
  const canCompensate = useCan('cash.manage');
  const tComp = useTranslations('liquidaciones.compensations');
  const [compensating, setCompensating] = useState<string | null>(null);
  const readOnly = !!user && !canAct;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient<LiquidacionData>(`/liquidaciones/${liquidacionId}`);
      setData(res);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [liquidacionId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Locadores del contrato (sin repetir), para compensar un cobro y nombrar las compensaciones.
  const lessorOptions = useMemo<LessorOption[]>(() => {
    const unique = new Map<string, string>();
    for (const l of data?.contract?.lessors ?? []) {
      if (!unique.has(l.personId)) unique.set(l.personId, l.person ? `${l.person.firstName} ${l.person.lastName}` : l.personId);
    }
    return [...unique].map(([personId, name]) => ({ personId, name }));
  }, [data]);
  const lessorName = (id: string) => lessorOptions.find((l) => l.personId === id)?.name ?? tComp('otherLessor');

  // Computed
  const totalAmount = data ? Number(data.totalAmount || data.total || data.subtotal || 0) : 0;
  const paidAmount = data ? (data.payments || []).reduce((s, p) => s + Number(p.amount), 0) : 0;
  const remainingBalance = totalAmount - paidAmount;
  const isEditable = data && [LiquidacionStatus.Borrador, LiquidacionStatus.Revision].includes(data.status as LiquidacionStatus);
  const validTransitions = data ? getValidLiquidacionTransitions(data.status as LiquidacionStatus) : [];

  const subtotal = data ? (data.lineItems || []).filter(li => li.type !== LineItemType.Descuento).reduce((s, li) => s + Number(li.amount), 0) : 0;
  const discounts = data ? (data.lineItems || []).filter(li => li.type === LineItemType.Descuento).reduce((s, li) => s + Number(li.amount), 0) : 0;

  /* ──── Actions ──── */

  async function handleTransition(targetStatus: LiquidacionStatus) {
    if (targetStatus === LiquidacionStatus.Anulada) {
      if (!(await confirm({ body: tTransitions('confirmAnulada'), tone: 'danger' }))) return;
    }
    setActionLoading(targetStatus);
    setFeedback(null);
    try {
      await apiClient(`/liquidaciones/${liquidacionId}/transition`, {
        method: 'POST',
        body: JSON.stringify({ status: targetStatus }),
      });
      setFeedback({ type: 'success', msg: tTransitions('success') });
      void fetchData();
    } catch (err) {
      setFeedback({ type: 'error', msg: err instanceof ApiRequestError ? err.message : tTransitions('error') });
    } finally {
      setActionLoading('');
    }
  }

  function openAddLineItem() {
    setEditingLineItem(null);
    setLiType('');
    setLiDescription('');
    setLiAmount('');
    setShowLineItemForm(true);
  }

  function openEditLineItem(li: LineItem) {
    setEditingLineItem(li);
    setLiType(li.type);
    setLiDescription(li.description);
    setLiAmount(String(li.amount));
    setShowLineItemForm(true);
  }

  async function handleSaveLineItem(e: React.FormEvent) {
    e.preventDefault();
    setActionLoading('lineItem');
    setFeedback(null);
    try {
      if (editingLineItem) {
        await apiClient(`/liquidaciones/${liquidacionId}/line-items/${editingLineItem.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ type: liType, description: liDescription, amount: parseFloat(liAmount) }),
        });
        setFeedback({ type: 'success', msg: tLineItems('updateSuccess') });
      } else {
        await apiClient(`/liquidaciones/${liquidacionId}/line-items`, {
          method: 'POST',
          body: JSON.stringify({ type: liType, description: liDescription, amount: parseFloat(liAmount) }),
        });
        setFeedback({ type: 'success', msg: tLineItems('addSuccess') });
      }
      setShowLineItemForm(false);
      void fetchData();
    } catch (err) {
      setFeedback({ type: 'error', msg: err instanceof ApiRequestError ? err.message : tLineItems('addError') });
    } finally {
      setActionLoading('');
    }
  }

  async function handleRemoveLineItem(lineItemId: string) {
    if (!(await confirm({ body: tLineItems('removeConfirm'), tone: 'danger' }))) return;
    setActionLoading('removeLineItem');
    setFeedback(null);
    try {
      await apiClient(`/liquidaciones/${liquidacionId}/line-items/${lineItemId}`, { method: 'DELETE' });
      setFeedback({ type: 'success', msg: tLineItems('removeSuccess') });
      void fetchData();
    } catch (err) {
      setFeedback({ type: 'error', msg: err instanceof ApiRequestError ? err.message : tLineItems('removeError') });
    } finally {
      setActionLoading('');
    }
  }

  /* ──── Render ──── */

  if (loading && !data) {
    return (
      <div role="status" aria-busy="true" className="mx-auto max-w-3xl space-y-4">
        <span className="sr-only">{tCommon('loading')}</span>
        <Skeleton className="h-4 w-44" />
        <Skeleton className="h-[32rem] w-full rounded-[var(--radius-xl)]" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <h2 className="text-lg font-semibold text-[var(--color-text)]">{tErrors('notFound')}</h2>
        <Link href={'/liquidaciones'} className={BACK_LINK}>
          <Icon name="arrowLeft" className="h-4 w-4" />
          {tDoc('back')}
        </Link>
      </div>
    );
  }

  // Derive month/year from period ISO date if not provided directly
  const periodDate = data.period ? new Date(data.period) : null;
  const month = data.month ?? (periodDate ? periodDate.getUTCMonth() + 1 : undefined);
  const year = data.year ?? (periodDate ? periodDate.getUTCFullYear() : undefined);
  const periodLabel = month ? `${tMonths(String(month))} ${year}` : '—';
  const pendingAdjustment = data.warnings?.find((w) => w.code === 'ADJUSTMENT_PENDING');

  const property = data.contract?.property;
  const address = property ? [[property.street, property.number].filter(Boolean).join(' '), property.city].filter(Boolean).join(', ') : '';
  const tenantNames = (data.contract?.persons ?? [])
    .filter((p) => p.role === 'Inquilino' && p.person)
    .map((p) => `${p.person?.firstName ?? ''} ${p.person?.lastName ?? ''}`.trim())
    .filter(Boolean);
  const money = (value: string | number) => formatMoneyFixed(value, data.currency);
  const lineItems = data.lineItems || [];
  const payments = data.payments || [];
  const canEditLines = Boolean(isEditable && canAct);
  const canRegisterPayment =
    !readOnly && canAct && [LiquidacionStatus.Enviada, LiquidacionStatus.Vencida].includes(data.status as LiquidacionStatus);
  const isVoided = data.status === LiquidacionStatus.Anulada;
  const isOverdue = data.status === LiquidacionStatus.Vencida;
  const dueDay = toUtcDay(data.dueDate);
  const now = new Date();
  const daysLate =
    isOverdue && dueDay !== null
      ? Math.max(0, Math.round((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - dueDay) / 86_400_000))
      : null;

  const steps = [
    { key: 'created', label: tDoc('created'), at: data.createdAt },
    { key: 'sent', label: tDoc('sent'), at: data.sentAt },
    { key: 'paid', label: tDoc('paid'), at: data.status === LiquidacionStatus.Pagada ? (data.paidAt ?? payments.at(-1)?.paidAt) : null },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={'/liquidaciones'} className={BACK_LINK}>
          <Icon name="arrowLeft" className="h-4 w-4" />
          {tDoc('back')}
        </Link>
        {!isVoided && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              downloadFile(`/liquidaciones/${liquidacionId}/pdf`, `recibo-${data.receiptNumber ?? liquidacionId}.pdf`).catch(() =>
                toast.error(tCommon('downloadFailed')),
              )
            }
          >
            <Icon name="download" className="h-4 w-4" strokeWidth={2} />
            {tReceipt('print')}
          </Button>
        )}
      </div>

      {feedback && (
        <p
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className="rounded-[var(--radius-lg)] border px-4 py-3 text-sm"
          style={toneStyle(feedback.type === 'success' ? 'success' : 'danger')}
        >
          {feedback.msg}
        </p>
      )}

      <article className="overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        {/* Encabezado del comprobante */}
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--color-border)] px-5 py-5 sm:px-8">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--color-muted)]">{tDoc('kicker')}</p>
            <h1 className={cn('mt-1 font-display text-2xl font-semibold tracking-tight text-[var(--color-text)]', isVoided && 'line-through')}>
              {periodLabel}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <StatusBadge domain="liquidacion" status={data.status} size="md" />
              {data.kind && data.kind !== 'Mensual' && <Badge variant="info">{tKinds(data.kind)}</Badge>}
              {data.isProvisional && (
                <Badge variant="warning" title={t('provisionalHint')}>{t('provisional')}</Badge>
              )}
              {pendingAdjustment && <Badge variant="warning">{t('adjustmentPending')}</Badge>}
            </div>
          </div>
          <div className="sm:text-right">
            <p className="font-mono text-xs tabular-nums text-[var(--color-muted)]">
              {data.receiptNumber ? tReceipt('number', { number: data.receiptNumber }) : tReceipt('pending')}
            </p>
            <p className="mt-2 text-[11px] uppercase tracking-wider text-[var(--color-muted)]">{tTotals('total')}</p>
            <p className="font-mono text-2xl font-semibold tabular-nums text-[var(--color-text)]">{money(totalAmount)}</p>
          </div>
        </header>

        {pendingAdjustment && (
          <p role="alert" className="border-b px-5 py-3 text-sm sm:px-8" style={toneStyle('warning')}>
            {t('adjustmentPendingHint', { date: formatLocalDate(pendingAdjustment.adjustmentDate, 'long') })}
          </p>
        )}

        {/* Partes y vencimiento */}
        <dl className="grid gap-4 border-b border-[var(--color-border)] px-5 py-4 sm:grid-cols-3 sm:px-8">
          <div className="min-w-0">
            <dt className={LABEL}>{tDetail('property')}</dt>
            <dd className="mt-0.5 text-sm font-medium text-[var(--color-text)]">{property?.title ?? t('card.noProperty')}</dd>
            {address && <dd className="text-xs text-[var(--color-muted)]">{address}</dd>}
            {data.contract && (
              <dd className="mt-1">
                <Link href={`/contracts/${data.contract.id}`} className="text-xs font-medium text-[var(--color-brand-600)] hover:underline">
                  {tDetail('viewContract')}
                </Link>
              </dd>
            )}
          </div>
          <div className="min-w-0">
            <dt className={LABEL}>{tDoc('tenant')}</dt>
            <dd className="mt-0.5 text-sm font-medium text-[var(--color-text)]">
              {tenantNames.length > 0 ? tenantNames.join(', ') : '—'}
            </dd>
          </div>
          <div>
            <dt className={LABEL}>{tDetail('dueDate')}</dt>
            <dd className="mt-0.5 text-sm font-medium text-[var(--color-text)]">{formatDate(data.dueDate, 'long')}</dd>
            {daysLate !== null && (
              <dd className="text-xs font-medium" style={{ color: 'color-mix(in oklab, var(--color-danger) 80%, var(--color-text))' }}>
                {t('ledger.overdueDays', { days: daysLate })}
              </dd>
            )}
          </div>
        </dl>

        {/* Lo que sigue: cambios de estado */}
        {!readOnly && validTransitions.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-5 py-3 sm:px-8">
            {validTransitions.map((target) => (
              <Button
                key={target}
                variant={transitionVariant(target)}
                size="sm"
                className={target === LiquidacionStatus.Anulada ? 'sm:ml-auto' : undefined}
                onClick={() => void handleTransition(target)}
                disabled={!!actionLoading}
              >
                {actionLoading === target && <Spinner className="w-4 h-4" />}
                {tTransitions(target)}
              </Button>
            ))}
          </div>
        )}

        {/* Conceptos */}
        <section className="border-b border-[var(--color-border)] px-5 py-4 sm:px-8">
          <div className="flex items-center justify-between gap-3">
            <h2 className={LABEL}>{tLineItems('title')}</h2>
            {canEditLines && (
              <Button variant="secondary" size="sm" onClick={openAddLineItem}>
                <Icon name="plus" className="h-4 w-4" strokeWidth={2} />
                {tLineItems('add')}
              </Button>
            )}
          </div>

          {lineItems.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--color-muted)]">{tLineItems('empty')}</p>
          ) : (
            <ul className="mt-2 divide-y divide-[var(--color-border)]">
              {lineItems.map((li) => {
                const isDiscount = li.type === LineItemType.Descuento;
                return (
                  <li key={li.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                    <div className="min-w-0 flex-1 basis-48">
                      <p className="text-sm text-[var(--color-text)]">{li.description.replace(/\s*\[pid:[^\]]+\]/, '')}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-[var(--color-muted)]">
                        <span>{tTypes(li.type)}</span>
                        {li.beneficiary && <span>{tBeneficiary(li.beneficiary)}</span>}
                        {li.commissionable && <span>{t('commissionable')}</span>}
                      </p>
                    </div>
                    <p
                      className={cn(
                        'ml-auto whitespace-nowrap font-mono text-sm tabular-nums',
                        isDiscount ? 'text-[var(--color-muted)]' : 'text-[var(--color-text)]',
                      )}
                    >
                      {isDiscount ? `${MINUS} ` : ''}
                      {money(li.amount)}
                    </p>
                    {canEditLines && (
                      <div className="flex items-center">
                        <button type="button" onClick={() => openEditLineItem(li)} aria-label={tLineItems('edit')} title={tLineItems('edit')} className={ICON_BUTTON}>
                          <Icon name="edit" className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRemoveLineItem(li.id)}
                          aria-label={tLineItems('remove')}
                          title={tLineItems('remove')}
                          className={cn(ICON_BUTTON, 'hover:text-[var(--color-danger)]')}
                        >
                          <Icon name="trash" className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {lineItems.length > 0 && (
            <dl className="mt-3 space-y-1.5 sm:ml-auto sm:max-w-xs">
              <div className="flex items-baseline justify-between gap-4 text-sm text-[var(--color-muted)]">
                <dt>{tTotals('subtotal')}</dt>
                <dd className="font-mono tabular-nums">{money(subtotal)}</dd>
              </div>
              {discounts > 0 && (
                <div className="flex items-baseline justify-between gap-4 text-sm text-[var(--color-muted)]">
                  <dt>{tTotals('discounts')}</dt>
                  <dd className="font-mono tabular-nums">
                    {MINUS} {money(discounts)}
                  </dd>
                </div>
              )}
              <div className="flex items-baseline justify-between gap-4 border-t-2 border-[var(--color-text)] pt-2">
                <dt className="text-sm font-semibold text-[var(--color-text)]">{tTotals('total')}</dt>
                <dd className="font-mono text-lg font-semibold tabular-nums text-[var(--color-text)]">{money(totalAmount)}</dd>
              </div>
            </dl>
          )}
        </section>

        {/* Pagos */}
        <section className="px-5 py-4 sm:px-8">
          <div className="flex items-center justify-between gap-3">
            <h2 className={LABEL}>{tPayments('title')}</h2>
            {canRegisterPayment && (
              <Button variant="accent" size="sm" onClick={() => setShowPaymentForm(true)}>
                <Icon name="plus" className="h-4 w-4" strokeWidth={2} />
                {tPayments('registerPayment')}
              </Button>
            )}
          </div>

          {payments.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--color-muted)]">{tPayments('empty')}</p>
          ) : (
            <ul className="mt-2 divide-y divide-[var(--color-border)]">
              {payments.map((p) => {
                const received = p.receivedBy
                  ? [
                      tPayments('receivedByLabel', { who: tCash(`receivers.${p.receivedBy}`) }),
                      p.account?.name,
                      p.inCustody ? tPayments('inCustodyShort') : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : null;
                const showActions = p.receipt || (canCompensate && p.receivedBy === 'Locador');
                return (
                  <li key={p.id} className="py-2.5">
                    <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                      <p className="w-full font-mono text-xs tabular-nums text-[var(--color-muted)] sm:w-40 sm:pt-0.5">
                        {formatDate(p.paidAt, 'long')}
                      </p>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-[var(--color-text)]">
                          {tMethods(p.method)}
                          {p.reference && <span className="text-[var(--color-muted)]"> · {p.reference}</span>}
                        </p>
                        {received && <p className="mt-0.5 text-xs text-[var(--color-muted)]">{received}</p>}
                      </div>
                      <p className="ml-auto whitespace-nowrap font-mono text-sm tabular-nums text-[var(--color-text)]">{money(p.amount)}</p>
                    </div>
                    {(p.compensations ?? []).length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-xs text-[var(--color-muted)] sm:ml-[10.75rem]" aria-label={tComp('listLabel')}>
                        {(p.compensations ?? []).map((c) => (
                          <li key={c.id}>
                            {tComp('item', {
                              from: lessorName(c.fromLessorId),
                              to: lessorName(c.toLessorId),
                              amount: formatMoneyFixed(c.amount, data.currency),
                            })}
                          </li>
                        ))}
                      </ul>
                    )}
                    {showActions && (
                      <div className="mt-2 flex flex-wrap gap-1.5 sm:ml-[10.75rem]">
                        {p.receipt && <PaymentReceiptButton receipt={p.receipt} />}
                        {canCompensate && p.receivedBy === 'Locador' && (
                          <Button variant="secondary" size="sm" onClick={() => setCompensating(p.id)}>
                            {tComp('register')}
                          </Button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {!isVoided && (
            <dl className="mt-3 sm:ml-auto sm:max-w-xs">
              <div className="flex items-baseline justify-between gap-4 border-t border-[var(--color-border)] pt-2">
                <dt className="text-sm font-medium text-[var(--color-text)]">{tPayments('remainingBalance')}</dt>
                <dd
                  className={cn('text-right font-mono tabular-nums', remainingBalance <= 0 ? 'text-sm font-medium' : 'text-lg font-semibold text-[var(--color-text)]')}
                  style={remainingBalance <= 0 ? { color: 'color-mix(in oklab, var(--color-success) 80%, var(--color-text))' } : undefined}
                >
                  {remainingBalance <= 0 ? tPayments('fullyPaid') : money(remainingBalance)}
                </dd>
              </div>
            </dl>
          )}
        </section>

        {/* Seguimiento */}
        <footer className="border-t border-dashed border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-5 py-4 sm:px-8">
          <h2 className={LABEL}>{tDoc('timeline')}</h2>
          <ol className="mt-2 grid gap-2 sm:grid-cols-3">
            {steps.map((step) => (
              <li key={step.key} className="flex items-start gap-2">
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                    step.at
                      ? 'border-[var(--color-success)] bg-[var(--color-success)] text-white'
                      : 'border-[var(--color-border)] bg-[var(--color-surface)]',
                  )}
                >
                  {step.at && <Icon name="check" className="h-2.5 w-2.5" strokeWidth={3} />}
                </span>
                <div>
                  <p className={cn('text-sm', step.at ? 'text-[var(--color-text)]' : 'text-[var(--color-muted)]')}>{step.label}</p>
                  <p className="text-xs text-[var(--color-muted)]">{step.at ? formatLocalDate(step.at, 'long') : tDoc('pendingStep')}</p>
                </div>
              </li>
            ))}
          </ol>
        </footer>
      </article>

      {/* Monto a pagar en una fecha, con los punitorios devengados */}
      {canRegisterPayment && (
        <PayoffPanel
          liquidacionId={liquidacionId}
          currency={data.currency}
          onPay={(amount, date) => setPayoff({ amount, date })}
        />
      )}

      <p className="text-xs text-[var(--color-muted)]">
        {tDetail('updatedAt')}: {formatLocalDate(data.updatedAt, 'long')}
      </p>

      {/* Alta y edición de un concepto */}
      <Dialog open={showLineItemForm} onClose={() => setShowLineItemForm(false)} size="sm" busy={actionLoading === 'lineItem'}>
        <form onSubmit={handleSaveLineItem}>
          <DialogHeader>
            <h3 className="text-base font-semibold text-[var(--color-text)]">
              {editingLineItem ? t('lineItemForm.editTitle') : t('lineItemForm.title')}
            </h3>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <label className="block text-xs font-medium text-[var(--color-muted)]">
              {t('lineItemForm.type')}
              <select value={liType} onChange={(e) => setLiType(e.target.value)} className={FIELD} required>
                <option value="">{tLineItems('selectType')}</option>
                {Object.values(LineItemType).map((t2) => (
                  <option key={t2} value={t2}>{tTypes(t2)}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium text-[var(--color-muted)]">
              {t('lineItemForm.description')}
              <input
                type="text"
                value={liDescription}
                onChange={(e) => setLiDescription(e.target.value)}
                placeholder={tLineItems('descriptionPlaceholder')}
                className={FIELD}
                required
              />
            </label>
            <label className="block text-xs font-medium text-[var(--color-muted)]">
              {t('lineItemForm.amount')}
              <input
                type="number"
                step="0.01"
                min="0"
                value={liAmount}
                onChange={(e) => setLiAmount(e.target.value)}
                placeholder={tLineItems('amountPlaceholder')}
                className={cn(FIELD, 'font-mono tabular-nums')}
                required
              />
            </label>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" size="sm" onClick={() => setShowLineItemForm(false)}>
              {t('lineItemForm.cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={actionLoading === 'lineItem'}>
              {actionLoading === 'lineItem' && <Spinner className="w-3 h-3 text-white" />}
              {t('lineItemForm.save')}
            </Button>
          </DialogFooter>
        </form>
      </Dialog>

      {/* PaymentForm modal */}
      {(showPaymentForm || payoff) && (
        <PaymentForm
          liquidacionId={liquidacionId}
          remainingBalance={remainingBalance}
          currency={data.currency}
          initialAmount={payoff?.amount}
          initialPaidAt={payoff?.date}
          settlePenalties={payoff !== null}
          onSuccess={() => {
            setShowPaymentForm(false);
            setPayoff(null);
            setFeedback({ type: 'success', msg: tPayments('registerSuccess') });
            void fetchData();
          }}
          onClose={() => {
            setShowPaymentForm(false);
            setPayoff(null);
          }}
        />
      )}

      {compensating && (
        <CompensationDialog
          paymentId={compensating}
          lessors={lessorOptions}
          currency={data.currency}
          onClose={() => setCompensating(null)}
          onDone={() => void fetchData()}
        />
      )}
    </div>
  );
}
