// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '../index-data/test-utils';

const { apiClient, auth } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  auth: { role: 'Admin' },
}));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('@/lib/auth-context', () => {
  const value = () => ({
    user: { id: 'u1', role: auth.role, firstName: 'Ana', lastName: 'Prueba' },
  });
  return { useAuth: value, useOptionalAuth: value };
});
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/es/contracts/c-1',
}));
vi.mock('./closure-summary', () => ({ ClosureSummary: () => <div>cierre-mock</div> }));
vi.mock('./commission-config', () => ({ CommissionConfig: () => <div>comision-mock</div> }));
vi.mock('./generate-document-modal', () => ({
  GenerateDocumentModal: ({ open }: { open: boolean }) => (open ? <div>modal-documento</div> : null),
}));
vi.mock('./adjustment-timeline', () => ({ AdjustmentTimeline: () => null }));

import { ApiRequestError } from '@/lib/api-client';
import { ContractDetailView } from './contract-detail';

const norm = (s: string | null) => (s ?? '').replaceAll(' ', ' ');

function contract(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c-1',
    contractType: 'Alquiler',
    status: 'Activo',
    startDate: '2026-01-01T00:00:00.000Z',
    endDate: '2028-01-01T00:00:00.000Z',
    rentAmount: '100000',
    rentCurrency: 'ARS',
    depositAmount: '200000',
    adjustmentType: 'IPC',
    adjustmentPeriod: 'Trimestral',
    customAdjustmentPct: 12,
    isActive: true,
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-02T10:00:00.000Z',
    property: {
      id: 'p-1',
      title: 'Depto de prueba',
      street: 'Calle Falsa 123',
      city: 'Ciudad Ejemplo',
      type: 'Departamento',
    },
    persons: [
      { id: 'cp-1', role: 'Propietario', person: { id: 'per-1', firstName: 'Lucía', lastName: 'Ejemplo' } },
      { id: 'cp-2', role: 'Inquilino', person: { id: 'per-2', firstName: 'Mario', lastName: 'Muestra' } },
      { id: 'cp-3', role: 'Garante', person: { id: 'per-3', firstName: 'Nora', lastName: 'Dummy' } },
    ],
    guarantees: [
      {
        id: 'g-1',
        type: 'Seguro_de_caucion',
        description: 'Seguro de prueba',
        amount: '500000',
        issuer: 'Aseguradora Test',
        policyNumber: 'POL-001',
        endDate: '2028-01-01T00:00:00.000Z',
      },
      { id: 'g-2', type: 'Deposito', amount: null },
    ],
    adjustments: [],
    schedules: [],
    ...overrides,
  };
}

let current: unknown;
let handlers: Record<string, () => Promise<unknown>>;

function mockApi() {
  apiClient.mockImplementation((path: string, init?: { method?: string }) => {
    const key = `${init?.method ?? 'GET'} ${path}`;
    if (handlers[key]) return handlers[key]();
    if (key === 'GET /contracts/c-1') return Promise.resolve(current);
    return Promise.resolve({});
  });
}

async function renderDetail() {
  const utils = renderEs(<ContractDetailView contractId="c-1" />);
  await screen.findByRole('heading', { name: 'Depto de prueba' });
  return { ...utils, user: userEvent.setup() };
}

