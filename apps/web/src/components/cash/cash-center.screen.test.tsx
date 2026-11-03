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
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u1', role: auth.role } }),
  useOptionalAuth: () => ({ user: { id: 'u1', role: auth.role } }),
}));
vi.mock('@/lib/toast', () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
    info: vi.fn(),
  },
}));
vi.mock('@/lib/download', () => ({ downloadFile: (...a: unknown[]) => downloadFile(...a) }));

import { ApiRequestError } from '@/lib/api-client';
import { CashCenter } from './cash-center';
import CashPage from '@/app/[locale]/(app)/caja/page';

const CAJA = '11111111-1111-4111-8111-111111111111';
const BANCO_USD = '22222222-2222-4222-8222-222222222222';
const CUST_ANA = '33333333-3333-4333-8333-333333333333';
const CUST_BETO = '44444444-4444-4444-8444-444444444444';
const CAJA_EUR = '55555555-5555-4555-8555-555555555555';
const ANA = '66666666-6666-4666-8666-666666666666';
const BETO = '77777777-7777-4777-8777-777777777777';
const CONTRACT = '88888888-8888-4888-8888-888888888888';
const RECEIPT = '99999999-9999-4999-8999-999999999999';

const nb = (s: string | null) => (s ?? '').replaceAll(' ', ' ');

const ACCOUNTS = {
  items: [
    { id: CAJA, kind: 'Caja', name: 'Caja ARS', currency: 'ARS', ownerPersonId: null, isActive: true, owner: null, balance: '150000.00' },
    { id: BANCO_USD, kind: 'Banco', name: 'Banco Dólares', currency: 'USD', ownerPersonId: null, isActive: true, owner: null, balance: '2000.00' },
    {
      id: CUST_ANA,
      kind: 'Custodia',
      name: 'Custodia Ana',
      currency: 'ARS',
      ownerPersonId: ANA,
      isActive: true,
      owner: { id: ANA, firstName: 'Ana', lastName: 'Ejemplo' },
      balance: '46500.00',
    },
    {
      id: CUST_BETO,
      kind: 'Custodia',
      name: 'Custodia Beto',
      currency: 'USD',
      ownerPersonId: BETO,
      isActive: true,
      owner: { id: BETO, firstName: 'Beto', lastName: 'Prueba' },
      balance: '0.00',
    },
    { id: CAJA_EUR, kind: 'Caja', name: 'Caja vieja', currency: 'EUR', ownerPersonId: null, isActive: false, owner: null, balance: '0.00' },
  ],
  totals: [
    { currency: 'ARS', agency: '150000.00', custody: '46500.00', total: '150000.00' },
    { currency: 'USD', agency: '2000.00', custody: '0.00', total: '2000.00' },
  ],
  custodyInAgencyBalance: false,
};

const movement = (id: string, o: Record<string, unknown> = {}) => ({
  id,
  date: '2026-11-01T00:00:00.000Z',
  direction: 'In',
  amount: '100000',
  currency: 'ARS',
  category: 'AlquilerCobrado',
  counterpartyId: null,
  contractId: CONTRACT,
  rate: null,
  sourceType: 'Payment',
  sourceId: 'p-1',
  note: null,
  account: { id: CAJA, name: 'Caja ARS', kind: 'Caja', currency: 'ARS', ownerPersonId: null },
  counterparty: null,
  ...o,
});

const MOVEMENTS = [
  movement('m1'),
  movement('m2', {
    direction: 'Out',
    amount: '5000',
    category: 'PagoProveedor',
    sourceType: 'Manual',
    note: 'Plomero sintético',
    counterpartyId: BETO,
    counterparty: { id: BETO, firstName: 'Beto', lastName: 'Prueba' },
  }),
  movement('m3', { direction: 'Out', category: 'Conversion', sourceType: 'Conversion', rate: '0.0008' }),
];

const RECEIPTS = [
  {
    id: RECEIPT,
    series: 'RECIBO_COBRO',
    number: '00000002',
    issuedAt: '2026-11-01T15:00:00.000Z',
    amount: '60000',
    currency: 'ARS',
    paymentId: 'p-2',
    liquidacionId: 'l-1',
    contractId: CONTRACT,
    period: '2026-11-01T00:00:00.000Z',
    property: 'Depto Sintético',
    tenantName: 'Inquilina Ficticia',
    method: 'Efectivo',
    receivedBy: 'Inmobiliaria',
    inCustody: true,
    receivedByName: 'Usuario Demo',
  },
];

