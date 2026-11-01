// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import es from '@/i18n/messages/es.json';

const { apiClient, auth, toastSuccess, toastError } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  auth: { role: 'Liquidaciones' },
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u1', role: auth.role } }),
  useOptionalAuth: () => ({ user: { id: 'u1', role: auth.role } }),
}));
vi.mock('@/lib/toast', () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a), info: vi.fn() },
}));

import { ApiRequestError } from '@/lib/api-client';
import { MonthlyServiceBills } from './monthly-service-bills';

const service = (id: string, o: Record<string, unknown> = {}) => ({
  id,
  serviceType: 'Electricidad',
  providerName: 'Ente de prueba',
  amount: '18000',
  currency: 'ARS',
  dueDay: 10,
  billingFrequency: 'Mensual',
  hasAnnualOption: false,
  property: { id: `p-${id}`, title: `Depto ${id}` },
  ...o,
});

const rule = (o: Record<string, unknown> = {}) => ({
  id: 'r1',
  contractId: 'c1',
  payer: 'Inmobiliaria',
  splitMode: 'Porcentaje',
  tenantSharePct: '50',
  fixedAmount: null,
  paymentPlan: 'Mensual',
  ...o,
});

const SHEET = {
  period: '2026-11-01',
  rows: [
    { service: service('s1'), bills: [], rules: [rule()] },
    {
      service: service('s2', { serviceType: 'Municipal', providerName: null }),
      bills: [
        { id: 'b2', installmentLabel: '11/2026', amount: '9000', dueDate: '2026-11-15T00:00:00.000Z', consumption: null, status: 'Pendiente', paidBy: null },
      ],
      rules: [rule({ id: 'r2', payer: 'Propietario', splitMode: 'Fijo', fixedAmount: '2500', paymentPlan: 'Anual' })],
    },
    { service: service('s3', { serviceType: 'Gas' }), bills: [], rules: [rule({ id: 'r3', payer: 'Inquilino' })] },
    { service: service('s4', { serviceType: 'Agua' }), bills: [], rules: [rule({ id: 'r4', splitMode: 'Consumo' })] },
    { service: service('s5', { serviceType: 'Internet' }), bills: [], rules: [] },
  ],
};

function setup(bulk?: () => unknown, sheet: unknown = SHEET) {
  apiClient.mockImplementation(async (path: string) => {
    if (path.startsWith('/service-bills/sheet')) return sheet;
    if (path === '/service-bills/bulk') return bulk ? bulk() : { total: 1, created: 1, updated: 0, unchanged: 0, failed: 0, results: [] };
    throw new Error(`unexpected ${path}`);
  });
  return render(
    <NextIntlClientProvider locale="es" messages={es}>
      <MonthlyServiceBills />
    </NextIntlClientProvider>,
  );
}

const bulkCalls = () => apiClient.mock.calls.filter(([path]) => path === '/service-bills/bulk');

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = 'Liquidaciones';
});

