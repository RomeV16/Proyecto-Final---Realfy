// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import es from '@/i18n/messages/es.json';
import en from '@/i18n/messages/en.json';

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

import { ApiRequestError } from '@/lib/api-client';
import { MonthlyServiceBills } from './monthly-service-bills';

const UNIT_A = '22222222-2222-4222-8222-222222222222';
const UNIT_B = '33333333-3333-4333-8333-333333333333';
const UNIT_C = '44444444-4444-4444-8444-444444444444';

const rule = (id: string, contractId: string, propertyId: string, propertyTitle: string) => ({
  id,
  contractId,
  payer: 'Propietario',
  splitMode: 'Consumo',
  tenantSharePct: '100',
  fixedAmount: null,
  paymentPlan: 'Mensual',
  propertyId,
  propertyTitle,
});

const WATER = {
  service: {
    id: 's1',
    serviceType: 'Agua',
    providerName: null,
    amount: '0',
    currency: 'ARS',
    dueDay: 10,
    billingFrequency: 'Mensual',
    hasAnnualOption: false,
    property: { id: 'bld', title: 'Edificio Demo' },
  },
  bills: [],
  rules: [rule('r1', 'c1', UNIT_A, 'Unidad A'), rule('r2', 'c2', UNIT_B, 'Unidad B')],
  units: [
    { propertyId: UNIT_A, title: 'Unidad A' },
    { propertyId: UNIT_B, title: 'Unidad B' },
    { propertyId: UNIT_C, title: 'Unidad C' },
  ],
};

const PLAIN = {
  service: { ...WATER.service, id: 's2', serviceType: 'Gas', property: { id: 'p2', title: 'Depto Demo' } },
  bills: [],
  rules: [],
};

const PREVIEW = {
  allocations: [
    { contractId: 'c1', payer: 'Propietario', amount: '300.00', chargePeriod: '2026-11-01', installmentNo: 1, installmentsTotal: 1, basis: 'Consumo: 100 de 300' },
    { contractId: 'c2', payer: 'Propietario', amount: '600.00', chargePeriod: '2026-11-01', installmentNo: 1, installmentsTotal: 1, basis: 'Consumo: 200 de 300' },
  ],
  skipped: [{ contractId: 'c9', reason: 'ZeroShare' }],
  warnings: [],
};

function setup(preview: () => unknown = () => PREVIEW, locale: 'es' | 'en' = 'es') {
  apiClient.mockImplementation(async (path: string) => {
    if (path.startsWith('/service-bills/sheet')) return { period: '2026-11-01', rows: [WATER, PLAIN] };
    if (path === '/service-bills/preview') return preview();
    if (path === '/service-bills/bulk')
      return { total: 1, created: 1, updated: 0, unchanged: 0, failed: 0, results: [{ index: 0, status: 'created', billId: 'x' }] };
    throw new Error(`unexpected ${path}`);
  });
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'es' ? es : en}>
      <MonthlyServiceBills />
    </NextIntlClientProvider>,
  );
}

const callsTo = (path: string) => apiClient.mock.calls.filter(([p]) => p === path);

beforeEach(() => vi.clearAllMocks());