const paged = (items: unknown[], o: Record<string, unknown> = {}) => ({ items, total: items.length, page: 1, limit: 50, totalPages: 1, ...o });

interface Setup {
  write?: (path: string, init: { method: string; body: string }) => unknown;
  failAccounts?: boolean;
  failMovements?: boolean;
  failReceipts?: boolean;
  movementPages?: number;
}

function setup({ write, failAccounts, failMovements, failReceipts, movementPages = 1 }: Setup = {}) {
  apiClient.mockImplementation(async (path: string, init?: { method?: string; body: string }) => {
    if (init?.method) return write ? write(path, init as { method: string; body: string }) : {};
    if (path.startsWith('/financial-accounts')) {
      if (failAccounts) throw new ApiRequestError(500, 'INTERNAL_ERROR', 'boom');
      return ACCOUNTS;
    }
    if (path.startsWith('/cash-movements?')) {
      if (failMovements) throw new ApiRequestError(500, 'INTERNAL_ERROR', 'boom');
      return paged(MOVEMENTS, { totalPages: movementPages, total: movementPages * 50 });
    }
    if (path.startsWith('/receipts?')) {
      if (failReceipts) throw new ApiRequestError(500, 'INTERNAL_ERROR', 'boom');
      return paged(RECEIPTS);
    }
    if (path.startsWith('/contracts?')) {
      return { items: [{ id: CONTRACT, startDate: '2026-01-01T00:00:00.000Z', property: { title: 'Depto Sintético' } }] };
    }
    if (path.startsWith('/persons?search=')) return { items: [{ id: ANA, firstName: 'Ana', lastName: 'Ejemplo', dni: '30111222' }] };
    if (path.startsWith('/outbox?')) return paged([]);
    throw new Error(`unexpected ${path}`);
  });
  return renderEs(<CashCenter />);
}

const writes = () => apiClient.mock.calls.filter(([, init]) => init?.method);
const bodyOf = (i: number) => JSON.parse(writes()[i][1].body);

async function openTab(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('tab', { name }));
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = 'Admin';
});