describe('ContractDetailView — formatos y secciones', () => {
  beforeEach(() => {
    apiClient.mockReset();
    auth.role = 'Admin';
    handlers = {};
    current = contract();
    mockApi();
  });

  it('muestra montos con moneda y fechas largas en es-AR', async () => {
    const { container } = await renderDetail();
    const text = norm(container.textContent);
    expect(text).toContain('1 de enero de 2026');
    expect(text).toContain('1 de enero de 2028');
    expect(text).toContain('100.000,00');
    expect(text).toContain('200.000,00');
    expect(text).toContain('500.000,00');
    expect(text).toContain('Calle Falsa 123, Ciudad Ejemplo');
    expect(text).toContain('12%');
    expect(text).toContain('1 de noviembre de 2026');
    expect(text).toContain('2 de noviembre de 2026');
    expect(text).toContain('Seguro de prueba');
    expect(text).toContain('Aseguradora Test');
    expect(text).toContain('POL-001');
  });

  it('los enlaces a propiedad y personas llevan el prefijo de idioma', async () => {
    await renderDetail();
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/es/contracts');
    expect(hrefs).toContain('/es/properties/p-1');
    expect(hrefs).toContain('/es/persons/per-1');
    expect(hrefs).toContain('/es/persons/per-2');
    expect(hrefs).toContain('/es/persons/per-3');
  });

  it.each(['Admin', 'Gerente'])('%s ve comisión y resumen de cierre', async (role) => {
    auth.role = role;
    await renderDetail();
    expect(screen.getByText('comision-mock')).toBeInTheDocument();
    expect(screen.getByText('cierre-mock')).toBeInTheDocument();
  });

  it.each(['Ventas', 'Lectura'])('%s no ve comisión ni resumen de cierre', async (role) => {
    auth.role = role;
    await renderDetail();
    expect(screen.queryByText('comision-mock')).not.toBeInTheDocument();
    expect(screen.queryByText('cierre-mock')).not.toBeInTheDocument();
  });

  it('un contrato sin datos opcionales muestra guiones y estados vacíos', async () => {
    current = contract({
      status: 'Borrador',
      endDate: undefined,
      rentCurrency: undefined,
      currency: undefined,
      depositAmount: undefined,
      adjustmentType: undefined,
      adjustmentPeriod: undefined,
      customAdjustmentPct: undefined,
      property: { id: 'p-1', title: 'Depto de prueba' },
      persons: [],
      guarantees: [],
    });
    const { container } = await renderDetail();
    expect(container.textContent).toContain('—');
    expect(container.textContent).not.toContain('Calle Falsa');
    expect(screen.getAllByText(/garant/i).length).toBeGreaterThan(0);
  });

  it('un contrato sin propiedad usa el título genérico', async () => {
    current = contract({ property: undefined });
    renderEs(<ContractDetailView contractId="c-1" />);
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.queryByText('Depto de prueba')).not.toBeInTheDocument();
  });

  it('si el contrato no existe muestra error y enlace de vuelta', async () => {
    apiClient.mockRejectedValue(new Error('404'));
    renderEs(<ContractDetailView contractId="c-1" />);
    await screen.findByRole('heading', { level: 2 });
    expect(screen.getByRole('link').getAttribute('href')).toBe('/es/contracts');
  });

  it('calcula el ajuste pendiente y avisa del éxito', async () => {
    current = contract({ schedules: [{ id: 's-1', periodNumber: 1, scheduledDate: '2026-04-01T00:00:00.000Z', status: 'Pending' }] });
    handlers['POST /contracts/c-1/adjustments/calculate'] = () => Promise.resolve({});
    const { user } = await renderDetail();
    await user.click(screen.getByRole('button', { name: /Calcular ajuste/i }));
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith('/contracts/c-1/adjustments/calculate', {
        method: 'POST',
        body: JSON.stringify({ scheduleId: 's-1' }),
      }),
    );
    await waitFor(() => expect(document.body.textContent).toMatch(/ajuste/i));
  });

  it('si calcular falla muestra el mensaje de la API', async () => {
    current = contract({ schedules: [{ id: 's-1', periodNumber: 1, scheduledDate: '2026-04-01T00:00:00.000Z', status: 'Pending' }] });
    handlers['POST /contracts/c-1/adjustments/calculate'] = () =>
      Promise.reject(new ApiRequestError(400, 'X', 'Sin índice cargado'));
    const { user } = await renderDetail();
    await user.click(screen.getByRole('button', { name: /Calcular ajuste/i }));
    expect(await screen.findByText('Sin índice cargado')).toBeInTheDocument();
  });

  it('solo el rol con permiso de gestión calcula; Lectura no ve acciones', async () => {
    auth.role = 'Lectura';
    current = contract({ schedules: [{ id: 's-1', periodNumber: 1, scheduledDate: '2026-04-01T00:00:00.000Z', status: 'Pending' }] });
    await renderDetail();
    expect(screen.queryByRole('button', { name: /Calcular ajuste/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Generar/i })).not.toBeInTheDocument();
  });

  it('aplica un ajuste calculado (solo Admin y Gerente)', async () => {
    current = contract({
      adjustments: [
        {
          id: 'a-1',
          periodNumber: 1,
          scheduledDate: '2026-04-01T00:00:00.000Z',
          adjustmentType: 'IPC',
          status: 'Calculated',
        },
      ],
    });
    handlers['POST /contracts/c-1/adjustments/a-1/apply'] = () => Promise.resolve({});
    const { user } = await renderDetail();
    await user.click(screen.getByRole('button', { name: /Aplicar ajuste/i }));
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith('/contracts/c-1/adjustments/a-1/apply', { method: 'POST' }),
    );
  });

  it('si aplicar falla sin mensaje de la API usa el genérico', async () => {
    current = contract({
      adjustments: [
        { id: 'a-1', periodNumber: 1, scheduledDate: '2026-04-01T00:00:00.000Z', adjustmentType: 'IPC', status: 'Calculated' },
      ],
    });
    handlers['POST /contracts/c-1/adjustments/a-1/apply'] = () => Promise.reject(new Error('caído'));
    const { user } = await renderDetail();
    await user.click(screen.getByRole('button', { name: /Aplicar ajuste/i }));
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/No se pudo|Error/i),
    );
  });

  it('Ventas no ve aplicar ajuste aunque exista uno calculado', async () => {
    auth.role = 'Ventas';
    current = contract({
      adjustments: [
        { id: 'a-1', periodNumber: 1, scheduledDate: '2026-04-01T00:00:00.000Z', adjustmentType: 'IPC', status: 'Calculated' },
      ],
    });
    await renderDetail();
    expect(screen.queryByRole('button', { name: /Aplicar ajuste/i })).not.toBeInTheDocument();
  });

  it('abre el modal de generar documento', async () => {
    const { user } = await renderDetail();
    await user.click(screen.getByRole('button', { name: /Generar/i }));
    expect(screen.getByText('modal-documento')).toBeInTheDocument();
  });

  it('la pestaña de ajustes muestra la proyección y el historial con formato', async () => {
    current = contract({
      adjustments: [
        {
          id: 'a-1',
          periodNumber: 1,
          scheduledDate: '2026-04-01T00:00:00.000Z',
          previousAmount: '100000',
          newAmount: '110000',
          percentageChange: '10',
          adjustmentType: 'IPC',
          status: 'Applied',
        },
        {
          id: 'a-2',
          periodNumber: 2,
          scheduledDate: '2026-07-01T00:00:00.000Z',
          previousAmount: '110000',
          newAmount: '105000',
          percentageChange: '-4.5',
          adjustmentType: 'IPC',
          status: 'Applied',
        },
        {
          id: 'a-3',
          periodNumber: 3,
          scheduledDate: '2026-10-01T00:00:00.000Z',
          previousAmount: '105000',
          newAmount: '105000',
          adjustmentType: 'IPC',
          status: 'Applied',
        },
      ],
    });
    handlers['POST /contracts/c-1/preview-adjustment'] = () =>
      Promise.resolve({
        period: '2026-10',
        indexType: 'IPC',
        factor: 1.0523,
        currentRent: 100000,
        projectedRent: 105230,
        projectedDelta: 5230,
      });
    const { user, container } = await renderDetail();
    await user.click(screen.getByRole('button', { name: /Ajustes/i }));
    await waitFor(() => expect(container.textContent).toContain('1.0523'));
    const text = norm(container.textContent);
    expect(text).toContain('$ 105.230,00');
    expect(text).toContain('+$ 5.230,00');
    expect(text).toContain('+10.0%');
    expect(text).toContain('-4.5%');
    expect(text).toContain('$ 110.000,00');
  });

  it('la proyección negativa se muestra sin signo más', async () => {
    handlers['POST /contracts/c-1/preview-adjustment'] = () =>
      Promise.resolve({
        period: '2026-10',
        indexType: 'IPC',
        factor: 0.98,
        currentRent: 100000,
        projectedRent: 98000,
        projectedDelta: -2000,
      });
    const { user, container } = await renderDetail();
    await user.click(screen.getByRole('button', { name: /Ajustes/i }));
    await waitFor(() => expect(container.textContent).toContain('0.9800'));
    expect(norm(container.textContent)).not.toContain('+$ 2.000,00');
  });

  it('sin configuración de ajuste (404) muestra el aviso y sin historial', async () => {
    handlers['POST /contracts/c-1/preview-adjustment'] = () =>
      Promise.reject(new ApiRequestError(404, 'NOT_FOUND', 'no hay'));
    const { user } = await renderDetail();
    await user.click(screen.getByRole('button', { name: /Ajustes/i }));
    await waitFor(() => expect(screen.queryByText('no hay')).not.toBeInTheDocument());
    await waitFor(() => expect(apiClient).toHaveBeenCalledWith('/contracts/c-1/preview-adjustment', { method: 'POST' }));
  });

  it('otro error de la proyección muestra su mensaje', async () => {
    handlers['POST /contracts/c-1/preview-adjustment'] = () =>
      Promise.reject(new ApiRequestError(500, 'BOOM', 'Falla del servicio'));
    const { user } = await renderDetail();
    await user.click(screen.getByRole('button', { name: /Ajustes/i }));
    expect(await screen.findByText('Falla del servicio')).toBeInTheDocument();
  });

  it('un error genérico en la proyección usa el texto común', async () => {
    handlers['POST /contracts/c-1/preview-adjustment'] = () => Promise.reject(new Error('x'));
    const { user } = await renderDetail();
    await user.click(screen.getByRole('button', { name: /Ajustes/i }));
    await waitFor(() => expect(apiClient).toHaveBeenCalledWith('/contracts/c-1/preview-adjustment', { method: 'POST' }));
    await waitFor(() => expect(document.body.textContent).toMatch(/error/i));
  });
});
