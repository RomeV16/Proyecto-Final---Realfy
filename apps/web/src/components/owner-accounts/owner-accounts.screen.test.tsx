// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '../index-data/test-utils';

const { apiClient, auth, toastSuccess, search } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  auth: { role: 'Admin' },
  toastSuccess: vi.fn(),
  search: { currency: 'USD' as string | null },
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
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn(), info: vi.fn() },
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useParams: () => ({ personId: ANA }),
  useSearchParams: () => new URLSearchParams(search.currency ? { currency: search.currency } : {}),
  usePathname: () => '/es/locadores',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

import { ApiRequestError } from '@/lib/api-client';
import { OwnerBalances } from './owner-balances';
import { OwnerLedger } from './owner-ledger';
import OwnersPage from '@/app/[locale]/(app)/locadores/page';
import OwnerLedgerPage from '@/app/[locale]/(app)/locadores/[personId]/page';

const ANA = '66666666-6666-4666-8666-666666666666';
const BETO = '77777777-7777-4777-8777-777777777777';
const CAJA = '11111111-1111-4111-8111-111111111111';
const CUSTODY = '33333333-3333-4333-8333-333333333333';
const nb = (s: string | null) => (s ?? '').replaceAll('\u00a0', ' ');

const BALANCES = [
  {
    personId: ANA,
    name: 'Ana Locadora',
    currency: 'ARS',
    balance: '46500.00',
    custody: '500.00',
    payoutDue: '46000.00',
    lastMovement: '2026-10-08T00:00:00.000Z',
    lastStatement: { id: 'st-1', period: '2026-09-01T00:00:00.000Z', closing: '0.00', status: 'Emitido' },
  },
  { personId: BETO, name: 'Beto Dueño', currency: 'USD', balance: '-300.00', custody: '0.00', payoutDue: '0.00', lastMovement: null, lastStatement: null },
];

const entry = (id: string, o: Record<string, unknown> = {}) => ({
  id,
  date: '2026-10-08T00:00:00.000Z',
  period: '2026-10-01T00:00:00.000Z',
  type: 'Alquiler',
  amount: '50000.00',
  balance: '50000.00',
  description: 'Alquiler octubre de 2026',
  contractId: 'c1',
  propertyId: 'p1',
  property: 'Belgrano 100',
  sourceType: 'Payment',
  sourceId: 'pay-1',
  statement: null,
  ...o,
});

const LEDGER = {
  person: { id: ANA, name: 'Ana Locadora' },
  currency: 'ARS',
  currencies: ['ARS', 'USD'],
  opening: '0.00',
  closing: '46500.00',
  custody: '500.00',
  items: [
    entry('e1'),
    entry('e2', { type: 'Comision', amount: '-3500.00', balance: '46500.00', description: 'Comisión octubre de 2026', statement: { id: 'st-2', period: '2026-10-01', status: 'Emitido' } }),
  ],
  total: 2,
  page: 1,
  limit: 50,
  totalPages: 1,
};

const ACCOUNTS = {
  items: [
    { id: CAJA, kind: 'Caja', name: 'Caja ARS', currency: 'ARS', ownerPersonId: null, isActive: true, balance: '100000.00' },
    { id: CUSTODY, kind: 'Custodia', name: 'Custodia Ana', currency: 'ARS', ownerPersonId: ANA, isActive: true, balance: '500.00' },
  ],
  totals: [],
  custodyInAgencyBalance: false,
};

interface Setup {
  write?: (path: string, init: { method: string; body?: string }) => unknown;
  failBalances?: boolean;
  ledgerPages?: number;
}

function mockApi({ write, failBalances, ledgerPages = 1 }: Setup = {}) {
  apiClient.mockImplementation(async (path: string, init?: { method?: string; body?: string }) => {
    if (init?.method) return write ? write(path, init as { method: string; body?: string }) : {};
    if (path === '/tenants/me/read-access') return { role: auth.role, resources: { renditions: true } };
    if (path.startsWith('/owners/balances')) {
      if (failBalances) throw new ApiRequestError(500, 'INTERNAL_ERROR', 'boom');
      const currency = new URLSearchParams(path.split('?')[1] ?? '').get('currency');
      return { items: BALANCES.filter((b) => !currency || b.currency === currency) };
    }
    if (path.startsWith(`/owners/${ANA}/ledger`)) {
      const currency = new URLSearchParams(path.split('?')[1]).get('currency');
      return { ...LEDGER, currency, totalPages: ledgerPages, total: ledgerPages * 50 };
    }
    if (path.startsWith('/financial-accounts')) return ACCOUNTS;
    throw new Error(`unexpected ${path}`);
  });
}

