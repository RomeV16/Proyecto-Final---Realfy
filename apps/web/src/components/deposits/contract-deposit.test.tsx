// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '../index-data/test-utils';

const { apiClient, auth, toastSuccess, toastError } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  auth: { role: 'Admin' },
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
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
vi.mock('@/lib/download', () => ({ downloadFile: vi.fn().mockResolvedValue(undefined) }));

import { ContractDeposit } from './contract-deposit';

const DEFAULTS = { defaultHeldBy: 'Locador', refundDueDays: 30, deductionsNeedLessorApproval: false };
const LESSORS = [{ personId: 'l1', person: { firstName: 'Luis', lastName: 'Paz' } }];

const DEPOSIT = {
  id: 'd1',
  amount: '100000',
  currency: 'ARS',
  heldBy: 'Inmobiliaria',
  heldByPersonId: 'l1',
  heldByPerson: { id: 'l1', firstName: 'Luis', lastName: 'Paz' },
  installments: 2,
  refundRule: 'PesosActualizado',
  refundInstallments: 1,
  refundDueDays: 30,
  status: 'Parcial',
  refundedAt: null,
  refundedAmount: null,
  notes: null,
  collectedAmount: '50000.00',
  pendingAmount: '50000.00',
  installmentRows: [
    { id: 'i1', number: 1, dueDate: '2026-01-10T00:00:00.000Z', amount: '50000', paidAt: '2026-01-10T00:00:00.000Z' },
    { id: 'i2', number: 2, dueDate: '2026-02-10T00:00:00.000Z', amount: '50000', paidAt: null },
  ],
};

function setup(deposit: unknown, opts: { status?: string; write?: (path: string, init: { method: string; body?: string }) => unknown; fail?: boolean } = {}) {
  apiClient.mockImplementation(async (path: string, init?: { method?: string; body?: string }) => {
    if (init?.method && init.method !== 'GET') return opts.write ? opts.write(path, init as { method: string; body?: string }) : {};
    if (opts.fail) throw new Error('boom');
    if (path.endsWith('/deposit')) return { deposit, defaults: DEFAULTS };
    if (path.endsWith('/move-out')) return { settlement: null };
    return {};
  });
  return renderEs(<ContractDeposit contractId="c1" status={opts.status ?? 'Activo'} rentCurrency="ARS" lessors={LESSORS} />);
}

beforeEach(() => {
  apiClient.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  auth.role = 'Admin';
});

