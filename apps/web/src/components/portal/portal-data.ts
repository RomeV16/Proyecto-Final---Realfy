'use client';

import { useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { portalApiClient } from '@/lib/portal-api-client';

/**
 * Everything the tenant portal knows, in one place.
 *
 * The portal API exposes three read endpoints (contract, liquidaciones,
 * tickets) and no summary of its own, so the answers the tenant actually cares
 * about — do I owe money, since when, what is my claim doing — are derived here
 * from those payloads and shared by every screen.
 *
 * Note on wording: the API calls a bill a "liquidación", which is the agency's
 * term. The tenant only ever sees "factura", so the UI layer speaks in
 * invoices while the routes and endpoints keep their original names.
 */

/* ──────────── Wire types ──────────── */

/** Property as embedded in a liquidación's contract. */
export interface PortalProperty {
  id: string;
  title?: string | null;
  street?: string | null;
  number?: string | null;
  city?: string | null;
}

/** GET /portal/contract */
export interface PortalContract {
  id: string;
  propertyId: string;
  property: { id: string; name: string | null; address: string | null } | null;
  contractType: string | null;
  status: string | null;
  startDate: string | null;
  endDate: string | null;
  rentAmount: string | null;
  rentCurrency: string | null;
  adjustmentType: string | null;
  adjustmentPeriod: string | null;
  nextAdjustmentDate: string | null;
  lastAdjustmentDate: string | null;
}

/** GET /portal/liquidaciones — one item. */
export interface PortalInvoice {
  id: string;
  period: string;
  status: string;
  total: string | number;
  currency: string | null;
  dueDate: string | null;
  paidAt: string | null;
  contract: { id: string; property: PortalProperty | null } | null;
  _count?: { payments: number };
}

export interface PortalInvoicePage {
  items: PortalInvoice[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** GET /portal/tickets — one item. */
export interface PortalClaim {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  createdAt: string;
  updatedAt?: string | null;
  resolvedAt?: string | null;
  property: PortalProperty | null;
  category: { id: string; name: string; color: string | null } | null;
}

export interface PortalClaimPage {
  data: PortalClaim[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export interface PortalCategory {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
}

/* ──────────── Dates ──────────── */

const DAY_MS = 86_400_000;

/**
 * Collapse an API timestamp to a UTC midnight. Periods and due dates are
 * date-only values stored at 00:00Z, so parsing them in the browser's zone
 * would move "1 de agosto" to July 31 for anyone west of Greenwich.
 */
export function toUtcDay(value?: string | null): number | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match) return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? null
    : Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate());
}

/** Today, as the tenant experiences it — their local calendar day. */
export function todayUtcDay(): number {
  const now = new Date();
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Whole days from `from` to `to`. Negative means `to` is in the past. */
export function daysBetween(from: number, to: number): number {
  return Math.round((to - from) / DAY_MS);
}

/* ──────────── Formatting ──────────── */

const LOCALE = 'es-AR';

export function formatMoney(value: number | string | null | undefined, currency = 'ARS'): string {
  const amount = typeof value === 'string' ? Number(value) : (value ?? 0);
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency: currency || 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
}

function formatUtc(value: string | null | undefined, options: Intl.DateTimeFormatOptions): string {
  const day = toUtcDay(value);
  if (day === null) return '—';
  return new Intl.DateTimeFormat(LOCALE, { timeZone: 'UTC', ...options }).format(new Date(day));
}

/** "10/08/2026" */
export function formatDate(value?: string | null): string {
  return formatUtc(value, { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** "10 ago" */
export function formatDayMonth(value?: string | null): string {
  return formatUtc(value, { day: 'numeric', month: 'short' });
}

/** "Agosto 2026" */
export function formatPeriod(value?: string | null): string {
  const label = formatUtc(value, { month: 'long', year: 'numeric' });
  return label === '—' ? label : label.charAt(0).toUpperCase() + label.slice(1);
}

/** "ago" — the month chip on an invoice row. */
export function formatMonthShort(value?: string | null): string {
  return formatUtc(value, { month: 'short' }).replace('.', '');
}

/** "26" — the year under the month chip. */
export function formatYearShort(value?: string | null): string {
  return formatUtc(value, { year: '2-digit' });
}

export function addressOf(property: PortalProperty | null | undefined): string | null {
  if (!property) return null;
  const line = [property.street, property.number].filter(Boolean).join(' ');
  return line || property.title || property.city || null;
}

/* ──────────── Invoice state ──────────── */

/**
 * What an invoice means to the tenant, which is not the same as its status in
 * the agency's workflow: `Borrador`/`Revision`/`Aprobada` are internal steps,
 * and both `Pendiente` and `Enviada` simply mean "you have to pay this".
 */
export type InvoiceState = 'paid' | 'overdue' | 'due' | 'draft' | 'void';

const DRAFT_STATUSES = ['Borrador', 'Revision', 'Aprobada'];

export function invoiceState(invoice: PortalInvoice, today = todayUtcDay()): InvoiceState {
  if (invoice.status === 'Pagada') return 'paid';
  if (invoice.status === 'Anulada') return 'void';
  if (DRAFT_STATUSES.includes(invoice.status)) return 'draft';
  if (invoice.status === 'Vencida') return 'overdue';
  const due = toUtcDay(invoice.dueDate);
  return due !== null && due < today ? 'overdue' : 'due';
}

export const INVOICE_TONE: Record<InvoiceState, 'success' | 'danger' | 'warning' | 'neutral'> = {
  paid: 'success',
  overdue: 'danger',
  due: 'warning',
  draft: 'neutral',
  void: 'neutral',
};

/* ──────────── Claim state ──────────── */

const CLOSED_CLAIM_STATUSES = ['Resuelto', 'Cerrado', 'Cancelado'];

export function isClaimOpen(claim: PortalClaim): boolean {
  return !CLOSED_CLAIM_STATUSES.includes(claim.status);
}

export function claimTone(claim: PortalClaim): 'brand' | 'success' | 'warning' | 'neutral' {
  if (claim.status === 'Cancelado') return 'neutral';
  if (claim.status === 'Resuelto' || claim.status === 'Cerrado') return 'success';
  if (claim.status === 'Abierto' || claim.status === 'Reabierto') return 'warning';
  return 'brand';
}

/* ──────────── Overview ──────────── */

export type AccountState = 'overdue' | 'pending' | 'clear';

export interface PortalOverview {
  contract: PortalContract | null;
  propertyLabel: string | null;
  currency: string;
  /** Where the tenant stands, in one word. */
  state: AccountState;
  /** Everything still payable — overdue plus not-yet-due. */
  balance: number;
  overdueAmount: number;
  overdueCount: number;
  pendingCount: number;
  /** Days since the oldest unpaid due date. 0 when nothing is late. */
  daysLate: number;
  /** The one invoice worth acting on: oldest overdue, otherwise the next due. */
  focusInvoice: PortalInvoice | null;
  /** Days until `focusInvoice` is due. Negative once it is late. */
  daysToDue: number | null;
  /** Earliest payable invoice that hasn't come due yet. */
  nextInvoice: PortalInvoice | null;
  /** Days until `nextInvoice` is due. */
  daysToNext: number | null;
  paidCount: number;
  billedCount: number;
  monthlyRent: number;
  /** Share of the contract term already elapsed, 0–100. */
  termProgress: number;
  monthsElapsed: number;
  monthsTotal: number;
  openClaims: number;
  /** Most recent open claim, or the most recent one when all are closed. */
  focusClaim: PortalClaim | null;
}

const AVG_MONTH_DAYS = 30.4375;

/** Calendar months between two days, rounded — contracts rarely end on the 1st. */
function monthsBetween(from: number, to: number): number {
  return (to - from) / DAY_MS / AVG_MONTH_DAYS;
}

export function buildOverview(
  contracts: PortalContract[],
  invoices: PortalInvoice[],
  claims: PortalClaim[],
): PortalOverview {
  const today = todayUtcDay();
  const contract = contracts[0] ?? null;

  const rated = invoices.map((invoice) => ({ invoice, state: invoiceState(invoice, today) }));
  const payable = rated.filter((row) => row.state === 'overdue' || row.state === 'due');
  const overdue = payable.filter((row) => row.state === 'overdue');

  const amountOf = (invoice: PortalInvoice) => {
    const total = typeof invoice.total === 'string' ? Number(invoice.total) : invoice.total;
    return Number.isFinite(total) ? total : 0;
  };
  const sum = (rows: typeof payable) => rows.reduce((acc, row) => acc + amountOf(row.invoice), 0);

  const byDueDate = (a: (typeof payable)[number], b: (typeof payable)[number]) =>
    (toUtcDay(a.invoice.dueDate) ?? Number.MAX_SAFE_INTEGER) -
    (toUtcDay(b.invoice.dueDate) ?? Number.MAX_SAFE_INTEGER);

  const focusInvoice =
    [...overdue].sort(byDueDate)[0]?.invoice ?? [...payable].sort(byDueDate)[0]?.invoice ?? null;
  const focusDue = toUtcDay(focusInvoice?.dueDate);

  const nextInvoice =
    [...payable].filter((row) => row.state === 'due').sort(byDueDate)[0]?.invoice ?? null;
  const nextDue = toUtcDay(nextInvoice?.dueDate);

  const oldestOverdueDue = [...overdue].sort(byDueDate)[0]?.invoice.dueDate;
  const oldestOverdueDay = toUtcDay(oldestOverdueDue);

  const openClaims = claims.filter(isClaimOpen);

  const start = toUtcDay(contract?.startDate);
  const end = toUtcDay(contract?.endDate);
  const monthsTotal =
    start !== null && end !== null ? Math.max(1, Math.round(monthsBetween(start, end))) : 0;
  const monthsElapsed =
    start !== null
      ? Math.max(0, Math.min(monthsTotal, Math.floor(monthsBetween(start, today))))
      : 0;
  const termProgress =
    start !== null && end !== null && end > start
      ? Math.max(0, Math.min(100, Math.round(((today - start) / (end - start)) * 100)))
      : 0;

  const rent = contract?.rentAmount ? Number(contract.rentAmount) : 0;

  const propertyFromInvoice = rated
    .map((row) => addressOf(row.invoice.contract?.property))
    .find(Boolean);

  return {
    contract,
    propertyLabel:
      propertyFromInvoice ?? contract?.property?.address ?? contract?.property?.name ?? null,
    currency: contract?.rentCurrency || invoices[0]?.currency || 'ARS',
    state: overdue.length > 0 ? 'overdue' : payable.length > 0 ? 'pending' : 'clear',
    balance: sum(payable),
    overdueAmount: sum(overdue),
    overdueCount: overdue.length,
    pendingCount: payable.length - overdue.length,
    daysLate: oldestOverdueDay !== null ? Math.max(0, daysBetween(oldestOverdueDay, today)) : 0,
    focusInvoice,
    daysToDue: focusDue !== null ? daysBetween(today, focusDue) : null,
    nextInvoice,
    daysToNext: nextDue !== null ? daysBetween(today, nextDue) : null,
    paidCount: rated.filter((row) => row.state === 'paid').length,
    billedCount: rated.filter((row) => row.state !== 'void' && row.state !== 'draft').length,
    monthlyRent: Number.isFinite(rent) ? rent : 0,
    termProgress,
    monthsElapsed,
    monthsTotal,
    openClaims: openClaims.length,
    focusClaim: openClaims[0] ?? claims[0] ?? null,
  };
}

/* ──────────── Queries ──────────── */

/** One window covers both the home summary and the first page of the list. */
export const INVOICE_PAGE_SIZE = 24;
export const CLAIM_PAGE_SIZE = 20;

export function usePortalContracts() {
  return useQuery<PortalContract[]>({
    queryKey: ['portal', 'contract'],
    queryFn: () => portalApiClient<PortalContract[]>('/portal/contract'),
  });
}

export function usePortalInvoices(limit: number = INVOICE_PAGE_SIZE) {
  return useQuery<PortalInvoicePage>({
    queryKey: ['portal', 'liquidaciones', limit],
    queryFn: () =>
      portalApiClient<PortalInvoicePage>(`/portal/liquidaciones?page=1&limit=${limit}`),
    placeholderData: (previous) => previous,
  });
}

export function usePortalClaims(limit: number = CLAIM_PAGE_SIZE) {
  return useQuery<PortalClaimPage>({
    queryKey: ['portal', 'tickets', limit],
    queryFn: () => portalApiClient<PortalClaimPage>(`/portal/tickets?page=1&limit=${limit}`),
    placeholderData: (previous) => previous,
  });
}

export function usePortalCategories() {
  return useQuery<PortalCategory[]>({
    queryKey: ['portal', 'categories'],
    queryFn: () => portalApiClient<PortalCategory[]>('/portal/categories'),
  });
}

/** The home screen's single source of truth. */
export function usePortalOverview() {
  const contracts = usePortalContracts();
  const invoices = usePortalInvoices();
  const claims = usePortalClaims();

  const invoiceItems = useMemo(() => invoices.data?.items ?? [], [invoices.data]);
  const claimItems = useMemo(() => claims.data?.data ?? [], [claims.data]);

  const overview = useMemo(
    () => buildOverview(contracts.data ?? [], invoiceItems, claimItems),
    [contracts.data, invoiceItems, claimItems],
  );

  return {
    overview,
    invoices: invoiceItems,
    claims: claimItems,
    /** True only until the first payload lands — refetches keep the content up. */
    isLoading: contracts.isPending || invoices.isPending || claims.isPending,
    isError: contracts.isError || invoices.isError || claims.isError,
  };
}

/* ──────────── Routing ──────────── */

export interface PortalPaths {
  home: string;
  invoices: string;
  claims: string;
}

/** Locale-prefixed portal routes. The invoice route keeps its original name. */
export function usePortalPaths(): PortalPaths {
  const pathname = usePathname();
  const prefix = pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}|[a-z]{2})/)?.[0] || '/es';

  return {
    home: `${prefix}/portal`,
    invoices: `${prefix}/portal/liquidaciones`,
    claims: `${prefix}/portal/tickets`,
  };
}
