// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
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
// jsdom no mide el contenedor: se le da un tamaño fijo para que el gráfico dibuje.
vi.mock('recharts', async (importOriginal) => {
  const original = await importOriginal<typeof import('recharts')>();
  const { cloneElement } = await import('react');
  return {
    ...original,
    ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) =>
      cloneElement(children, { width: 640, height: 260 }),
  };
});

import { ApiRequestError } from '@/lib/api-client';
import { ReportsPage } from './reports-page';

const norm = (s: string | null) => (s ?? '').replaceAll(' ', ' ');

/** El "hasta" por defecto: último día del mes en curso. */
const monthEnd = () => {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(lastDay)}`;
};
const range = () => `from=${new Date().getFullYear()}-01-01&to=${monthEnd()}`;

function report(overrides: Record<string, unknown> = {}) {
  return {
    type: 'cashFlow',
    title: 'Flujo de caja',
    columns: ['mes', 'ingresos', 'egresos', 'facturado', 'saldoNeto'],
    rows: [
      { mes: 'octubre de 2026', ingresos: '100000', egresos: '25000.5', facturado: '120000', saldoNeto: '74999.5' },
      { mes: 'noviembre de 2026', ingresos: '90000', egresos: '10000', facturado: '95000', saldoNeto: '80000' },
    ],
    summary: { ingresos: '190000', egresos: '35000.5' },
    generatedAt: '2026-11-01T15:30:00.000Z',
    filters: {},
    ...overrides,
  };
}

/** Listados de los filtros y el reporte que se pida. */
function mockApi(result: unknown = report()) {
  apiClient.mockImplementation((path: string) => {
    if (path.startsWith('/persons')) {
      return Promise.resolve({ items: [{ id: 'own-1', firstName: 'Ana', lastName: 'Torres' }] });
    }
    if (path.startsWith('/properties')) {
      return Promise.resolve({ items: [{ id: 'prop-1', title: 'Depto Uno' }] });
    }
    if (path.startsWith('/contracts')) {
      return Promise.resolve({ items: [{ id: 'con-1', status: 'Activo', property: { title: 'Casa Tres' } }] });
    }
    if (path.startsWith('/pipelines')) {
      return Promise.resolve([{ id: 'pip-1', name: 'Embudo de Alquiler' }]);
    }
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  });
}

const reportCalls = () =>
  apiClient.mock.calls.map((call) => String(call[0])).filter((path) => path.startsWith('/reports/'));

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
    expect(screen.getByRole('heading', { name: 'Reportes' })).toBeInTheDocument();
    expect(screen.getByText(/Elegí un tipo de reporte para verlo acá/)).toBeInTheDocument();
  });

  it.each(['Ventas', 'Soporte', 'Lectura'])('%s ve el aviso de acceso restringido', (role) => {
    auth.role = role;
    renderEs(<ReportsPage />);
    expect(screen.queryByRole('heading', { name: 'Reportes' })).not.toBeInTheDocument();
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

  it('genera el flujo de caja al elegirlo, del 1 de enero a hoy, con importes formateados', async () => {
    mockApi();
    await pickType('Flujo de caja mensual');
    await screen.findByText('2 filas');
    await waitFor(() => expect(norm(document.body.textContent)).toContain('$100.000,00'));
    expect(reportCalls()).toEqual([`/reports/cashFlow?${range()}`]);
    const text = norm(document.body.textContent);
    expect(text).toContain('$25.000,50');
    expect(text).toContain('$190.000,00');
    expect(screen.getByRole('button', { name: 'Descargar Excel' })).toBeInTheDocument();
  });

  it('dibuja el flujo de caja con leyenda, unidad y meses abreviados', async () => {
    mockApi();
    await pickType('Flujo de caja mensual');
    expect(await screen.findByRole('img', { name: 'Flujo de caja mensual' })).toBeInTheDocument();
    expect(screen.getByText('En pesos, para el período elegido')).toBeInTheDocument();
    expect(screen.getByText('oct 26')).toBeInTheDocument();
    expect(screen.getByText('nov 26')).toBeInTheDocument();
  });

  it('no dibuja un gráfico cuando todo el período está en cero', async () => {
    mockApi(
      report({
        rows: [{ mes: 'noviembre de 2026', ingresos: '0', egresos: '0', facturado: '0', saldoNeto: '0' }],
      }),
    );
    await pickType('Flujo de caja mensual');
    await screen.findByText('1 fila');
    expect(screen.queryByRole('img', { name: 'Flujo de caja mensual' })).not.toBeInTheDocument();
  });

  it('el estado de cuenta espera a que se elija el propietario', async () => {
    mockApi();
    const user = await pickType('Estado de cuenta del propietario');
    await screen.findByRole('option', { name: 'Torres, Ana' });
    expect(reportCalls()).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Generar reporte' }));
    expect(toast.error).toHaveBeenCalledWith('Elegí un propietario para ver su estado de cuenta');
    expect(reportCalls()).toEqual([]);
  });

  it('al elegir el propietario genera su estado de cuenta', async () => {
    mockApi(
      report({
        type: 'ownerStatement',
        rows: [{ periodo: '2026-10', propiedad: 'Depto Uno', cobrado: '1000', depositoNeto: '900' }],
        summary: undefined,
      }),
    );
    const user = await pickType('Estado de cuenta del propietario');
    await screen.findByRole('option', { name: 'Torres, Ana' });
    await user.selectOptions(screen.getByLabelText('Propietario'), 'own-1');
    await waitFor(() => expect(reportCalls()).toHaveLength(1));
    expect(reportCalls()[0]).toContain('ownerId=own-1');
    await screen.findAllByText('Depto Uno');
  });

  it('al quitar el propietario saca su estado de cuenta y las descargas', async () => {
    mockApi(
      report({
        type: 'ownerStatement',
        rows: [{ periodo: '2026-10', propiedad: 'Depto Uno', cobrado: '1000', depositoNeto: '900' }],
        summary: undefined,
      }),
    );
    const user = await pickType('Estado de cuenta del propietario');
    await screen.findByRole('option', { name: 'Torres, Ana' });
    await user.selectOptions(screen.getByLabelText('Propietario'), 'own-1');
    await screen.findAllByText('Depto Uno');
    expect(screen.getByRole('button', { name: 'Descargar Excel' })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Propietario'), '');
    await waitFor(() => expect(screen.queryByText('Depto Uno')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Descargar Excel' })).not.toBeInTheDocument();
    expect(reportCalls()).toHaveLength(1);
  });

  it('propiedad, contrato y embudo se eligen de una lista y filtran el reporte', async () => {
    mockApi(report({ rows: [], summary: undefined }));
    const user = userEvent.setup();
    renderEs(<ReportsPage />);

    await user.click(screen.getByRole('button', { name: /Rentabilidad por propiedad/ }));
    await screen.findByRole('option', { name: 'Depto Uno' });
    await user.selectOptions(screen.getByLabelText('Propiedad'), 'prop-1');
    await waitFor(() => expect(reportCalls().at(-1)).toContain('propertyId=prop-1'));

    await user.click(screen.getByRole('button', { name: /Resumen de comisiones/ }));
    await screen.findByRole('option', { name: 'Casa Tres · Activo' });
    await user.selectOptions(screen.getByLabelText('Contrato'), 'con-1');
    await waitFor(() => expect(reportCalls().at(-1)).toContain('contractId=con-1'));

    await user.click(screen.getByRole('button', { name: /Leads por etapa/ }));
    await screen.findByRole('option', { name: 'Embudo de Alquiler' });
    await user.selectOptions(screen.getByLabelText('Embudo'), 'pip-1');
    await waitFor(() => expect(reportCalls().at(-1)).toContain('pipelineId=pip-1'));
    expect(screen.queryByLabelText(/ID /)).not.toBeInTheDocument();
  });

  it('nombra el tipo de comisión y separa embudo y etapa sin raya larga', async () => {
    mockApi(
      report({
        type: 'commissionSummary',
        rows: [
          {
            propiedad: 'Depto Uno',
            propietario: 'Ana Torres',
            periodo: '9/2026',
            tipoComision: 'FixedPercent',
            comision: '100',
            honorarios: '0',
            total: '100',
          },
        ],
        summary: undefined,
      }),
    );
    const user = await pickType('Resumen de comisiones');
    expect((await screen.findAllByText('Porcentaje')).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain('FixedPercent');

    mockApi(
      report({
        type: 'pipelineAnalytics',
        rows: [{ etapa: 'Embudo de Alquiler — Contactado', leadsActuales: '3', convertidos: '1', perdidos: '0', tasaConversion: '8.3%' }],
        summary: undefined,
      }),
    );
    await user.click(screen.getByRole('button', { name: /Leads por etapa/ }));
    expect((await screen.findAllByText('Embudo de Alquiler · Contactado')).length).toBeGreaterThan(0);
    expect(screen.getByText('Cantidad de leads, para el período elegido')).toBeInTheDocument();
    expect(screen.getByText('Alquiler · Contactado')).toBeInTheDocument();
    expect(norm(document.body.textContent)).toContain('8,3 %');
  });

  it('muestra morosidad con totales propios y cuentas sin decimales', async () => {
    mockApi(
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
    await pickType('Morosidad');
    await screen.findByText('1 fila');
    await waitFor(() => expect(norm(document.body.textContent)).toContain('Casa Tres'));
    const text = norm(document.body.textContent);
    expect(text).toContain('$350.000,00');
    expect(text).toContain('1.500');
  });

  it('descarga Excel y PDF con la ruta y los filtros', async () => {
    mockApi();
    downloadFile.mockResolvedValue(undefined);
    const user = await pickType('Flujo de caja mensual');
    await user.click(await screen.findByRole('button', { name: 'Descargar Excel' }));
    await waitFor(() => expect(downloadFile).toHaveBeenCalledTimes(1));
    expect(downloadFile).toHaveBeenNthCalledWith(
      1,
      `/reports/cashFlow/excel?${range()}`,
      expect.stringMatching(/^reporte-cashFlow-\d{4}-\d{2}-\d{2}\.xlsx$/),
      { preferServerName: true },
    );
    await user.click(screen.getByRole('button', { name: 'Descargar PDF' }));
    await waitFor(() => expect(downloadFile).toHaveBeenCalledTimes(2));
    expect(downloadFile.mock.calls[1][0]).toBe(`/reports/cashFlow/pdf?${range()}`);
    expect(downloadFile.mock.calls[1][1]).toMatch(/\.pdf$/);
  });

  it('avisa si falla la descarga', async () => {
    mockApi();
    downloadFile.mockRejectedValue(new Error('x'));
    const user = await pickType('Flujo de caja mensual');
    await user.click(await screen.findByRole('button', { name: 'Descargar PDF' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('No se pudo descargar el archivo'));
  });

  it('muestra el mensaje del servidor o uno genérico si falla la carga', async () => {
    mockApi(new ApiRequestError(400, 'BAD_REQUEST', 'Rango inválido'));
    const user = await pickType('Flujo de caja mensual');
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Rango inválido'));

    mockApi(new Error('boom'));
    await user.click(screen.getByRole('button', { name: 'Generar reporte' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('No se pudo generar el reporte'));
  });

  it('cambia las fechas, vuelve a generar y restablece los filtros', async () => {
    mockApi();
    const user = await pickType('Flujo de caja mensual');
    const from = screen.getByLabelText<HTMLInputElement>('Desde');
    await user.clear(from);
    await user.type(from, '2026-03-01');
    expect(from.value).toBe('2026-03-01');
    await user.click(screen.getByRole('button', { name: 'Generar reporte' }));
    await waitFor(() => expect(reportCalls().at(-1)).toContain('from=2026-03-01'));
    await user.click(screen.getByRole('button', { name: 'Restablecer filtros' }));
    expect(screen.getByLabelText<HTMLInputElement>('Desde').value).toBe(`${new Date().getFullYear()}-01-01`);
    expect(screen.getByLabelText<HTMLInputElement>('Hasta').value).toBe(monthEnd());
  });
});