describe('Boletas del mes', () => {
  it('muestra una fila por servicio con quién paga según las reglas', async () => {
    setup();
    expect(await screen.findByLabelText('Importe 1')).toBeInTheDocument();
    expect(apiClient).toHaveBeenCalledWith(expect.stringMatching(/^\/service-bills\/sheet\?period=\d{4}-\d{2}$/));

    expect(screen.getByText('Inmobiliaria (50 % al inquilino)')).toBeInTheDocument();
    expect(screen.getByText(/Propietario \(2.500,00 fijo, anual\)|Propietario \(\$\s?2\.500,00 fijo, anual\)/)).toBeInTheDocument();
    expect(screen.getByText('Inquilino (paga directo)')).toBeInTheDocument();
    expect(screen.getByText('Inmobiliaria (por consumo)')).toBeInTheDocument();
    expect(screen.getByText('Sin reglas')).toBeInTheDocument();
    expect(screen.getByText('Municipal')).toBeInTheDocument();
    // La boleta cargada trae su importe y estado; los demás servicios se proponen vacíos con la cuota del mes.
    expect(screen.getByLabelText('Importe 2')).toHaveValue('9000');
    expect(screen.getByLabelText('Cuota 2')).toHaveValue('11/2026');
    expect(screen.getByLabelText('Importe 1')).toHaveValue('');
    expect((screen.getByLabelText('Vencimiento 1') as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-10$/);
    expect(screen.getAllByText('Sin cargar').length).toBeGreaterThan(0);
  });

  it('guarda solo las filas con importe y cambios, en una carga masiva', async () => {
    setup(() => ({ total: 1, created: 1, updated: 0, unchanged: 0, failed: 0, results: [{ index: 0, status: 'created', billId: 'x' }] }));
    const user = userEvent.setup();
    await screen.findByLabelText('Importe 1');

    expect(screen.getByRole('button', { name: /Guardar boletas/ })).toBeDisabled();
    await user.type(screen.getByLabelText('Importe 1'), '12345,5');
    await user.type(screen.getByLabelText('Consumo 1'), '120');
    expect(screen.getByRole('button', { name: 'Guardar 1 boleta' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Guardar 1 boleta' }));

    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    const body = JSON.parse(bulkCalls()[0][1].body);
    expect(body).toEqual([
      expect.objectContaining({
        serviceId: 's1',
        amount: '12345.5',
        consumption: '120',
        installmentLabel: expect.stringMatching(/^\d{2}\/\d{4}$/),
        dueDate: expect.stringMatching(/^\d{4}-\d{2}-10$/),
      }),
    ]);
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining('Se guardó 1 boleta')));
  });

  it('pegar filas desde una planilla completa importe, vencimiento y consumo', async () => {
    setup();
    const user = userEvent.setup();
    await screen.findByLabelText('Importe 1');

    await user.click(screen.getByLabelText('Importe 1'));
    await user.paste('1000,50\t05/11/2026\t30\n2000\t06/11/2026\t40');

    expect(screen.getByLabelText('Importe 1')).toHaveValue('1000,50');
    expect(screen.getByLabelText('Vencimiento 1')).toHaveValue('05/11/2026');
    expect(screen.getByLabelText('Consumo 1')).toHaveValue('30');
    expect(screen.getByLabelText('Importe 2')).toHaveValue('2000');
    expect(screen.getByText('Se pegaron 2 filas')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Guardar 2 boletas/ }));
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    const body = JSON.parse(bulkCalls()[0][1].body);
    expect(body[0]).toMatchObject({ serviceId: 's1', amount: '1000.50', dueDate: '2026-11-05', consumption: '30' });
    // La boleta ya cargada conserva su cuota aunque la fila se edite.
    expect(body[1]).toMatchObject({ serviceId: 's2', installmentLabel: '11/2026', amount: '2000', dueDate: '2026-11-06' });
  });

  it('valida cada celda y no guarda con errores', async () => {
    setup();
    const user = userEvent.setup();
    await screen.findByLabelText('Importe 1');

    await user.type(screen.getByLabelText('Importe 1'), '12,345');
    await user.clear(screen.getByLabelText('Vencimiento 1'));
    await user.type(screen.getByLabelText('Vencimiento 1'), '31/02/2026');
    await user.type(screen.getByLabelText('Consumo 1'), 'mucho');
    await user.clear(screen.getByLabelText('Cuota 2'));
    await user.type(screen.getByLabelText('Cuota 2'), 'otra');

    expect(await screen.findByText('Ingresá un importe válido (hasta 2 decimales)')).toBeInTheDocument();
    expect(screen.getByText('Fecha inválida (AAAA-MM-DD o D/M/AAAA)')).toBeInTheDocument();
    expect(screen.getByText('Ingresá un número válido')).toBeInTheDocument();
    expect(screen.getByText('La cuota de una boleta cargada no se cambia')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Guardar/ }));
    expect(bulkCalls()).toHaveLength(0);
  });

  it('con filas rechazadas por la API las lista con su motivo y no recarga', async () => {
    setup(() => ({
      total: 2,
      created: 1,
      updated: 0,
      unchanged: 0,
      failed: 1,
      results: [
        { index: 0, status: 'created', billId: 'x' },
        { index: 1, status: 'error', error: { code: 'BILL_ALREADY_BILLED', message: 'ya facturada' } },
      ],
    }));
    const user = userEvent.setup();
    await screen.findByLabelText('Importe 1');
    await user.type(screen.getByLabelText('Importe 1'), '100');
    await user.type(screen.getByLabelText('Importe 2'), '5');
    await user.click(screen.getByRole('button', { name: /Guardar 2 boletas/ }));

    expect(await screen.findByText('Estas filas no se guardaron')).toBeInTheDocument();
    expect(screen.getByText(/La boleta ya está incluida en una liquidación y no se puede cambiar\./)).toBeInTheDocument();
    expect(toastError).toHaveBeenCalled();
    expect(apiClient.mock.calls.filter(([p]) => String(p).startsWith('/service-bills/sheet'))).toHaveLength(1);
  });

  it('un error al guardar avisa y conserva lo escrito', async () => {
    setup(() => {
      throw new ApiRequestError(500, 'INTERNAL_ERROR', 'falló');
    });
    const user = userEvent.setup();
    await screen.findByLabelText('Importe 1');
    await user.type(screen.getByLabelText('Importe 1'), '100');
    await user.click(screen.getByRole('button', { name: /Guardar 1 boleta/ }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('falló'));
    expect(screen.getByLabelText('Importe 1')).toHaveValue('100');
  });

  it('cambiar de mes pide la planilla de ese mes', async () => {
    setup();
    await screen.findByLabelText('Importe 1');
    const picker = screen.getByLabelText('Mes');
    await userEvent.setup().clear(picker);
    await userEvent.setup().type(picker, '2026-12');
    await waitFor(() => expect(apiClient).toHaveBeenCalledWith('/service-bills/sheet?period=2026-12'));
  });

  it('sin servicios activos lo dice, y un error de carga se muestra', async () => {
    setup(undefined, { period: '2026-11-01', rows: [] });
    expect(await screen.findByText(/No hay servicios activos/)).toBeInTheDocument();
  });

  it('un error de carga se muestra', async () => {
    apiClient.mockRejectedValue(new ApiRequestError(500, 'INTERNAL_ERROR', 'sin conexión'));
    render(
      <NextIntlClientProvider locale="es" messages={es}>
        <MonthlyServiceBills />
      </NextIntlClientProvider>,
    );
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('un rol sin permiso no ve la planilla ni la pide', async () => {
    auth.role = 'Soporte';
    setup();
    expect(await screen.findByText('No tenés permiso para cargar boletas.')).toBeInTheDocument();
    expect(apiClient).not.toHaveBeenCalled();
  });
});
