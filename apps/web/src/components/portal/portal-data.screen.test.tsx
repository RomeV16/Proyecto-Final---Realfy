// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { portalApiClient } = vi.hoisted(() => ({ portalApiClient: vi.fn() }));

vi.mock('@/lib/portal-api-client', () => ({
  portalApiClient: (...args: unknown[]) => portalApiClient(...args),
}));

import {
  PORTAL_PATHS,
  addressOf,
  buildOverview,
  claimTone,
  daysBetween,
  invoiceState,
  isClaimOpen,
  todayUtcDay,
  usePortalCategories,
  usePortalClaims,
  usePortalContracts,
  usePortalInvoices,
  usePortalOverview,
  usePortalPaths,
  type PortalClaim,
  type PortalContract,
  type PortalInvoice,
} from './portal-data';

const DAY = 86_400_000;
const iso = (offsetDays: number) => new Date(todayUtcDay() + offsetDays * DAY).toISOString();

function invoice(overrides: Partial<PortalInvoice> = {}): PortalInvoice {
  return {
    id: 'i-1',
    period: '2026-10',
    status: 'Pendiente',
    total: '100000',
    currency: 'ARS',
    dueDate: iso(10),
    paidAt: null,
    contract: null,
    ...overrides,
  };
}

function claim(overrides: Partial<PortalClaim> = {}): PortalClaim {
  return {
    id: 'k-1',
    title: 'Pérdida de agua',
    description: null,
    status: 'Abierto',
    priority: 'Media',
    createdAt: iso(-3),
    property: null,
    category: null,
    ...overrides,
  };
}

function contract(overrides: Partial<PortalContract> = {}): PortalContract {
  return {
    id: 'c-1',
    propertyId: 'p-1',
    property: { id: 'p-1', name: 'Depto de prueba', address: 'Calle Falsa 123' },
    contractType: 'Alquiler',
    status: 'Activo',
    startDate: iso(-365),
    endDate: iso(365),
    rentAmount: '150000',
    rentCurrency: 'ARS',
    adjustmentType: 'IPC',
    adjustmentPeriod: 'Trimestral',
    nextAdjustmentDate: null,
    lastAdjustmentDate: null,
    ...overrides,
  };
}

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

describe('helpers de fechas y direcciones', () => {
  it('daysBetween cuenta días enteros con signo', () => {
    const today = todayUtcDay();
    expect(daysBetween(today, today + 5 * DAY)).toBe(5);
    expect(daysBetween(today, today - 2 * DAY)).toBe(-2);
  });

  it('addressOf prioriza calle y número, luego título y ciudad', () => {
    expect(addressOf(null)).toBeNull();
    expect(addressOf({ id: 'p', street: 'Calle Falsa', number: '123', title: 'T' })).toBe('Calle Falsa 123');
    expect(addressOf({ id: 'p', title: 'Depto' })).toBe('Depto');
    expect(addressOf({ id: 'p', city: 'Ciudad Ejemplo' })).toBe('Ciudad Ejemplo');
    expect(addressOf({ id: 'p' })).toBeNull();
  });
});

describe('estado de facturas y reclamos', () => {
  it('traduce el estado interno a lo que ve el inquilino', () => {
    expect(invoiceState(invoice({ status: 'Pagada' }))).toBe('paid');
    expect(invoiceState(invoice({ status: 'Anulada' }))).toBe('void');
    expect(invoiceState(invoice({ status: 'Borrador' }))).toBe('draft');
    expect(invoiceState(invoice({ status: 'Revision' }))).toBe('draft');
    expect(invoiceState(invoice({ status: 'Aprobada' }))).toBe('draft');
    expect(invoiceState(invoice({ status: 'Vencida' }))).toBe('overdue');
    expect(invoiceState(invoice({ status: 'Enviada', dueDate: iso(-1) }))).toBe('overdue');
    expect(invoiceState(invoice({ status: 'Pendiente', dueDate: iso(3) }))).toBe('due');
    expect(invoiceState(invoice({ status: 'Pendiente', dueDate: null }))).toBe('due');
  });

  it('isClaimOpen y claimTone distinguen cada estado', () => {
    expect(isClaimOpen(claim({ status: 'Abierto' }))).toBe(true);
    expect(isClaimOpen(claim({ status: 'Resuelto' }))).toBe(false);
    expect(isClaimOpen(claim({ status: 'Cerrado' }))).toBe(false);
    expect(isClaimOpen(claim({ status: 'Cancelado' }))).toBe(false);
    expect(claimTone(claim({ status: 'Cancelado' }))).toBe('neutral');
    expect(claimTone(claim({ status: 'Resuelto' }))).toBe('success');
    expect(claimTone(claim({ status: 'Cerrado' }))).toBe('success');
    expect(claimTone(claim({ status: 'Abierto' }))).toBe('warning');
    expect(claimTone(claim({ status: 'Reabierto' }))).toBe('warning');
    expect(claimTone(claim({ status: 'EnProgreso' }))).toBe('brand');
  });
});

