// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import es from '@/i18n/messages/es.json';

const { apiClient } = vi.hoisted(() => ({ apiClient: vi.fn() }));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'Liquidaciones' } }),
  useOptionalAuth: () => ({ user: { id: 'u1', role: 'Liquidaciones' } }),
}));
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { MonthlyServiceBills } from './monthly-service-bills';

const UNIT_A = '22222222-2222-4222-8222-222222222222';
const UNIT_B = '33333333-3333-4333-8333-333333333333';

const SHEET = {
  period: '2026-11-01',
  rows: [
    {
      service: {
        id: 's1',
        serviceType: 'Agua',
        providerName: null,
        amount: '1000',
        currency: 'ARS',
        dueDay: 10,
        billingFrequency: 'Mensual',
        hasAnnualOption: false,
        property: { id: 'bld', title: 'Edificio Demo' },
      },
      bills: [
        {
          id: 'b1',
          installmentLabel: '11/2026',
          amount: '1000',
          nominalAmount: '1200',
          dueDate: '2026-11-10T00:00:00.000Z',
          consumption: '600',
          unitConsumptions: [
            { propertyId: UNIT_A, consumption: '100' },
            { propertyId: UNIT_B, consumption: '200' },
          ],
          notes: 'Factura del bimestre',
          status: 'Pendiente',
          paidBy: null,
        },
      ],
      rules: [],
    },
  ],
};

beforeEach(() => vi.clearAllMocks());

describe('DEF-107 / CP-1139 — corregir una boleta cargada no pierde sus otros datos', () => {
  it('al guardar el importe se reenvían el consumo por unidad, el importe sin descuento y las notas', async () => {
    apiClient.mockImplementation(async (path: string) => {
      if (path.startsWith('/service-bills/sheet')) return SHEET;
      return { total: 1, created: 0, updated: 1, unchanged: 0, failed: 0, results: [{ index: 0, status: 'updated', billId: 'b1' }] };
    });
    render(
      <NextIntlClientProvider locale="es" messages={es}>
        <MonthlyServiceBills />
      </NextIntlClientProvider>,
    );
    const user = userEvent.setup();
    const amount = await screen.findByLabelText('Importe 1');
    await user.clear(amount);
    await user.type(amount, '1100');
    await user.click(screen.getByRole('button', { name: /Guardar 1 boleta/ }));

    await waitFor(() => expect(apiClient.mock.calls.some(([p]) => p === '/service-bills/bulk')).toBe(true));
    const call = apiClient.mock.calls.find(([p]) => p === '/service-bills/bulk')!;
    expect(JSON.parse(call[1].body)[0]).toMatchObject({
      amount: '1100',
      nominalAmount: '1200',
      notes: 'Factura del bimestre',
      unitConsumptions: [
        { propertyId: UNIT_A, consumption: '100' },
        { propertyId: UNIT_B, consumption: '200' },
      ],
    });
  });
});
