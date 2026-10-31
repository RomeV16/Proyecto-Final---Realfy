// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '../index-data/test-utils';

const { apiClient, auth, downloadFile, toast } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  auth: { role: 'Admin' },
  downloadFile: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u1', role: auth.role, firstName: 'Ana', lastName: 'Prueba' } }),
  useOptionalAuth: () => ({
    user: { id: 'u1', role: auth.role, firstName: 'Ana', lastName: 'Prueba' },
  }),
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/es/reports',
}));
vi.mock('@/lib/toast', () => ({ toast }));
vi.mock('@/lib/download', () => ({
  downloadFile: (...args: unknown[]) => downloadFile(...args),
}));
vi.mock('./report-scheduling', () => ({
  ReportSchedulingSection: () => <div data-testid="programacion" />,
}));

import { ApiRequestError } from '@/lib/api-client';
import { ReportsPage } from './reports-page';

const norm = (s: string | null) => (s ?? '').replaceAll(' ', ' ');

function report(overrides: Record<string, unknown> = {}) {
  return {
    type: 'cashFlow',
    title: 'Flujo de caja',
    columns: ['mes', 'ingresos', 'egresos', 'facturado', 'saldoNeto'],
    rows: [
      { mes: '2026-10', ingresos: '100000', egresos: '25000.5', facturado: '120000', saldoNeto: '74999.5' },
      { mes: '2026-11', ingresos: '90000', egresos: '10000', facturado: '95000', saldoNeto: '80000' },
    ],
    summary: { ingresos: '190000', egresos: '35000.5' },
    generatedAt: '2026-11-01T15:30:00.000Z',
    filters: {},
    ...overrides,
  };
}

async function pickType(name: string) {
  const user = userEvent.setup();
  renderEs(<ReportsPage />);
  await user.click(screen.getByRole('button', { name: new RegExp(name) }));
  return user;
}

