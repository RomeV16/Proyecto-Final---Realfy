// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import es from '@/i18n/messages/es.json';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';

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
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/es/ajustes',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/toast', () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a), info: vi.fn() },
}));

import { ApiRequestError } from '@/lib/api-client';
import { MonthlyAdjustments } from './monthly-adjustments';

const row = (id: string, o: Record<string, unknown> = {}) => ({
  contractId: id,
  scheduleId: `s-${id}`,
  periodNumber: 1,
  adjustmentDate: '2026-04-01T00:00:00.000Z',
  overdue: false,
  propertyTitle: `Depto ${id}`,
  adjustmentType: 'IPC',
  currency: 'ARS',
  currentRent: '100000.00',
  newRent: '105060.00',
  percentage: '5.0600',
  factor: '1.050600',
  status: 'ready',
  isProvisional: false,
  estimatedPeriods: [],
  indexValues: [
    { indexType: 'IPC', period: '2026-01', value: '2', isEstimate: false },
    { indexType: 'IPC', period: '2026-02', value: '3', isEstimate: false },
  ],
  missing: null,
  error: null,
  selectable: true,
  ...o,
});

const ROWS = [
  row('a'),
  row('b', {
    status: 'provisional',
    isProvisional: true,
    newRent: '104550.00',
    indexValues: [{ indexType: 'IPC', period: '2026-02', value: '2.5', isEstimate: true }],
  }),
  row('c', {
    status: 'missing_data',
    selectable: false,
    newRent: null,
    percentage: null,
    indexValues: [],
    missing: { indexTypes: ['CVS', 'CER'], missingPeriods: ['2026-02'], estimatesOnly: false },
  }),
  row('d', { status: 'error', selectable: false, newRent: null, percentage: null, indexValues: [], error: 'MISSING_ADJUSTMENT_PCT' }),
  row('e', { overdue: true, status: 'fixed_initial', newRent: '100000.00', percentage: '0.0000', propertyTitle: null }),
];

function setup(onApply?: () => unknown, rows: unknown[] = ROWS) {
  apiClient.mockImplementation(async (path: string) => {
    if (path === '/adjustments/preview-batch') return { period: '2026-04', rows };
    if (path === '/adjustments/apply-batch') return onApply ? onApply() : { period: '2026-04', results: [] };
    throw new Error(`unexpected ${path}`);
  });
  return render(
    <NextIntlClientProvider locale="es" messages={es}>
      <ConfirmProvider>
        <MonthlyAdjustments />
      </ConfirmProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = 'Liquidaciones';
});