describe('Caja: cuentas', () => {
  it('muestra los totales por moneda, las cuentas con su clase y saldo, y explica la custodia', async () => {
    setup();
    expect((await screen.findAllByText('Caja ARS')).length).toBeGreaterThan(0);
    expect(apiClient).toHaveBeenCalledWith('/financial-accounts?includeInactive=true');
    const ars = screen.getByLabelText('Totales en ARS');
    expect(nb(ars.textContent)).toContain('$ 150.000,00');
    expect(nb(ars.textContent)).toContain('En custodia');
    expect(nb(ars.textContent)).toContain('$ 46.500,00');
    expect(screen.getByText(/se muestra aparte/)).toBeInTheDocument();
    expect(screen.getAllByText('Banco').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ana Ejemplo').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Dada de baja').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Nueva cuenta' }).length).toBeGreaterThan(0);
  });

  it('con la custodia sumada al total lo aclara', async () => {
    const original = ACCOUNTS.custodyInAgencyBalance;
    ACCOUNTS.custodyInAgencyBalance = true;
    try {
      setup();
      expect(await screen.findByText(/incluye el efectivo en custodia/)).toBeInTheDocument();
    } finally {
      ACCOUNTS.custodyInAgencyBalance = original;
    }
  });

  it('Liquidaciones y Lectura ven las cuentas pero no las administran', async () => {
    auth.role = 'Lectura';
    setup();
    expect((await screen.findAllByText('Caja ARS')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Nueva cuenta' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Renombrar' })).not.toBeInTheDocument();
  });

  it('un rol sin acceso no ve la caja ni consulta nada', () => {
    auth.role = 'Ventas';
    setup();
    expect(screen.getByText('No tenés permiso para ver la caja.')).toBeInTheDocument();
    expect(apiClient).not.toHaveBeenCalled();
  });

  it('la ruta /caja muestra la pantalla de caja', async () => {
    setup();
    renderEs(<CashPage />);
    expect((await screen.findAllByRole('heading', { name: 'Caja' })).length).toBeGreaterThan(0);
  });

  it('un error al cargar las cuentas se muestra', async () => {
    setup({ failAccounts: true });
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
  });

  it('da de alta una cuenta de banco en euros', async () => {
    setup({ write: () => ({ id: 'new' }) });
    const user = userEvent.setup();
    await screen.findAllByText('Caja ARS');
    await user.click(screen.getByRole('button', { name: 'Nueva cuenta' }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Clase'), 'Banco');
    expect(within(dialog).getByText('Una cuenta bancaria de la inmobiliaria.')).toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText('Moneda'), 'EUR');
    expect(within(dialog).getByRole('option', { name: '€ (Euro)' })).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/Nombre/), 'Banco Euros');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][0]).toBe('/financial-accounts');
    expect(bodyOf(0)).toEqual({ kind: 'Banco', name: 'Banco Euros', currency: 'EUR', ownerPersonId: null });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Cuenta creada'));
  });

  it('una cuenta de custodia pide el locador y lo busca por nombre', async () => {
    setup({ write: () => ({ id: 'new' }) });
    const user = userEvent.setup();
    await screen.findAllByText('Caja ARS');
    await user.click(screen.getByRole('button', { name: 'Nueva cuenta' }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Clase'), 'Custodia');
    await user.type(within(dialog).getByLabelText(/Nombre/), 'Custodia Ana');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await within(dialog).findByText('Una cuenta de custodia necesita el locador dueño del dinero')).toBeInTheDocument();
    expect(writes()).toHaveLength(0);

    await user.type(within(dialog).getByLabelText('Locador dueño del dinero'), 'An');
    await user.click(await within(dialog).findByRole('button', { name: /Ana Ejemplo/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(bodyOf(0)).toEqual({ kind: 'Custodia', name: 'Custodia Ana', currency: 'ARS', ownerPersonId: ANA });
  });

  it('renombra una cuenta y valida el nombre', async () => {
    setup({ write: () => ({}) });
    const user = userEvent.setup();
    await screen.findAllByText('Caja ARS');
    await user.click(screen.getAllByRole('button', { name: 'Renombrar' })[0]);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Renombrar la cuenta')).toBeInTheDocument();
    const name = within(dialog).getByLabelText(/Nombre/);
    await user.clear(name);
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await within(dialog).findByText('Escribí un nombre (hasta 120 caracteres)')).toBeInTheDocument();
    await user.type(name, 'Caja oficina');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual([`/financial-accounts/${CAJA}`, expect.objectContaining({ method: 'PATCH' })]);
    expect(bodyOf(0)).toEqual({ name: 'Caja oficina' });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Cuenta renombrada'));
  });

  it('dar de baja pide confirmación y una cuenta con saldo avisa por qué no se puede', async () => {
    setup({
      write: () => {
        throw new ApiRequestError(409, 'ACCOUNT_HAS_BALANCE', 'Account has balance');
      },
    });
    const user = userEvent.setup();
    await screen.findAllByText('Caja ARS');
    await user.click(screen.getAllByRole('button', { name: 'Dar de baja' })[0]);
    const confirm = await screen.findByRole('dialog');
    expect(within(confirm).getByText('¿Dar de baja la cuenta?')).toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: 'Dar de baja' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(bodyOf(0)).toEqual({ isActive: false });
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('La cuenta tiene saldo: vaciala antes de darla de baja.'));
  });

  it('cancelar la baja no manda nada; reactivar no pide confirmación', async () => {
    setup({ write: () => ({}) });
    const user = userEvent.setup();
    await screen.findAllByText('Caja ARS');
    await user.click(screen.getAllByRole('button', { name: 'Dar de baja' })[0]);
    const confirm = await screen.findByRole('dialog');
    await user.click(within(confirm).getByRole('button', { name: 'Cancelar' }));
    expect(writes()).toHaveLength(0);

    await user.click(screen.getAllByRole('button', { name: 'Reactivar' })[0]);
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][0]).toBe(`/financial-accounts/${CAJA_EUR}`);
    expect(bodyOf(0)).toEqual({ isActive: true });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Cuenta reactivada'));
  });

  it('un error que no es de la API usa el aviso genérico', async () => {
    setup({
      write: () => {
        throw new Error('red caída');
      },
    });
    const user = userEvent.setup();
    await screen.findAllByText('Caja ARS');
    await user.click(screen.getAllByRole('button', { name: 'Reactivar' })[0]);
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('No se pudo completar la acción'));
  });
});

