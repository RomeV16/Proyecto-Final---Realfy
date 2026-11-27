// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderEsWithQuery } from '../index-data/test-utils';

const { apiClient } = vi.hoisted(() => ({ apiClient: vi.fn() }));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));

import { FeeSummary } from './fee-summary';
import { summarizeInstallments, summaryMonths, todayKey } from './fee-summary-data';

const nb = (s: string | null) => (s ?? '').replace(/[  ]/g, ' ');

const row = (dueDate: string, status: string, dueAmount: string, o: Record<string, unknown> = {}, fee: Record<string, unknown> = {}) => ({
  dueDate: `${dueDate}T00:00:00.000Z`,
  status,
  dueAmount,
  paidAmount: null as string | null,
  ...o,
  fee: { status: 'Pendiente', currency: 'ARS', ...fee },
});

const MONTHS = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];

describe('resumen de honorarios: cálculo', () => {
  it('arma los meses que terminan en el mes en curso y la fecha de hoy', () => {
    expect(summaryMonths(new Date(2026, 10, 20), 6)).toEqual(MONTHS);
    expect(summaryMonths(new Date(2026, 0, 5), 3)).toEqual(['2025-11', '2025-12', '2026-01']);
    expect(todayKey(new Date(2026, 1, 3))).toBe('2026-02-03');
  });

  it('suma cobrado, por cobrar y vencido por mes, sin las anuladas ni otras monedas', () => {
    const data = summarizeInstallments(
      [
        row('2026-10-05', 'Pagada', '100000.00', { paidAmount: '110000.00' }),
        row('2026-10-20', 'Pendiente', '50000.10'),
        row('2026-11-25', 'Pendiente', '70000.20'),
        row('2026-11-01', 'Pagada', '30000.00'),
        row('2026-11-02', 'Anulada', '999999.00'),
        row('2026-11-03', 'Pendiente', '999999.00', {}, { status: 'Anulado' }),
        row('2026-09-10', 'Pendiente', '500.00', {}, { currency: 'USD' }),
        row('2026-01-10', 'Pendiente', '999999.00'),
      ],
      MONTHS,
      '2026-11-20',
    );
    expect(data.currency).toBe('ARS');
    expect(data.count).toBe(4);
    expect(data.collected).toBe(14_000_000);
    expect(data.pending).toBe(12_000_030);
    expect(data.overdue).toBe(5_000_010);
    expect(data.otherCurrencies).toEqual(['USD']);
    expect(data.buckets.map((b) => b.month)).toEqual(MONTHS);
    expect(data.buckets[4]).toEqual({ month: '2026-10', collected: 11_000_000, pending: 5_000_010 });
    expect(data.buckets[5]).toEqual({ month: '2026-11', collected: 3_000_000, pending: 7_000_020 });
  });

  it('sin cuotas queda en cero y en pesos', () => {
    expect(summarizeInstallments([], MONTHS, '2026-11-20')).toMatchObject({ currency: 'ARS', collected: 0, pending: 0, overdue: 0, count: 0, otherCurrencies: [] });
  });
});

describe('resumen de honorarios: pantalla', () => {
  beforeEach(() => {
    apiClient.mockReset();
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-20T12:00:00.000Z') });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const byMonth = (items: Record<string, unknown[]>) =>
    apiClient.mockImplementation(async (path: string) => {
      const month = new URLSearchParams(path.split('?')[1]).get('period') ?? '';
      return { items: items[month] ?? [], total: 0, page: 1, limit: 200, totalPages: 1 };
    });

  it('muestra el total del período, lo cobrado, lo que falta, lo vencido y una barra por mes', async () => {
    byMonth({
      '2026-10': [row('2026-10-05', 'Pagada', '100000.00'), row('2026-10-20', 'Pendiente', '50000.00')],
      '2026-11': [row('2026-11-25', 'Pendiente', '250000.00'), row('2026-11-26', 'Pendiente', '10.00', {}, { currency: 'USD' })],
    });
    renderEsWithQuery(<FeeSummary />);
    const summary = within(await screen.findByRole('region', { name: 'Resumen de honorarios' }));
    expect(apiClient).toHaveBeenCalledTimes(6);
    expect(apiClient).toHaveBeenCalledWith('/fees/installments?page=1&limit=200&period=2026-06');
    expect(apiClient).toHaveBeenCalledWith('/fees/installments?page=1&limit=200&period=2026-11');
    const text = nb(document.body.textContent);
    expect(text).toContain('$ 400.000');
    expect(text).toContain('3 cuotas con vencimiento entre Junio de 2026 – Noviembre de 2026');
    expect(text).toContain('$ 100.00025 %');
    expect(text).toContain('Por cobrar$ 300.000');
    expect(text).toContain('De eso, ya vencido$ 50.000');
    expect(text).toContain('Importes en ARS. También hay cuotas en USD');
    expect(summary.getAllByRole('img')).toHaveLength(6);
    expect(nb(summary.getByRole('img', { name: /Octubre de 2026/ }).getAttribute('aria-label'))).toBe(
      'Octubre de 2026: cobrado $ 100.000, por cobrar $ 50.000',
    );
    expect(text).toContain('$250K');
  });

  it('sin cuotas en el período lo dice en lugar de dibujar barras', async () => {
    byMonth({});
    renderEsWithQuery(<FeeSummary />);
    expect(await screen.findByText(/No hay cuotas con vencimiento en estos meses/)).toBeInTheDocument();
    expect(nb(document.body.textContent)).toContain('Sin cuotas con vencimiento entre');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('si falla el cálculo lo avisa sin romper la pantalla', async () => {
    apiClient.mockRejectedValue(new Error('red'));
    renderEsWithQuery(<FeeSummary />);
    expect(await screen.findByRole('status')).toHaveTextContent('No se pudo calcular el resumen de honorarios');
  });
});