describe('ReportsPage', () => {
  beforeEach(() => {
    apiClient.mockReset();
    downloadFile.mockReset();
    toast.error.mockReset();
    auth.role = 'Admin';
  });

  it.each(['Admin', 'Gerente', 'Liquidaciones'])('%s accede a los reportes', (role) => {
    auth.role = role;
    renderEs(<ReportsPage />);
    expect(screen.getByRole('heading', { name: 'Reportes Financieros' })).toBeInTheDocument();
    expect(screen.getAllByText('Seleccioná un tipo de reporte').length).toBe(2);
  });

  it.each(['Ventas', 'Soporte', 'Lectura'])('%s ve el aviso de acceso restringido', (role) => {
    auth.role = role;
    renderEs(<ReportsPage />);
    expect(screen.queryByRole('heading', { name: 'Reportes Financieros' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Flujo de caja mensual/ })).not.toBeInTheDocument();
  });

  it.each([
    ['Admin', true],
    ['Gerente', true],
    ['Liquidaciones', false],
  ])('%s: programación de envíos visible = %s', (role, visible) => {
    auth.role = role;
    renderEs(<ReportsPage />);
    expect(!!screen.queryByTestId('programacion')).toBe(visible);
  });

  it('genera el flujo de caja con importes formateados y fecha de generación', async () => {
    apiClient.mockResolvedValue(report());
    const user = await pickType('Flujo de caja mensual');
    await user.click(screen.getByRole('button', { name: 'Generar reporte' }));
    await screen.findByText('2 filas');
    await waitFor(() => expect(norm(document.body.textContent)).toContain('$100.000,00'));
    const year = new Date().getFullYear();
    expect(apiClient).toHaveBeenCalledWith(
      `/reports/cashFlow?from=${year}-01-01&to=${year}-12-31`,
    );
    const text = norm(document.body.textContent);
    expect(text).toContain('$100.000,00');
    expect(text).toContain('$25.000,50');
    expect(text).toContain('$190.000,00');
    expect(screen.getByRole('button', { name: 'Descargar Excel' })).toBeInTheDocument();
  });

  it('exige el propietario en el estado de cuenta y no llama a la API', async () => {
    const user = await pickType('Estado de cuenta propietario');
    await user.click(screen.getByRole('button', { name: 'Generar reporte' }));
    expect(toast.error).toHaveBeenCalledWith(
      'El ID del propietario es obligatorio para este reporte',
    );
    expect(apiClient).not.toHaveBeenCalled();
  });

  it('envía el propietario recortado en el estado de cuenta', async () => {
    apiClient.mockResolvedValue(
      report({
        type: 'ownerStatement',
        rows: [{ periodo: '2026-10', propiedad: 'Depto Uno', cobrado: '1000', depositoNeto: '900' }],
        summary: undefined,
      }),
    );
    const user = await pickType('Estado de cuenta propietario');
    await user.type(screen.getByLabelText(/ID Propietario/), '  own-1 ');
    await user.click(screen.getByRole('button', { name: 'Generar reporte' }));
    await waitFor(() => expect(apiClient).toHaveBeenCalled());
    expect(apiClient.mock.calls[0][0]).toContain('ownerId=own-1');
    await screen.findAllByText('Depto Uno');
  });

  it('agrega los filtros de propiedad, contrato y pipeline según el tipo', async () => {
    apiClient.mockResolvedValue(report({ rows: [], summary: undefined }));
    const user = userEvent.setup();
    renderEs(<ReportsPage />);

    await user.click(screen.getByRole('button', { name: /Rentabilidad por propiedad/ }));
    await user.type(screen.getByLabelText('ID Propiedad'), 'prop-1');
    await user.click(screen.getByRole('button', { name: 'Generar reporte' }));
    await waitFor(() => expect(apiClient).toHaveBeenCalledTimes(1));
    expect(apiClient.mock.calls[0][0]).toContain('propertyId=prop-1');

    await user.click(screen.getByRole('button', { name: /Resumen de comisiones/ }));
    await user.type(screen.getByLabelText('ID Contrato'), 'con-1');
    await user.click(screen.getByRole('button', { name: 'Generar reporte' }));
    await waitFor(() => expect(apiClient).toHaveBeenCalledTimes(2));
    expect(apiClient.mock.calls[1][0]).toContain('contractId=con-1');

    await user.click(screen.getByRole('button', { name: /Analítica de Pipeline/ }));
    await user.type(screen.getByLabelText('ID Pipeline'), 'pip-1');
    await user.click(screen.getByRole('button', { name: 'Generar reporte' }));
    await waitFor(() => expect(apiClient).toHaveBeenCalledTimes(3));
    expect(apiClient.mock.calls[2][0]).toContain('pipelineId=pip-1');
  });

  it('muestra morosidad con totales propios y cuentas sin decimales', async () => {
    apiClient.mockResolvedValue(
      report({
        type: 'morosidad',
        rows: [
          {
            propiedad: 'Casa Tres',
            inquilino: 'Luis Inventado',
            periodo: '2026-09',
            vencimiento: '2026-09-10',
            diasVencidos: '1500',
            monto: '350000',
            moneda: 'ARS',
          },
        ],
        summary: { totalVencido: '350000', cantidadVencidas: '1500' },
      }),
    );
    const user = await pickType('Morosidad');
    await user.click(screen.getByRole('button', { name: 'Generar reporte' }));
    await screen.findByText('1 filas');
    await waitFor(() => expect(norm(document.body.textContent)).toContain('Casa Tres'));
    const text = norm(document.body.textContent);
    expect(text).toContain('$350.000,00');
    expect(text).toContain('1.500');
  });

  it('descarga Excel y PDF con la ruta y los filtros', async () => {
    apiClient.mockResolvedValue(report());
    downloadFile.mockResolvedValue(undefined);
    const user = await pickType('Flujo de caja mensual');
    await user.click(screen.getByRole('button', { name: 'Generar reporte' }));
    await user.click(await screen.findByRole('button', { name: 'Descargar Excel' }));
    const year = new Date().getFullYear();
    await waitFor(() => expect(downloadFile).toHaveBeenCalledTimes(1));
    expect(downloadFile).toHaveBeenNthCalledWith(
      1,
      `/reports/cashFlow/excel?from=${year}-01-01&to=${year}-12-31`,
      expect.stringMatching(/^reporte-cashFlow-\d{4}-\d{2}-\d{2}\.xlsx$/),
      { preferServerName: true },
    );
    await user.click(screen.getByRole('button', { name: 'Descargar PDF' }));
    await waitFor(() => expect(downloadFile).toHaveBeenCalledTimes(2));
    expect(downloadFile.mock.calls[1][0]).toBe(`/reports/cashFlow/pdf?from=${year}-01-01&to=${year}-12-31`);
    expect(downloadFile.mock.calls[1][1]).toMatch(/\.pdf$/);
  });

  it('avisa si falla la descarga', async () => {
    apiClient.mockResolvedValue(report());
    downloadFile.mockRejectedValue(new Error('x'));
    const user = await pickType('Flujo de caja mensual');
    await user.click(screen.getByRole('button', { name: 'Generar reporte' }));
    await user.click(await screen.findByRole('button', { name: 'Descargar PDF' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Error al descargar el archivo'));
  });

  it('muestra el mensaje del servidor o uno genérico si falla la carga', async () => {
    apiClient.mockRejectedValueOnce(new ApiRequestError(400, 'BAD_REQUEST', 'Rango inválido'));
    const user = await pickType('Flujo de caja mensual');
    await user.click(screen.getByRole('button', { name: 'Generar reporte' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Rango inválido'));

    apiClient.mockRejectedValueOnce(new Error('boom'));
    await user.click(screen.getByRole('button', { name: 'Generar reporte' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Error al generar el reporte'));
  });

  it('actualiza fechas y limpia los filtros', async () => {
    const user = await pickType('Flujo de caja mensual');
    const from = screen.getByLabelText('Desde') as HTMLInputElement;
    await user.clear(from);
    await user.type(from, '2026-03-01');
    expect(from.value).toBe('2026-03-01');
    await user.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    expect((screen.getByLabelText('Desde') as HTMLInputElement).value).toBe(
      `${new Date().getFullYear()}-01-01`,
    );
  });
});