describe('ContractDeposit', () => {
  it('muestra el depósito con el titular, la regla y las cuotas', async () => {
    setup(DEPOSIT);
    expect(await screen.findByText('Depósito en garantía')).toBeInTheDocument();
    expect(screen.getByText('Cobro parcial')).toBeInTheDocument();
    expect(screen.getByText(/La inmobiliaria · Luis Paz/)).toBeInTheDocument();
    expect(screen.getByText(/Pesos actualizados al último alquiler/)).toBeInTheDocument();
    expect(screen.getByText(/hasta 30 días después del egreso, en 1 cuota/)).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Cuotas del depósito' });
    expect(within(list).getByText('Cuota 1 de 2')).toBeInTheDocument();
    expect(within(list).getAllByRole('button', { name: 'Cobrar' })).toHaveLength(1);
  });

  it('sin depósito ofrece cargarlo', async () => {
    setup(null);
    expect(await screen.findByText('Este contrato no tiene un depósito cargado.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cargar el depósito' })).toBeInTheDocument();
  });

  it('cobra una cuota y recarga', async () => {
    const write = vi.fn().mockResolvedValue({});
    setup(DEPOSIT, { write });
    await userEvent.click(await screen.findByRole('button', { name: 'Cobrar' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Cuota cobrada'));
    expect(write).toHaveBeenCalledWith('/contracts/c1/deposit/installments/2/collect', expect.objectContaining({ method: 'POST' }));
  });

  it('avisa si el cobro falla', async () => {
    setup(DEPOSIT, {
      write: () => {
        throw new Error('no');
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Cobrar' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('No se pudo cobrar la cuota'));
  });

  it('guarda un depósito nuevo con la regla propuesta para pesos', async () => {
    const write = vi.fn().mockResolvedValue({});
    setup(null, { write });
    await userEvent.click(await screen.findByRole('button', { name: 'Cargar el depósito' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Importe/), '150000');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Depósito guardado'));
    const [path, init] = write.mock.calls[0];
    expect(path).toBe('/contracts/c1/deposit');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toMatchObject({
      amount: '150000',
      currency: 'ARS',
      heldBy: 'Locador',
      heldByPersonId: 'l1',
      refundRule: 'PesosActualizado',
      refundDueDays: 30,
      installments: 1,
    });
  });

  it('un importe inválido no se envía y pasar a dólares deja la misma moneda', async () => {
    const write = vi.fn().mockResolvedValue({});
    setup(null, { write });
    await userEvent.click(await screen.findByRole('button', { name: 'Cargar el depósito' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await within(dialog).findByText(/Ingresá un importe mayor a cero/)).toBeInTheDocument();
    expect(write).not.toHaveBeenCalled();
    await userEvent.selectOptions(within(dialog).getByLabelText('Moneda'), 'USD');
    const rule = within(dialog).getByLabelText('Regla de devolución') as HTMLSelectElement;
    expect(rule.value).toBe('MismaMoneda');
    expect(within(rule).queryByText('Pesos actualizados al último alquiler')).toBeNull();
  });

  it('con cuotas cobradas bloquea el importe', async () => {
    setup(DEPOSIT);
    await userEvent.click(await screen.findByRole('button', { name: 'Editar el depósito' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Ya hay cuotas cobradas/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Importe/)).toBeDisabled();
  });

  it('muestra el error de guardado de la API', async () => {
    setup(null, {
      write: () => {
        throw new Error('El locador es obligatorio');
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Cargar el depósito' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Importe/), '1000');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
  });

  it('un depósito devuelto no se edita ni se cobra, y muestra lo devuelto', async () => {
    setup({ ...DEPOSIT, status: 'Devuelto', refundedAt: '2026-06-01T00:00:00.000Z', refundedAmount: '80000' });
    expect(await screen.findByText('Devuelto', { selector: 'span' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar el depósito' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cobrar' })).toBeNull();
  });

  it('un rol de solo lectura ve el depósito sin acciones', async () => {
    auth.role = 'Lectura';
    setup(DEPOSIT);
    expect(await screen.findByText('Depósito en garantía')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cobrar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Editar el depósito' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Liquidación de egreso' })).toBeNull();
  });

  it('Ventas no ve la tarjeta', () => {
    auth.role = 'Ventas';
    setup(DEPOSIT);
    expect(screen.queryByText('Depósito en garantía')).toBeNull();
    expect(apiClient).not.toHaveBeenCalled();
  });

  it('Liquidaciones cobra pero no edita', async () => {
    auth.role = 'Liquidaciones';
    setup(DEPOSIT);
    expect(await screen.findByRole('button', { name: 'Cobrar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar el depósito' })).toBeNull();
  });

  it('un error de carga lo avisa', async () => {
    setup(null, { fail: true });
    expect(await screen.findByText('No se pudo cargar el depósito.')).toBeInTheDocument();
  });

  it('la liquidación de egreso solo se ofrece en un contrato activo o vencido', async () => {
    setup(DEPOSIT, { status: 'Rescindido' });
    await screen.findByText('Depósito en garantía');
    expect(screen.queryByRole('button', { name: 'Liquidación de egreso' })).toBeNull();
  });

  it('abre la liquidación de egreso', async () => {
    setup(DEPOSIT);
    await userEvent.click(await screen.findByRole('button', { name: 'Liquidación de egreso' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(await screen.findByLabelText(/Fecha de egreso/)).toBeInTheDocument();
  });
});