describe('Ajustes del mes', () => {
  it('lista los ajustes con su estado, y las filas sin datos no se pueden elegir', async () => {
    setup();

    expect((await screen.findAllByText('Depto a')).length).toBeGreaterThan(0);
    expect(apiClient).toHaveBeenCalledWith(
      '/adjustments/preview-batch',
      expect.objectContaining({ method: 'POST', body: expect.stringMatching(/"period":"\d{4}-\d{2}"/) }),
    );
    // Dos de las tres filas aplicables salen "Listo", una "A cuenta" con su aviso.
    expect(screen.getAllByText('Listo').length).toBeGreaterThan(0);
    expect(screen.getAllByText('A cuenta').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Calculado con índices estimados/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2026-02 \(estimado\)/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Atrasado').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Faltan CVS, CER: 2026-02/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Cargar el índice' })[0]).toHaveAttribute(
      'href',
      expect.stringContaining('/configuracion/indices'),
    );
    expect(screen.getAllByText('Falta cargar el porcentaje del contrato.').length).toBeGreaterThan(0);

    expect(screen.getAllByRole('checkbox', { name: 'Elegir el ajuste de Depto c' })[0]).toBeDisabled();
    expect(screen.getAllByRole('checkbox', { name: 'Elegir el ajuste de Depto d' })[0]).toBeDisabled();
    expect(screen.getAllByRole('checkbox', { name: 'Elegir el ajuste de Depto a' })[0]).toBeEnabled();
  });

  it('elegir todos toma solo los aplicables y el botón cuenta lo elegido', async () => {
    setup();
    await screen.findAllByText('Depto a');
    const user = userEvent.setup();

    expect(screen.getByRole('button', { name: /Aplicar 0 ajustes/ })).toBeDisabled();
    await user.click(screen.getByLabelText('Elegir todos los ajustes aplicables'));

    expect(screen.getByRole('button', { name: 'Aplicar 3 ajustes' })).toBeEnabled();
    expect(screen.getByText(/3 ajustes elegidos/)).toBeInTheDocument();
    expect(screen.getByText(/1 a cuenta/)).toBeInTheDocument();

    await user.click(screen.getByLabelText('Elegir todos los ajustes aplicables'));
    expect(screen.getByRole('button', { name: /Aplicar 0 ajustes/ })).toBeDisabled();
  });

  it('confirma, aplica los elegidos y muestra el resultado por fila', async () => {
    setup(() => ({
      period: '2026-04',
      results: [
        { contractId: 'a', result: 'applied', status: 'applied', reason: null },
        { contractId: 'b', result: 'applied', status: 'provisional', reason: null },
        { contractId: 'e', result: 'skipped', status: null, reason: 'MISSING_INDEX_DATA' },
      ],
    }));
    await screen.findAllByText('Depto a');
    const user = userEvent.setup();

    await user.click(screen.getAllByRole('checkbox', { name: 'Elegir el ajuste de Depto a' })[0]);
    await user.click(screen.getAllByRole('checkbox', { name: 'Elegir el ajuste de Depto b' })[0]);
    await user.click(screen.getByRole('button', { name: 'Aplicar 2 ajustes' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/actualizar los alquileres de 2 contratos/)).toBeInTheDocument();
    expect(within(dialog).getByText(/1 se aplica a cuenta/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Aplicar' }));

    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith(
        '/adjustments/apply-batch',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"contractIds":["a","b"]'),
        }),
      ),
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining('Se aplicaron 2 ajustes')));
    expect(toastSuccess.mock.calls[0][0]).toContain('1 quedó pendiente');
    expect(await screen.findAllByText('Aplicado a cuenta')).not.toHaveLength(0);
    expect(screen.getAllByText('Faltan datos del índice').length).toBeGreaterThan(0);
  });

  it('cancelar la confirmación no aplica nada', async () => {
    setup();
    await screen.findAllByText('Depto a');
    const user = userEvent.setup();

    await user.click(screen.getAllByRole('checkbox', { name: 'Elegir el ajuste de Depto a' })[0]);
    await user.click(screen.getByRole('button', { name: 'Aplicar 1 ajuste' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /Cancelar/ }));

    expect(apiClient).not.toHaveBeenCalledWith('/adjustments/apply-batch', expect.anything());
  });

  it('un error al aplicar se informa con un aviso', async () => {
    setup(() => {
      throw new ApiRequestError(500, 'INTERNAL', 'Sin conexión');
    });
    await screen.findAllByText('Depto a');
    const user = userEvent.setup();

    await user.click(screen.getAllByRole('checkbox', { name: 'Elegir el ajuste de Depto a' })[0]);
    await user.click(screen.getByRole('button', { name: 'Aplicar 1 ajuste' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Aplicar' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Sin conexión'));
  });

  it('un error al cargar se muestra en lugar de la tabla', async () => {
    apiClient.mockRejectedValue(new ApiRequestError(503, 'UNAVAILABLE', 'No disponible'));
    render(
      <NextIntlClientProvider locale="es" messages={es}>
        <ConfirmProvider>
          <MonthlyAdjustments />
        </ConfirmProvider>
      </NextIntlClientProvider>,
    );
    expect(await screen.findByText(/No disponible/)).toBeInTheDocument();
  });

  it('cambiar el mes vuelve a previsualizar', async () => {
    setup();
    await screen.findAllByText('Depto a');
    const user = userEvent.setup();
    const input = screen.getByLabelText('Mes');

    await user.clear(input);
    await user.type(input, '2026-07');

    await waitFor(() =>
      expect(apiClient).toHaveBeenLastCalledWith(
        '/adjustments/preview-batch',
        expect.objectContaining({ body: JSON.stringify({ period: '2026-07' }) }),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Actualizar' }));
    expect(apiClient.mock.calls.filter((c) => c[0] === '/adjustments/preview-batch').length).toBeGreaterThan(2);
  });

  it('un rol sin permiso no ve la pantalla ni consulta nada', () => {
    auth.role = 'Ventas';
    setup();
    expect(screen.getByText('No tenés permiso para aplicar ajustes.')).toBeInTheDocument();
    expect(apiClient).not.toHaveBeenCalled();
  });

  describe('ajuste que baja el alquiler (DEF-176)', () => {
    const DROP = row('f', {
      adjustmentType: 'UVA',
      currentRent: '250000.00',
      newRent: '200000.00',
      percentage: '100.0000',
      rentChangePct: '-20.0000',
      rentDecrease: true,
    });
    const RISE = row('a', { rentChangePct: '5.0600', rentDecrease: false });

    it('CP-1454: muestra la variación del alquiler y la advertencia de la baja', async () => {
      setup(undefined, [RISE, DROP]);

      expect((await screen.findAllByText('Depto f')).length).toBeGreaterThan(0);

      expect(screen.getAllByText(/El alquiler baja 20 %/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/-20/).length).toBeGreaterThan(0);
      expect(screen.getAllByRole('checkbox', { name: 'Elegir el ajuste de Depto f' })[0]).toBeEnabled();
    });

    it('CP-1455: elegir todos deja afuera la baja, que se puede elegir a mano', async () => {
      setup(undefined, [RISE, DROP]);
      await screen.findAllByText('Depto f');
      const user = userEvent.setup();

      await user.click(screen.getByLabelText('Elegir todos los ajustes aplicables'));

      expect(screen.getByRole('button', { name: 'Aplicar 1 ajuste' })).toBeEnabled();
      expect(screen.getAllByRole('checkbox', { name: 'Elegir el ajuste de Depto f' })[0]).not.toBeChecked();

      await user.click(screen.getAllByRole('checkbox', { name: 'Elegir el ajuste de Depto f' })[0]);
      expect(screen.getByRole('button', { name: 'Aplicar 2 ajustes' })).toBeEnabled();
    });

    it('CP-1456: aplicar una baja pide confirmarla y la envía como confirmada', async () => {
      setup(undefined, [RISE, DROP]);
      await screen.findAllByText('Depto f');
      const user = userEvent.setup();

      await user.click(screen.getAllByRole('checkbox', { name: 'Elegir el ajuste de Depto a' })[0]);
      await user.click(screen.getAllByRole('checkbox', { name: 'Elegir el ajuste de Depto f' })[0]);
      await user.click(screen.getByRole('button', { name: 'Aplicar 2 ajustes' }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText(/1 ajuste baja el alquiler vigente/)).toBeInTheDocument();
      await user.click(within(dialog).getByRole('button', { name: 'Aplicar' }));

      await waitFor(() =>
        expect(apiClient).toHaveBeenCalledWith(
          '/adjustments/apply-batch',
          expect.objectContaining({ body: expect.stringContaining('"confirmRentDecrease":["f"]') }),
        ),
      );
    });

    it('CP-1456: lo que no baja no manda confirmaciones', async () => {
      setup(undefined, [RISE, DROP]);
      await screen.findAllByText('Depto a');
      const user = userEvent.setup();

      await user.click(screen.getAllByRole('checkbox', { name: 'Elegir el ajuste de Depto a' })[0]);
      await user.click(screen.getByRole('button', { name: 'Aplicar 1 ajuste' }));
      await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Aplicar' }));

      await waitFor(() =>
        expect(apiClient).toHaveBeenCalledWith(
          '/adjustments/apply-batch',
          expect.objectContaining({ body: expect.stringContaining('"confirmRentDecrease":[]') }),
        ),
      );
    });
  });
});
