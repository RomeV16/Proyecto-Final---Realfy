// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '../index-data/test-utils';

const { apiClient, auth, toastSuccess, toastError, downloadFile } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  auth: { role: 'Admin' },
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  downloadFile: vi.fn(),
}));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('@/lib/auth-context', () => {
  const user = { id: 'u1', firstName: 'Usuario', lastName: 'Demo' };
  return {
    useAuth: () => ({ user: { ...user, role: auth.role } }),
    useOptionalAuth: () => ({ user: { ...user, role: auth.role } }),
  };
});
vi.mock('@/lib/toast', () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a), info: vi.fn() },
}));
vi.mock('@/lib/download', () => ({ downloadFile: (...a: unknown[]) => downloadFile(...a) }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import { ApiRequestError } from '@/lib/api-client';
import { ContractExpiration } from './contract-expiration';

const GARANTE = '0d9bdf7e-8f4c-4a52-9d8e-5b3b4a6b3c11';

const FOLLOW_UP = {
  id: 'f1',
  contractId: 'c1',
  kind: 'Renovacion',
  status: 'Abierto',
  outcome: 'Pendiente',
  dueDate: '2026-12-15T00:00:00.000Z',
  assigneeId: null,
  notes: null,
  closedAt: null,
  effectiveEnd: '2026-12-15T00:00:00.000Z',
  signedEnd: '2026-12-15T00:00:00.000Z',
  daysLeft: 43,
  light: 'yellow',
  property: 'Depto Sintético',
  tenantName: 'Inés Ficticia',
  tasks: [{ id: 't1', code: 'VISITA', label: 'Visita', done: true, doneAt: null, doneById: null, dueDate: null }],
  progress: { done: 1, total: 1 },
};

const PERIODS = [
  { id: 'p1', seq: 1, kind: 'Original', startDate: '2025-01-01T00:00:00.000Z', endDate: '2026-12-15T00:00:00.000Z', initialRent: '100000' },
  { id: 'p2', seq: 2, kind: 'Renovacion', startDate: '2026-12-16T00:00:00.000Z', endDate: '2028-12-15T00:00:00.000Z', initialRent: '180000' },
];

const contract = (o: Record<string, unknown> = {}) => ({
  id: 'c1',
  status: 'Activo',
  endDate: '2026-12-15T00:00:00.000Z',
  actualEndDate: null,
  rentAmount: '150000',
  rentCurrency: 'ARS',
  persons: [
    { role: 'Inquilino', person: { id: 'p-i', firstName: 'Inés', lastName: 'Ficticia' } },
    { role: 'Garante', person: { id: GARANTE, firstName: 'Gabriel', lastName: 'Garante' } },
  ],
  ...o,
});

interface Setup {
  followUps?: unknown[];
  periods?: unknown[];
  write?: (path: string, init: { method: string; body: string }) => unknown;
  loadFails?: boolean;
}

function setup(props: Record<string, unknown> = {}, { followUps = [FOLLOW_UP], periods = PERIODS, write, loadFails }: Setup = {}) {
  const onChanged = vi.fn();
  apiClient.mockImplementation(async (path: string, init?: { method?: string; body: string }) => {
    if (init?.method) return write ? write(path, init as { method: string; body: string }) : {};
    if (loadFails) throw new ApiRequestError(500, 'INTERNAL_ERROR', 'boom');
    if (path.startsWith('/follow-ups?')) return { items: followUps, total: followUps.length, page: 1, limit: 1, totalPages: 1 };
    if (path.endsWith('/periods')) return periods;
    throw new Error(`unexpected ${path}`);
  });
  renderEs(<ContractExpiration contract={contract(props)} onChanged={onChanged} />);
  return { onChanged };
}

const writes = () => apiClient.mock.calls.filter(([, init]) => init?.method);

beforeEach(() => {
  apiClient.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  downloadFile.mockReset();
  auth.role = 'Admin';
});

describe('Vencimiento del contrato', () => {
  it('muestra el fin, el semáforo, el seguimiento abierto y las renovaciones', async () => {
    setup();
    expect(await screen.findByText('Por vencer')).toBeInTheDocument();
    expect(screen.getByText('Fin pactado')).toBeInTheDocument();
    expect(screen.getByText(/Renovación · 1\/1/)).toBeInTheDocument();
    expect(await screen.findByText('Adenda (PDF)')).toBeInTheDocument();
    expect(screen.queryByText(/prórroga de palabra/)).not.toBeInTheDocument();
  });

  it('con prórroga de palabra marca el fin efectivo', async () => {
    setup({ actualEndDate: '2027-03-31T00:00:00.000Z' }, { followUps: [], periods: [PERIODS[0]] });
    expect(await screen.findByText('Sin seguimiento abierto')).toBeInTheDocument();
    expect(screen.getByText(/prórroga de palabra/)).toBeInTheDocument();
    expect(screen.queryByText('Adenda (PDF)')).not.toBeInTheDocument();
  });

  it('descarga la adenda de una renovación y avisa si falla', async () => {
    const user = userEvent.setup();
    setup();
    downloadFile.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('x'));
    const button = await screen.findByRole('button', { name: 'Adenda (PDF)' });
    await user.click(button);
    expect(downloadFile).toHaveBeenCalledWith('/contracts/c1/periods/2/addendum', 'adenda-renovacion-2.pdf');
    await user.click(button);
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('No se pudo descargar la adenda'));
  });

  it('abre el seguimiento desde el contrato', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole('button', { name: 'Abrir' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText('Checklist')).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Cerrar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('si la carga falla no rompe la tarjeta', async () => {
    setup({}, { loadFails: true });
    expect(await screen.findByText('Sin seguimiento abierto')).toBeInTheDocument();
  });

  it('las acciones son solo de Admin y Gerente y de un contrato activo', async () => {
    auth.role = 'Ventas';
    setup();
    await screen.findByText('Por vencer');
    expect(screen.queryByRole('button', { name: 'Renovar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Prórroga de palabra' })).not.toBeInTheDocument();
  });

  it('un contrato que no está activo no se renueva', async () => {
    setup({ status: 'Rescindido' });
    await screen.findByText('Por vencer');
    expect(screen.queryByRole('button', { name: 'Renovar' })).not.toBeInTheDocument();
  });
});

describe('Prórroga de palabra', () => {
  it('registra la prórroga con la fecha y la nota y recarga el contrato', async () => {
    const user = userEvent.setup();
    const { onChanged } = setup();
    await user.click(await screen.findByRole('button', { name: 'Prórroga de palabra' }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByLabelText(/Sigue hasta/), '2027-03-31');
    await user.type(dialog.getByLabelText(/Qué se acordó/), 'Hablado por teléfono');
    await user.click(dialog.getByRole('button', { name: 'Registrar prórroga' }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][0]).toBe('/contracts/c1/oral-extension');
    expect(JSON.parse(writes()[0][1].body)).toEqual({ until: '2027-03-31', note: 'Hablado por teléfono' });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(toastSuccess).toHaveBeenCalledWith('Prórroga registrada');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('no envía sin fecha ni nota y muestra los errores', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole('button', { name: 'Prórroga de palabra' }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: 'Registrar prórroga' }));
    expect(await dialog.findByText('Elegí una fecha de fin')).toBeInTheDocument();
    expect(dialog.getByText('Anotá qué se acordó')).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it('muestra el error de la API', async () => {
    const user = userEvent.setup();
    setup({}, {
      write: () => {
        throw new ApiRequestError(400, 'EXTENSION_NOT_AFTER_END', 'bad');
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Prórroga de palabra' }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByLabelText(/Sigue hasta/), '2027-03-31');
    await user.type(dialog.getByLabelText(/Qué se acordó/), 'x');
    await user.click(dialog.getByRole('button', { name: 'Registrar prórroga' }));
    expect(await dialog.findByRole('alert')).toBeInTheDocument();
  });
});

describe('Renovar', () => {
  async function openRenew() {
    const user = userEvent.setup();
    const result = setup();
    await user.click(await screen.findByRole('button', { name: 'Renovar' }));
    const dialog = within(await screen.findByRole('dialog'));
    return { user, dialog, ...result };
  }

  it('propone el período siguiente al fin actual y el alquiler de hoy', async () => {
    const { dialog } = await openRenew();
    expect(dialog.getByLabelText(/Empieza/)).toHaveValue('2026-12-16');
    expect(dialog.getByLabelText(/Termina/)).toHaveValue('2028-12-15');
    expect(dialog.getByLabelText(/Alquiler nuevo/)).toHaveValue('150000');
    expect(dialog.getByLabelText('Gabriel Garante')).not.toBeChecked();
  });

  it('renueva con alquiler, regla, garante y honorarios', async () => {
    const { user, dialog, onChanged } = await openRenew();
    const rent = dialog.getByLabelText(/Alquiler nuevo/);
    await user.clear(rent);
    await user.type(rent, '200000');
    await user.selectOptions(dialog.getByLabelText('Regla de ajuste'), 'FixedPercent');
    await user.selectOptions(dialog.getByLabelText('Cada cuánto'), 'Semestral');
    await user.type(dialog.getByLabelText(/Porcentaje por ajuste/), '12');
    await user.click(dialog.getByLabelText('Gabriel Garante'));
    await user.type(dialog.getByLabelText('Honorarios de renovación'), '96000');
    await user.selectOptions(dialog.getByLabelText('Moneda'), 'USD');
    await user.type(dialog.getByLabelText('Notas'), 'Dos años');
    await user.click(dialog.getByRole('button', { name: 'Renovar' }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][0]).toBe('/contracts/c1/renew');
    expect(JSON.parse(writes()[0][1].body)).toEqual({
      start: '2026-12-16',
      end: '2028-12-15',
      rent: '200000',
      adjustment: { adjustmentType: 'FixedPercent', adjustmentPeriod: 'Semestral', customPct: '12' },
      guarantorPersonIds: [GARANTE],
      fee: { amount: '96000', currency: 'USD' },
      notes: 'Dos años',
    });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(toastSuccess).toHaveBeenCalledWith('Renovación registrada');
  });

  it('con la misma regla no manda ajuste y deja desmarcar un garante', async () => {
    const { user, dialog } = await openRenew();
    await user.click(dialog.getByLabelText('Gabriel Garante'));
    await user.click(dialog.getByLabelText('Gabriel Garante'));
    expect(dialog.queryByLabelText('Cada cuánto')).not.toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Renovar' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(JSON.parse(writes()[0][1].body)).toEqual({ start: '2026-12-16', end: '2028-12-15', rent: '150000' });
  });

  it('marca los campos inválidos y no envía', async () => {
    const { user, dialog } = await openRenew();
    const rent = dialog.getByLabelText(/Alquiler nuevo/);
    await user.clear(rent);
    await user.selectOptions(dialog.getByLabelText('Regla de ajuste'), 'FixedPercent');
    await user.click(dialog.getByRole('button', { name: 'Renovar' }));
    expect(await dialog.findByText(/Ingresá un alquiler mayor a cero/)).toBeInTheDocument();
    expect(dialog.getByText('Revisá la regla de ajuste')).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it('cancela sin escribir', async () => {
    const { user, dialog } = await openRenew();
    await user.click(dialog.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(writes()).toHaveLength(0);
  });
});