describe('buildOverview', () => {
  it('sin datos devuelve una cuenta al día y valores en cero', () => {
    const o = buildOverview([], [], []);
    expect(o).toMatchObject({
      contract: null,
      propertyLabel: null,
      currency: 'ARS',
      state: 'clear',
      balance: 0,
      overdueCount: 0,
      pendingCount: 0,
      daysLate: 0,
      focusInvoice: null,
      daysToDue: null,
      nextInvoice: null,
      daysToNext: null,
      paidCount: 0,
      billedCount: 0,
      monthlyRent: 0,
      termProgress: 0,
      monthsElapsed: 0,
      monthsTotal: 0,
      openClaims: 0,
      focusClaim: null,
    });
  });

  it('con una factura vencida y otra por vencer calcula saldo, atraso y foco', () => {
    const overdue = invoice({ id: 'i-old', dueDate: iso(-12), total: '50000.5' });
    const next = invoice({ id: 'i-next', dueDate: iso(7), total: 100000 });
    const later = invoice({ id: 'i-later', dueDate: iso(40), total: 'abc' });
    const paid = invoice({ id: 'i-paid', status: 'Pagada' });
    const draft = invoice({ id: 'i-draft', status: 'Borrador' });
    const voided = invoice({ id: 'i-void', status: 'Anulada' });
    const o = buildOverview([contract()], [later, next, overdue, paid, draft, voided], []);
    expect(o.state).toBe('overdue');
    expect(o.overdueCount).toBe(1);
    expect(o.pendingCount).toBe(2);
    expect(o.overdueAmount).toBeCloseTo(50000.5);
    expect(o.balance).toBeCloseTo(150000.5);
    expect(o.daysLate).toBe(12);
    expect(o.focusInvoice?.id).toBe('i-old');
    expect(o.daysToDue).toBe(-12);
    expect(o.nextInvoice?.id).toBe('i-next');
    expect(o.daysToNext).toBe(7);
    expect(o.paidCount).toBe(1);
    expect(o.billedCount).toBe(4);
    expect(o.monthlyRent).toBe(150000);
  });

  it('solo facturas por vencer deja la cuenta pendiente', () => {
    const o = buildOverview([], [invoice({ dueDate: iso(5) })], []);
    expect(o.state).toBe('pending');
    expect(o.focusInvoice?.id).toBe('i-1');
    expect(o.daysToDue).toBe(5);
    expect(o.daysLate).toBe(0);
  });

  it('una factura por vencer sin fecha no rompe el cálculo', () => {
    const o = buildOverview([], [invoice({ dueDate: null })], []);
    expect(o.state).toBe('pending');
    expect(o.daysToDue).toBeNull();
    expect(o.daysToNext).toBeNull();
  });

  it('progreso del contrato en meses y porcentaje', () => {
    const o = buildOverview([contract({ startDate: iso(-182), endDate: iso(183) })], [], []);
    expect(o.monthsTotal).toBe(12);
    expect(o.monthsElapsed).toBe(5);
    expect(o.termProgress).toBeGreaterThanOrEqual(49);
    expect(o.termProgress).toBeLessThanOrEqual(51);
  });

  it('contratos sin fecha de fin o con fechas invertidas no dan progreso', () => {
    const noEnd = buildOverview([contract({ endDate: null })], [], []);
    expect(noEnd.monthsTotal).toBe(0);
    expect(noEnd.termProgress).toBe(0);
    expect(noEnd.monthsElapsed).toBe(0);
    const reversed = buildOverview([contract({ startDate: iso(10), endDate: iso(5) })], [], []);
    expect(reversed.termProgress).toBe(0);
    const noStart = buildOverview([contract({ startDate: null, rentAmount: null })], [], []);
    expect(noStart.monthsElapsed).toBe(0);
    expect(noStart.monthlyRent).toBe(0);
  });

  it('un alquiler no numérico queda en cero', () => {
    expect(buildOverview([contract({ rentAmount: 'xx' })], [], []).monthlyRent).toBe(0);
  });

  it('la dirección sale de la factura, y si no del contrato', () => {
    const withProp = invoice({
      contract: { id: 'c-1', property: { id: 'p-1', street: 'Av. Ejemplo', number: '45' } },
    });
    expect(buildOverview([contract()], [withProp], []).propertyLabel).toBe('Av. Ejemplo 45');
    expect(buildOverview([contract()], [invoice()], []).propertyLabel).toBe('Calle Falsa 123');
    expect(
      buildOverview([contract({ property: { id: 'p', name: 'Solo nombre', address: null } })], [], [])
        .propertyLabel,
    ).toBe('Solo nombre');
  });

  it('la moneda sale del contrato, la primera factura o ARS', () => {
    expect(buildOverview([contract({ rentCurrency: 'USD' })], [], []).currency).toBe('USD');
    expect(buildOverview([], [invoice({ currency: 'USD' })], []).currency).toBe('USD');
    expect(buildOverview([contract({ rentCurrency: null })], [], []).currency).toBe('ARS');
  });

  it('reclamos: cuenta los abiertos y elige el foco', () => {
    const closed = claim({ id: 'k-closed', status: 'Resuelto' });
    const open = claim({ id: 'k-open', status: 'Abierto' });
    const mixed = buildOverview([], [], [closed, open]);
    expect(mixed.openClaims).toBe(1);
    expect(mixed.focusClaim?.id).toBe('k-open');
    const allClosed = buildOverview([], [], [closed]);
    expect(allClosed.openClaims).toBe(0);
    expect(allClosed.focusClaim?.id).toBe('k-closed');
  });
});