describe('Boletas del mes: consumo por unidad', () => {
  it('CP-1140 — un servicio de un edificio muestra una fila por unidad, y el que no tiene unidades no', async () => {
    setup();
    const panel = await screen.findByRole('region', { name: /Consumo por unidad: Edificio Demo · Agua/ });
    expect(within(panel).getByLabelText('Consumo de Unidad A')).toBeInTheDocument();
    expect(within(panel).getByLabelText('Consumo de Unidad B')).toBeInTheDocument();
    expect(within(panel).getByLabelText('Consumo de Unidad C')).toBeInTheDocument();
    expect(screen.getAllByRole('region')).toHaveLength(1);
  });

  it('CP-1141 — suma los consumos y avisa si el total de la boleta es menor o deja consumo sin unidad', async () => {
    setup();
    const user = userEvent.setup();
    const panel = await screen.findByRole('region', { name: /Consumo por unidad/ });
    await user.type(within(panel).getByLabelText('Consumo de Unidad A'), '100');
    await user.type(within(panel).getByLabelText('Consumo de Unidad B'), '200,5');
    await user.type(within(panel).getByLabelText('Consumo de Unidad C'), '0');
    expect(within(panel).getByText('300.5')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Consumo 1'), '250');
    expect(within(panel).getByText(/es menor a la suma de las unidades \(300\.5\)/)).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Consumo 1'));
    await user.type(screen.getByLabelText('Consumo 1'), '400');
    expect(within(panel).getByText(/Quedan 99\.5 de consumo sin unidad/)).toBeInTheDocument();
  });

  it('CP-1142 — la vista previa pide el reparto a la API y lo muestra por unidad', async () => {
    setup();
    const user = userEvent.setup();
    const panel = await screen.findByRole('region', { name: /Consumo por unidad/ });
    await user.click(within(panel).getByRole('button', { name: 'Ver reparto' }));
    expect(await within(panel).findByRole('alert')).toHaveTextContent('Cargá primero el importe de la boleta.');
    expect(callsTo('/service-bills/preview')).toHaveLength(0);

    await user.type(screen.getByLabelText('Importe 1'), '900');
    await user.type(within(panel).getByLabelText('Consumo de Unidad A'), '100');
    await user.type(within(panel).getByLabelText('Consumo de Unidad B'), '200');
    await user.click(within(panel).getByRole('button', { name: 'Ver reparto' }));

    expect(await within(panel).findByText('Reparto con las reglas vigentes')).toBeInTheDocument();
    const body = JSON.parse(callsTo('/service-bills/preview')[0][1].body);
    expect(body).toEqual({
      serviceId: 's1',
      period: expect.stringMatching(/^\d{4}-\d{2}$/),
      amount: '900',
      consumption: null,
      unitConsumptions: [
        { propertyId: UNIT_A, consumption: '100' },
        { propertyId: UNIT_B, consumption: '200' },
      ],
    });
    expect(within(panel).getByText('Consumo: 100 de 300')).toBeInTheDocument();
    expect(within(panel).getByText(/300,00/)).toBeInTheDocument();
    expect(within(panel).getByText(/600,00/)).toBeInTheDocument();
    expect(within(panel).getByText(/no le toca pagar nada/)).toBeInTheDocument();
  });

  it('CP-1143 — si la vista previa no reparte lo dice, y un error de la API se muestra', async () => {
    let fail = false;
    setup(() => {
      if (fail) throw new ApiRequestError(400, 'UNIT_NOT_IN_BUILDING', 'La unidad no pertenece al servicio');
      return { allocations: [], skipped: [], warnings: [] };
    });
    const user = userEvent.setup();
    const panel = await screen.findByRole('region', { name: /Consumo por unidad/ });
    await user.type(screen.getByLabelText('Importe 1'), '900');
    await user.click(within(panel).getByRole('button', { name: 'Ver reparto' }));
    expect(await within(panel).findByText('Con estos datos no se traslada nada a nadie.')).toBeInTheDocument();

    fail = true;
    await user.click(within(panel).getByRole('button', { name: 'Ver reparto' }));
    expect(await within(panel).findByRole('alert')).toHaveTextContent('La unidad no pertenece al servicio');
  });

  it('CP-1144 — con varias unidades por consumo no deja guardar si falta el consumo de una', async () => {
    setup();
    const user = userEvent.setup();
    const panel = await screen.findByRole('region', { name: /Consumo por unidad/ });
    await user.type(screen.getByLabelText('Importe 1'), '900');
    await user.type(within(panel).getByLabelText('Consumo de Unidad A'), '100');
    expect(within(panel).getByText(/Falta el consumo de esta unidad/)).toBeInTheDocument();
    expect(within(panel).getByLabelText('Consumo de Unidad B')).toHaveAttribute('aria-invalid', 'true');

    await user.click(screen.getByRole('button', { name: /Guardar 1 boleta/ }));
    expect(callsTo('/service-bills/bulk')).toHaveLength(0);

    await user.type(within(panel).getByLabelText('Consumo de Unidad B'), 'mucho');
    expect(within(panel).getByText('Ingresá un consumo válido (hasta 3 decimales)')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Ver reparto' })).toBeDisabled();
  });

  it('CP-1145 — guarda el consumo de cada unidad junto con la boleta', async () => {
    setup();
    const user = userEvent.setup();
    const panel = await screen.findByRole('region', { name: /Consumo por unidad/ });
    await user.type(screen.getByLabelText('Importe 1'), '900');
    await user.type(within(panel).getByLabelText('Consumo de Unidad A'), '100');
    await user.type(within(panel).getByLabelText('Consumo de Unidad B'), '200');
    await user.type(within(panel).getByLabelText('Consumo de Unidad C'), '0');
    await user.click(screen.getByRole('button', { name: /Guardar 1 boleta/ }));

    await waitFor(() => expect(callsTo('/service-bills/bulk')).toHaveLength(1));
    expect(JSON.parse(callsTo('/service-bills/bulk')[0][1].body)[0]).toMatchObject({
      serviceId: 's1',
      amount: '900',
      unitConsumptions: [
        { propertyId: UNIT_A, consumption: '100' },
        { propertyId: UNIT_B, consumption: '200' },
        { propertyId: UNIT_C, consumption: '0' },
      ],
    });
  });

  it('CP-1146 — la pantalla sale en inglés y el panel sigue siendo utilizable', async () => {
    setup(undefined, 'en');
    const user = userEvent.setup();
    const panel = await screen.findByRole('region', { name: /Consumption per unit/ });
    await user.type(screen.getByLabelText('Amount 1'), '900');
    await user.type(within(panel).getByLabelText('Consumption of Unidad A'), '5');
    expect(within(panel).getByRole('button', { name: 'Preview split' })).toBeEnabled();
  });
});