const writes = () => apiClient.mock.calls.filter(([, init]) => init?.method);
const bodyOf = (i: number) => JSON.parse(writes()[i][1].body);

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = 'Admin';
  search.currency = 'USD';
});

describe('Locadores: saldos', () => {
  it('lista cada locador con su saldo leído, custodia, lo que falta pagar y el último estado (CP-471)', async () => {
    mockApi();
    renderEs(<OwnerBalances />);
    const link = (await screen.findAllByRole('link', { name: 'Ana Locadora' }))[0];
    expect(link).toHaveAttribute('href', `/es/locadores/${ANA}?currency=ARS`);
    const text = nb(document.body.textContent);
    expect(text).toContain('$ 46.500,00');
    expect(text).toContain('La inmobiliaria le debe');
    expect(text).toContain('Le debe a la inmobiliaria');
    expect(text).toContain('$ 46.000,00');
    expect(text).toContain('Sin estados emitidos');
    expect(screen.getAllByText('Emitido').length).toBeGreaterThan(0);
    expect(apiClient).toHaveBeenCalledWith('/owners/balances');
  });

  it('filtra por moneda', async () => {
    mockApi();
    const user = userEvent.setup();
    renderEs(<OwnerBalances />);
    await screen.findAllByText('Ana Locadora');
    await user.selectOptions(screen.getByLabelText('Moneda'), 'USD');
    await waitFor(() => expect(apiClient).toHaveBeenCalledWith('/owners/balances?currency=USD'));
    await waitFor(() => expect(screen.queryAllByText('Ana Locadora')).toHaveLength(0));
    expect(screen.getAllByText('Beto Dueño').length).toBeGreaterThan(0);
  });

  it('muestra el error de la API y un rol sin acceso no consulta nada', async () => {
    mockApi({ failBalances: true });
    renderEs(<OwnerBalances />);
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);

    vi.clearAllMocks();
    auth.role = 'Ventas';
    renderEs(<OwnerBalances />);
    expect(screen.getByText('No tenés permiso para ver la cuenta corriente de los locadores.')).toBeInTheDocument();
    expect(apiClient).not.toHaveBeenCalled();
  });

  it('la ruta /locadores muestra la pantalla', async () => {
    mockApi();
    renderEs(<OwnersPage />);
    expect(await screen.findByRole('heading', { name: 'Locadores' })).toBeInTheDocument();
  });
});