describe('hooks de consulta', () => {
  beforeEach(() => {
    portalApiClient.mockReset();
    portalApiClient.mockImplementation((path: string) => {
      if (path === '/portal/contract') return Promise.resolve([contract()]);
      if (path.startsWith('/portal/liquidaciones'))
        return Promise.resolve({ items: [invoice({ dueDate: iso(-4) })], total: 1, page: 1, limit: 24, totalPages: 1 });
      if (path.startsWith('/portal/tickets'))
        return Promise.resolve({ data: [claim()], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } });
      if (path === '/portal/categories') return Promise.resolve([{ id: 'cat-1', name: 'Plomería', icon: null, color: null }]);
      return Promise.reject(new Error('ruta desconocida'));
    });
  });

  it('cada hook pide su endpoint con la paginación esperada', async () => {
    const contracts = renderHook(() => usePortalContracts(), { wrapper: wrapper() });
    const invoices = renderHook(() => usePortalInvoices(), { wrapper: wrapper() });
    const claims = renderHook(() => usePortalClaims(), { wrapper: wrapper() });
    const categories = renderHook(() => usePortalCategories(), { wrapper: wrapper() });
    await waitFor(() => expect(contracts.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(invoices.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(claims.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(categories.result.current.isSuccess).toBe(true));
    expect(portalApiClient).toHaveBeenCalledWith('/portal/contract');
    expect(portalApiClient).toHaveBeenCalledWith('/portal/liquidaciones?page=1&limit=24');
    expect(portalApiClient).toHaveBeenCalledWith('/portal/tickets?page=1&limit=20');
    expect(portalApiClient).toHaveBeenCalledWith('/portal/categories');
    expect(categories.result.current.data?.[0].name).toBe('Plomería');
  });

  it('los hooks aceptan un límite propio', async () => {
    const invoices = renderHook(() => usePortalInvoices(5), { wrapper: wrapper() });
    const claims = renderHook(() => usePortalClaims(3), { wrapper: wrapper() });
    await waitFor(() => expect(invoices.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(claims.result.current.isSuccess).toBe(true));
    expect(portalApiClient).toHaveBeenCalledWith('/portal/liquidaciones?page=1&limit=5');
    expect(portalApiClient).toHaveBeenCalledWith('/portal/tickets?page=1&limit=3');
  });

  it('usePortalOverview combina las tres cargas y deriva el resumen', async () => {
    const { result } = renderHook(() => usePortalOverview(), { wrapper: wrapper() });
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isError).toBe(false);
    expect(result.current.invoices).toHaveLength(1);
    expect(result.current.claims).toHaveLength(1);
    expect(result.current.overview.state).toBe('overdue');
    expect(result.current.overview.daysLate).toBe(4);
    expect(result.current.overview.openClaims).toBe(1);
  });

  it('usePortalOverview informa el error si falla una carga', async () => {
    portalApiClient.mockImplementation((path: string) =>
      path === '/portal/contract' ? Promise.reject(new Error('caído')) : Promise.resolve({ items: [], data: [] }),
    );
    const { result } = renderHook(() => usePortalOverview(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.overview.state).toBe('clear');
  });
});

describe('rutas del portal', () => {
  it('son rutas sin idioma; el prefijo lo agrega el enlace', () => {
    expect(usePortalPaths()).toBe(PORTAL_PATHS);
    expect(PORTAL_PATHS).toEqual({
      home: '/portal',
      invoices: '/portal/liquidaciones',
      claims: '/portal/tickets',
    });
  });
});