describe('Caja: movimientos', () => {
  it('lista el libro con categoría, sentido, importe con signo, persona y origen', async () => {
    setup();
    const user = userEvent.setup();
    await screen.findAllByText('Caja ARS');
    await openTab(user, 'Movimientos');
    expect((await screen.findAllByText('Plomero sintético')).length).toBeGreaterThan(0);
    expect(apiClient).toHaveBeenCalledWith('/cash-movements?page=1&limit=50');
    expect(screen.getAllByText('Alquiler cobrado').length).toBeGreaterThan(1);
    expect(screen.getAllByText('Pago a proveedor').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Entrada').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Salida').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Beto Prueba').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Plomero sintético').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Cobro de una liquidación').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Conversión de moneda · cambio 0.0008').length).toBeGreaterThan(0);
    expect(nb(document.body.textContent)).toContain('-$ 5.000,00');
  });

  it('los filtros y la página se mandan a la API', async () => {
    setup({ movementPages: 2 });
    const user = userEvent.setup();
    await screen.findAllByText('Caja ARS');
    await openTab(user, 'Movimientos');
    await screen.findAllByText('Plomero sintético');
    await waitFor(() => expect(screen.getByRole('option', { name: /Depto Sintético · 2026-01/ })).toBeInTheDocument());

    await user.click(screen.getAllByRole('button', { name: 'Siguiente' })[0]);
    await waitFor(() => expect(apiClient).toHaveBeenCalledWith('/cash-movements?page=2&limit=50'));

    await user.selectOptions(screen.getByLabelText('Cuenta'), CAJA);
    await waitFor(() => expect(apiClient).toHaveBeenCalledWith(`/cash-movements?page=1&limit=50&accountId=${CAJA}`));
    await user.selectOptions(screen.getByLabelText('Categoría'), 'Gasto');
    await user.selectOptions(screen.getByLabelText('Contrato'), CONTRACT);
    await user.type(screen.getByLabelText('Desde'), '2026-11-01');
    await user.type(screen.getByLabelText('Hasta'), '2026-11-30');
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith(
        `/cash-movements?page=1&limit=50&accountId=${CAJA}&category=Gasto&contractId=${CONTRACT}&from=2026-11-01&to=2026-11-30`,
      ),
    );
  });

  it('un error del libro se muestra', async () => {
    setup({ failMovements: true });
    const user = userEvent.setup();
    await screen.findAllByText('Caja ARS');
    await openTab(user, 'Movimientos');
    expect(await screen.findByText(/problema/i)).toBeInTheDocument();
  });

  it('carga un movimiento manual: la categoría propone el sentido', async () => {
    auth.role = 'Liquidaciones';
    setup({ write: () => ({ id: 'mv' }) });
    const user = userEvent.setup();
    await screen.findAllByText('Caja ARS');
    await openTab(user, 'Movimientos');
    await user.click(screen.getByRole('button', { name: 'Cargar movimiento' }));
    const dialog = await screen.findByRole('dialog');

    // Solo las cuentas activas de la inmobiliaria (sin custodia ni dadas de baja).
    const account = within(dialog).getByLabelText(/^Cuenta/);
    expect(within(account).getAllByRole('option').map((o) => o.textContent)).toEqual(['Caja ARS (ARS)', 'Banco Dólares (USD)']);
    // Solo las categorías manuales.
    expect(within(dialog).queryByRole('option', { name: 'Alquiler cobrado' })).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Sentido/)).toHaveValue('Out');
    await user.selectOptions(within(dialog).getByLabelText(/^Categoría/), 'Honorario');
    expect(within(dialog).getByLabelText(/^Sentido/)).toHaveValue('In');

    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await within(dialog).findByText(/Ingresá un importe mayor a cero/)).toBeInTheDocument();
    expect(writes()).toHaveLength(0);

    await user.type(within(dialog).getByLabelText(/^Importe/), '15000,50');
    await user.type(within(dialog).getByLabelText('Persona (opcional)'), 'An');
    await user.click(await within(dialog).findByRole('button', { name: /Ana Ejemplo/ }));
    await waitFor(() => expect(within(dialog).getByRole('option', { name: /Depto Sintético/ })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByLabelText(/^Contrato/), CONTRACT);
    await user.type(within(dialog).getByLabelText('Nota'), 'Honorario de gestión');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][0]).toBe('/cash-movements');
    expect(bodyOf(0)).toEqual({
      accountId: CAJA,
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      direction: 'In',
      amount: '15000.50',
      category: 'Honorario',
      counterpartyId: ANA,
      contractId: CONTRACT,
      note: 'Honorario de gestión',
    });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Movimiento cargado'));
  });

  it('un error de la API queda en el formulario del movimiento', async () => {
    setup({
      write: () => {
        throw new ApiRequestError(409, 'ACCOUNT_INACTIVE', 'Account inactive');
      },
    });
    const user = userEvent.setup();
    await screen.findAllByText('Caja ARS');
    await openTab(user, 'Movimientos');
    await user.click(screen.getByRole('button', { name: 'Cargar movimiento' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Importe/), '10');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await within(dialog).findByText('La cuenta está dada de baja.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('una conversión ofrece cuentas de otra moneda y muestra cuánto entra', async () => {
    setup({ write: () => ({}) });
    const user = userEvent.setup();
    await screen.findAllByText('Caja ARS');
    await openTab(user, 'Movimientos');
    await user.click(screen.getByRole('button', { name: 'Conversión de moneda' }));
    const dialog = await screen.findByRole('dialog');

    const to = within(dialog).getByLabelText(/^Entra en/);
    expect(within(to).getAllByRole('option').map((o) => o.textContent)).toEqual(['Elegí una cuenta', 'Banco Dólares (USD)']);
    expect(within(dialog).getByText(/Elegí la cuenta de destino, el importe y el tipo de cambio/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await within(dialog).findByText('Elegí una cuenta de destino de otra moneda')).toBeInTheDocument();

    await user.selectOptions(to, BANCO_USD);
    await user.type(within(dialog).getByLabelText(/^Importe que sale ARS/), '120000');
    await user.type(within(dialog).getByLabelText(/^Tipo de cambio/), '0,0008');
    expect(nb(within(dialog).getByText(/^Entran/).textContent)).toContain('US$ 96,00');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][0]).toBe('/cash-movements/conversion');
    expect(bodyOf(0)).toMatchObject({ fromAccountId: CAJA, toAccountId: BANCO_USD, amount: '120000', rate: '0.0008', note: null });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Conversión registrada'));

    // Cambiar el origen limpia el destino.
    await user.click(screen.getByRole('button', { name: 'Conversión de moneda' }));
    const again = await screen.findByRole('dialog');
    await user.selectOptions(within(again).getByLabelText(/^Entra en/), BANCO_USD);
    await user.selectOptions(within(again).getByLabelText(/^Sale de/), BANCO_USD);
    expect(within(again).getByLabelText(/^Entra en/)).toHaveValue('');
  });

  it('Lectura ve el libro pero no carga movimientos', async () => {
    auth.role = 'Lectura';
    setup();
    const user = userEvent.setup();
    await screen.findAllByText('Caja ARS');
    await openTab(user, 'Movimientos');
    await screen.findAllByText('Plomero sintético');
    expect(screen.queryByRole('button', { name: 'Cargar movimiento' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Conversión de moneda' })).not.toBeInTheDocument();
  });
});

describe('Caja: custodia', () => {
  it('lista las custodias y entrega una parte', async () => {
    setup({ write: () => ({ movement: { id: 'mv' }, balance: '45500.00' }) });
    const user = userEvent.setup();
    await screen.findAllByText('Caja ARS');
    await openTab(user, 'Custodia');
    expect(screen.getAllByText('Ana Ejemplo').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Beto Prueba').length).toBeGreaterThan(0);
    // Sin saldo no hay nada para entregar.
    const buttons = screen.getAllByRole('button', { name: 'Entregar' });
    expect(buttons.some((b) => b.hasAttribute('disabled'))).toBe(true);

    await user.click(buttons.find((b) => !b.hasAttribute('disabled'))!);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Entregar a Ana Ejemplo')).toBeInTheDocument();
    const amount = within(dialog).getByLabelText(/Importe a entregar/);
    expect(amount).toHaveValue('46500.00');
    await user.clear(amount);
    await user.type(amount, '1000');
    await user.click(within(dialog).getByRole('button', { name: 'Registrar entrega' }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][0]).toBe(`/custody/${CUST_ANA}/deliver`);
    expect(bodyOf(0)).toEqual({ amount: '1000', date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), note: null });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining('45.500,00')));
  });

  it('vaciar el importe entrega todo; si no alcanza lo avisa en el diálogo', async () => {
    setup({
      write: () => {
        throw new ApiRequestError(409, 'CUSTODY_INSUFFICIENT', 'Not enough');
      },
    });
    const user = userEvent.setup();
    await screen.findAllByText('Caja ARS');
    await openTab(user, 'Custodia');
    await user.click(screen.getAllByRole('button', { name: 'Entregar' }).find((b) => !b.hasAttribute('disabled'))!);
    const dialog = await screen.findByRole('dialog');
    await user.clear(within(dialog).getByLabelText(/Importe a entregar/));
    await user.click(within(dialog).getByRole('button', { name: 'Registrar entrega' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(bodyOf(0)).not.toHaveProperty('amount');
    expect(await within(dialog).findByText('El importe supera el efectivo en custodia.')).toBeInTheDocument();
  });

  it('un importe inválido se marca y no se manda', async () => {
    setup();
    const user = userEvent.setup();
    await screen.findAllByText('Caja ARS');
    await openTab(user, 'Custodia');
    await user.click(screen.getAllByRole('button', { name: 'Entregar' }).find((b) => !b.hasAttribute('disabled'))!);
    const dialog = await screen.findByRole('dialog');
    const amount = within(dialog).getByLabelText(/Importe a entregar/);
    await user.clear(amount);
    await user.type(amount, 'mucho');
    await user.click(within(dialog).getByRole('button', { name: 'Registrar entrega' }));
    expect(await within(dialog).findByText(/Ingresá un importe mayor a cero/)).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it('Lectura ve la custodia sin la acción de entregar', async () => {
    auth.role = 'Lectura';
    setup();
    const user = userEvent.setup();
    await screen.findAllByText('Caja ARS');
    await openTab(user, 'Custodia');
    expect(screen.getAllByText('Ana Ejemplo').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Entregar' })).not.toBeInTheDocument();
  });
});

describe('Caja: recibos', () => {
  it('lista los recibos, filtra por fecha e imprime el PDF', async () => {
    downloadFile.mockResolvedValue(undefined);
    setup();
    const user = userEvent.setup();
    await screen.findAllByText('Caja ARS');
    await openTab(user, 'Recibos');
    expect((await screen.findAllByText('00000002')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Inquilina Ficticia').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Depto Sintético').length).toBeGreaterThan(0);
    expect(screen.getAllByText('(Usuario Demo)').length).toBeGreaterThan(0);
    expect(screen.getAllByText('En custodia').length).toBeGreaterThan(0);
    expect(apiClient).toHaveBeenCalledWith('/receipts?page=1&limit=50');

    await user.type(screen.getByLabelText('Desde'), '2026-11-01');
    await user.type(screen.getByLabelText('Hasta'), '2026-11-30');
    await waitFor(() => expect(apiClient).toHaveBeenCalledWith('/receipts?page=1&limit=50&from=2026-11-01&to=2026-11-30'));

    await user.click(screen.getAllByRole('button', { name: 'Imprimir' })[0]);
    expect(downloadFile).toHaveBeenCalledWith(`/receipts/${RECEIPT}/pdf`, 'recibo-00000002.pdf');
  });

  it('un error de la lista de recibos se muestra', async () => {
    setup({ failReceipts: true });
    const user = userEvent.setup();
    await screen.findAllByText('Caja ARS');
    await openTab(user, 'Recibos');
    expect(await screen.findByText(/problema/i)).toBeInTheDocument();
  });

  it('si el PDF no se descarga lo avisa', async () => {
    downloadFile.mockRejectedValue(new Error('offline'));
    setup();
    const user = userEvent.setup();
    await screen.findAllByText('Caja ARS');
    await openTab(user, 'Recibos');
    await screen.findAllByText('00000002');
    await user.click(screen.getAllByRole('button', { name: 'Imprimir' })[0]);
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('No se pudo descargar el archivo. Intentá de nuevo.'));
  });

  it('cada recibo se puede mandar a quien pagó desde su diálogo de envío', async () => {
    setup();
    const user = userEvent.setup();
    await screen.findAllByText('Caja ARS');
    await openTab(user, 'Recibos');
    await screen.findAllByText('00000002');
    await user.click(screen.getAllByRole('button', { name: 'Enviar' })[0]);
    const dialog = within(screen.getAllByRole('dialog').at(-1)!);
    expect(dialog.getByRole('heading', { name: 'Enviar el recibo' })).toBeInTheDocument();
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith(`/outbox?relatedType=Receipt&relatedId=${RECEIPT}&page=1&limit=20`),
    );
    await user.click(dialog.getByRole('button', { name: 'Enviar por mail' }));
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith('/outbox/send', {
        method: 'POST',
        body: JSON.stringify({ kind: 'Receipt', id: RECEIPT, channel: 'Email' }),
      }),
    );
  });

  it('Lectura ve los recibos pero no el botón de envío', async () => {
    auth.role = 'Lectura';
    setup();
    const user = userEvent.setup();
    await screen.findAllByText('Caja ARS');
    await openTab(user, 'Recibos');
    await screen.findAllByText('00000002');
    expect(screen.queryByRole('button', { name: 'Enviar' })).not.toBeInTheDocument();
  });
});