describe('Locadores: cuenta corriente', () => {
  it('movimientos con saldo corrido, resumen, pestañas por moneda y enlace al estado (CP-472)', async () => {
    mockApi();
    const user = userEvent.setup();
    renderEs(<OwnerLedger personId={ANA} />);
    expect(await screen.findByRole('heading', { name: 'Cuenta corriente de Ana Locadora' })).toBeInTheDocument();
    expect(apiClient).toHaveBeenCalledWith(`/owners/${ANA}/ledger?currency=ARS&page=1&limit=50`);
    const summary = screen.getByLabelText('Resumen en ARS');
    expect(nb(summary.textContent)).toContain('$ 46.500,00');
    expect(nb(summary.textContent)).toContain('$ 500,00');
    expect((await screen.findAllByText('Comisión')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Belgrano 100').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Sin emitir').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link').some((a) => a.getAttribute('href') === '/es/estados-de-cuenta/st-2')).toBe(true);

    await user.click(screen.getByRole('tab', { name: 'USD' }));
    await waitFor(() => expect(apiClient).toHaveBeenCalledWith(`/owners/${ANA}/ledger?currency=USD&page=1&limit=50`));
    await user.type(screen.getByLabelText('Desde'), '2026-10-01');
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith(`/owners/${ANA}/ledger?currency=USD&page=1&limit=50&from=2026-10-01`),
    );
    expect(nb(screen.getByLabelText('Resumen en USD').textContent)).toContain('Saldo al 01/10/2026');
  });

  it('pagina los movimientos', async () => {
    mockApi({ ledgerPages: 2 });
    const user = userEvent.setup();
    renderEs(<OwnerLedger personId={ANA} />);
    await screen.findByRole('heading', { name: 'Cuenta corriente de Ana Locadora' });
    await user.click(screen.getAllByRole('button', { name: /Siguiente/ })[0]);
    await waitFor(() => expect(apiClient).toHaveBeenCalledWith(`/owners/${ANA}/ledger?currency=ARS&page=2&limit=50`));
  });

  it('saldo inicial: valida, confirma con importe y motivo, y guarda (CP-473)', async () => {
    mockApi({ write: () => ({ id: 'e9', amount: '-1500.50' }) });
    const user = userEvent.setup();
    renderEs(<OwnerLedger personId={ANA} />);
    await screen.findByRole('heading', { name: 'Cuenta corriente de Ana Locadora' });
    await user.click(screen.getByRole('button', { name: 'Saldo inicial' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar saldo inicial' }));
    expect(await within(dialog).findByText('Ingresá un importe válido, con hasta 2 decimales.')).toBeInTheDocument();
    expect(within(dialog).getByText('Contá el motivo (al menos 3 letras).')).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(/Importe/), '-1500,50');
    await user.type(within(dialog).getByLabelText(/Motivo/), 'último acumulador');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar saldo inicial' }));
    // Cancelar la confirmación no guarda.
    await screen.findByText(/El saldo inicial de Ana Locadora queda en/);
    await user.click(screen.getAllByRole('button', { name: 'Cancelar' }).at(-1)!);
    await waitFor(() => expect(screen.queryByText(/El saldo inicial de Ana Locadora queda en/)).not.toBeInTheDocument());
    expect(writes()).toHaveLength(0);

    await user.click(within(dialog).getByRole('button', { name: 'Guardar saldo inicial' }));
    expect(await screen.findByText(/El saldo inicial de Ana Locadora queda en/)).toBeInTheDocument();
    expect(screen.getByText('Motivo: último acumulador')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sí, guardar' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][0]).toBe(`/owners/${ANA}/opening-balance`);
    expect(bodyOf(0)).toEqual({ currency: 'ARS', amount: '-1500.50', reason: 'último acumulador' });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Saldo inicial guardado.'));
  });

  it('saldo inicial ya emitido: explica que hay que anular el estado', async () => {
    mockApi({
      write: () => {
        throw new ApiRequestError(409, 'OPENING_BALANCE_LOCKED', 'locked');
      },
    });
    const user = userEvent.setup();
    renderEs(<OwnerLedger personId={ANA} />);
    await screen.findByRole('heading', { name: 'Cuenta corriente de Ana Locadora' });
    await user.click(screen.getByRole('button', { name: 'Saldo inicial' }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(/Moneda/), 'USD');
    await user.type(within(dialog).getByLabelText(/Importe/), '0');
    await user.type(within(dialog).getByLabelText(/^Fecha/), '2026-10-31');
    await user.type(within(dialog).getByLabelText(/Motivo/), 'corrección');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar saldo inicial' }));
    await user.click(await screen.findByRole('button', { name: 'Sí, guardar' }));
    expect(await within(dialog).findByText(/ya está en un estado de cuenta emitido/)).toBeInTheDocument();
    expect(bodyOf(0)).toEqual({ currency: 'USD', amount: '0', date: '2026-10-31', reason: 'corrección' });
  });

  it('pago al locador: propone lo pendiente fuera de custodia, ofrece solo cuentas de la moneda y registra (CP-474)', async () => {
    mockApi({ write: () => ({ balance: '500.00' }) });
    const user = userEvent.setup();
    renderEs(<OwnerLedger personId={ANA} />);
    await screen.findByRole('heading', { name: 'Cuenta corriente de Ana Locadora' });
    await user.click(screen.getByRole('button', { name: 'Registrar pago al locador' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/Importe/)).toHaveValue('46000.00');
    const account = within(dialog).getByLabelText(/Cuenta/);
    await waitFor(() => expect(within(account).getAllByRole('option')).toHaveLength(2));
    expect(within(account).queryByRole('option', { name: 'Custodia Ana' })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Registrar pago' }));
    expect(await within(dialog).findByText('Elegí la cuenta de donde sale el dinero.')).toBeInTheDocument();

    await user.selectOptions(account, CAJA);
    await user.selectOptions(within(dialog).getByLabelText(/Forma de pago/), 'EntregaEfectivo');
    await user.type(within(dialog).getByLabelText(/Nota/), 'adelanto');
    await user.click(within(dialog).getByRole('button', { name: 'Registrar pago' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][0]).toBe(`/owners/${ANA}/payouts`);
    expect(bodyOf(0)).toMatchObject({ accountId: CAJA, method: 'EntregaEfectivo', amount: '46000.00', note: 'adelanto' });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining('Pago registrado')));
  });

  it('pago al locador: muestra el error de la API', async () => {
    mockApi({
      write: () => {
        throw new ApiRequestError(400, 'CUSTODY_ACCOUNT_RESERVED', 'reserved');
      },
    });
    const user = userEvent.setup();
    renderEs(<OwnerLedger personId={ANA} />);
    await screen.findByRole('heading', { name: 'Cuenta corriente de Ana Locadora' });
    await user.click(screen.getByRole('button', { name: 'Registrar pago al locador' }));
    const dialog = await screen.findByRole('dialog');
    const account = within(dialog).getByLabelText(/Cuenta/);
    await waitFor(() => expect(within(account).getAllByRole('option')).toHaveLength(2));
    await user.selectOptions(account, CAJA);
    await user.click(within(dialog).getByRole('button', { name: 'Registrar pago' }));
    expect((await within(dialog).findAllByRole('alert')).length).toBeGreaterThan(0);
  });

  it('Liquidaciones paga pero no carga saldo inicial; Lectura solo mira', async () => {
    auth.role = 'Liquidaciones';
    mockApi();
    renderEs(<OwnerLedger personId={ANA} />);
    await screen.findByRole('heading', { name: 'Cuenta corriente de Ana Locadora' });
    expect(screen.getByRole('button', { name: 'Registrar pago al locador' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Saldo inicial' })).not.toBeInTheDocument();
  });

  it('Lectura no ve acciones; un rol sin acceso no consulta', async () => {
    auth.role = 'Lectura';
    mockApi();
    renderEs(<OwnerLedger personId={ANA} />);
    await screen.findByRole('heading', { name: 'Cuenta corriente de Ana Locadora' });
    expect(screen.queryByRole('button', { name: 'Registrar pago al locador' })).not.toBeInTheDocument();

    vi.clearAllMocks();
    auth.role = 'Soporte';
    renderEs(<OwnerLedger personId={ANA} />);
    expect(screen.getAllByText('No tenés permiso para ver la cuenta corriente de los locadores.').length).toBeGreaterThan(0);
    expect(apiClient).not.toHaveBeenCalled();
  });

  it('la ruta del locador toma la moneda de la dirección', async () => {
    mockApi();
    renderEs(<OwnerLedgerPage />);
    expect(await screen.findByRole('heading', { name: 'Cuenta corriente de Ana Locadora' })).toBeInTheDocument();
    expect(apiClient).toHaveBeenCalledWith(`/owners/${ANA}/ledger?currency=USD&page=1&limit=50`);
  });

  it('la ruta del locador ofrece la solapa de facturación y la carga al elegirla', async () => {
    const user = userEvent.setup();
    mockApi();
    renderEs(<OwnerLedgerPage />);
    await screen.findByRole('heading', { name: 'Cuenta corriente de Ana Locadora' });
    await user.click(screen.getByRole('tab', { name: 'Facturación' }));
    await waitFor(() => expect(apiClient).toHaveBeenCalledWith(`/persons/${ANA}/invoicing-settings`));
    expect(screen.queryByRole('heading', { name: 'Cuenta corriente de Ana Locadora' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Cuenta corriente' }));
    expect(await screen.findByRole('heading', { name: 'Cuenta corriente de Ana Locadora' })).toBeInTheDocument();
  });

  it('sin permiso de facturación la ruta del locador no muestra solapas de facturación', async () => {
    auth.role = 'Soporte';
    mockApi();
    renderEs(<OwnerLedgerPage />);
    expect(screen.queryByRole('tab', { name: 'Facturación' })).not.toBeInTheDocument();
  });

  it('sin moneda en la dirección arranca en pesos', async () => {
    search.currency = null;
    mockApi();
    renderEs(<OwnerLedgerPage />);
    await screen.findByRole('heading', { name: 'Cuenta corriente de Ana Locadora' });
    expect(apiClient).toHaveBeenCalledWith(`/owners/${ANA}/ledger?currency=ARS&page=1&limit=50`);
  });
});
