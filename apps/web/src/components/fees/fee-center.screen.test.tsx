// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEsWithQuery } from '../index-data/test-utils';

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

import { ApiRequestError } from '@/lib/api-client';
import { FeeCenter } from './fee-center';

const CONTRACT_ID = '11111111-1111-4111-8111-111111111111';
const PROPERTY_ID = '22222222-2222-4222-8222-222222222222';
const TENANT_ID = '33333333-3333-4333-8333-333333333333';
const LESSOR_ID = '44444444-4444-4444-8444-444444444444';
const USER_ID = '55555555-5555-4555-8555-555555555555';
const CAJA_ID = '66666666-6666-4666-8666-666666666666';
const BUYER_ID = '77777777-7777-4777-8777-777777777777';
const PERIOD_ID = '88888888-8888-4888-8888-888888888888';
const FEE_ID = '99999999-9999-4999-8999-999999999999';

const inst = (n: number, o: Record<string, unknown> = {}) => ({
  id: `inst-${n}`,
  n,
  dueDate: `2026-1${n}-01T00:00:00.000Z`,
  amount: '30000',
  adjustedAmount: null,
  status: 'Pendiente',
  paidAt: null,
  paidAmount: null,
  settlement: null,
  receiptId: null,
  receipt: null,
  dueAmount: '30000.00',
  ...o,
});

const fee = (o: Record<string, unknown> = {}) => ({
  id: FEE_ID,
  kind: 'AltaAlquiler',
  status: 'Pendiente',
  groupId: null,
  contractId: CONTRACT_ID,
  contractPeriodId: null,
  propertyId: PROPERTY_ID,
  payerPersonId: LESSOR_ID,
  payerRole: 'Locador',
  payerName: 'Luis Locador',
  basis: 'TotalContrato',
  pct: '5',
  baseAmount: '1200000',
  vatMode: 'NoAplica',
  vatPct: '0',
  netAmount: '60000',
  vatAmount: '0',
  total: '60000',
  currency: 'ARS',
  installments: 2,
  adjustInstallments: true,
  notes: 'Pactado al firmar',
  cancelReason: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  contract: { id: CONTRACT_ID, property: { id: PROPERTY_ID, title: 'Depto Sintético' } },
  property: { id: PROPERTY_ID, title: 'Depto Sintético' },
  installmentRows: [inst(1, { dueAmount: '33000.00' }), inst(2)],
  shares: [{ id: 'sh1', counterparty: 'Inmobiliaria Socia', pct: '20', amount: '12000', currency: 'ARS' }],
  staffCommissions: [
    { id: 'sc1', userId: USER_ID, personId: null, pct: '10', baseAmount: '48000', amount: '4800', currency: 'ARS', paidAt: null, beneficiaryName: 'Vera Vendedora' },
  ],
  ...o,
});

const page = (items: unknown[]) => ({ items, total: items.length, page: 1, limit: 50, totalPages: 1 });

const { installmentRows: _rows, shares: _shares, staffCommissions: _staff, ...feeHead } = fee();
const installmentItem = (o: Record<string, unknown> = {}, feeO: Record<string, unknown> = {}) => ({
  ...inst(1, { dueAmount: '33000.00' }),
  ...o,
  fee: { ...feeHead, ...feeO },
});

const commission = (o: Record<string, unknown> = {}) => ({
  id: 'sc1',
  feeId: FEE_ID,
  pct: '10',
  baseAmount: '48000',
  amount: '4800',
  currency: 'ARS',
  paidAt: null,
  beneficiaryName: 'Vera Vendedora',
  fee: { id: FEE_ID, kind: 'AltaAlquiler', status: 'Pendiente', total: '60000', currency: 'ARS', payerName: 'Luis Locador', contract: { property: { title: 'Depto Sintético' } }, property: null },
  ...o,
});

const rentalPreview = (o: Record<string, unknown> = {}) => ({
  kind: 'AltaAlquiler',
  basis: 'TotalContrato',
  baseAmount: '1200000.00',
  pct: '5',
  currency: 'ARS',
  payerMode: 'Reparto',
  payerChoice: 'Ambos',
  payers: [
    { role: 'Inquilino', personId: TENANT_ID, name: 'Ana Inquilina', sharePct: '50' },
    { role: 'Locador', personId: LESSOR_ID, name: 'Luis Locador', sharePct: '50' },
  ],
  firstDueDate: '2026-11-01',
  installments: 2,
  adjustInstallments: true,
  vatMode: 'NoAplica',
  vatPct: '21',
  staffCommissionPct: '10',
  staffCommissionBase: 'Neto',
  contractId: CONTRACT_ID,
  contractPeriodId: null,
  contractTotal: { mode: 'ConAjustesConocidos', months: 24, projected: true, indexBased: false, initialRent: '50000', start: '2026-11-01', end: '2028-10-31' },
  estimate: ['30000.00', '30000.00'],
  ...o,
});

const salePreview = {
  kind: 'Venta',
  basis: 'ValorOperacion',
  baseAmount: '0',
  pct: '3',
  currency: 'USD',
  payerMode: 'CadaParte',
  payers: [],
  firstDueDate: '2026-11-02',
  installments: 1,
  adjustInstallments: false,
  vatMode: 'NoAplica',
  vatPct: '21',
  staffCommissionPct: '0',
  staffCommissionBase: 'Neto',
  propertyId: null,
  saleAsset: 'Construido',
  estimate: ['0.00'],
};

interface Setup {
  role?: string;
  installments?: unknown[];
  fees?: unknown[];
  feeDetail?: Record<string, unknown>;
  commissions?: unknown[];
  pay?: Record<string, unknown>;
  failPay?: boolean;
}

function setup({ role = 'Admin', installments = [installmentItem()], fees = [fee()], feeDetail = fee(), commissions = [commission()], pay, failPay }: Setup = {}) {
  auth.role = role;
  apiClient.mockImplementation(async (path: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET';
    if (method !== 'GET') {
      if (failPay && path.includes('/pay')) throw new ApiRequestError(409, 'FEE_INSTALLMENT_NOT_PENDING', 'Ya cobrada');
      if (path.endsWith('/installments/1/pay')) return pay ?? fee({ installmentRows: [inst(1, { status: 'Pagada', receipt: { id: 'r', series: 'RECIBO_COBRO', number: 42 } }), inst(2)] });
      if (path === '/fees') return { items: [fee(), fee({ id: 'other' })] };
      return feeDetail;
    }
    if (path.startsWith('/fees/installments?')) return page(installments);
    if (path.startsWith('/fees/preview?')) {
      return new URLSearchParams(path.split('?')[1]).get('kind') === 'Venta' ? salePreview : rentalPreview();
    }
    if (path.startsWith('/fees?')) return page(fees);
    if (path === `/fees/${FEE_ID}`) return feeDetail;
    if (path.startsWith('/staff-commissions?')) return page(commissions);
    if (path === '/financial-accounts') {
      return {
        items: [
          { id: CAJA_ID, kind: 'Caja', name: 'Caja Pesos', currency: 'ARS', ownerPersonId: null, isActive: true, owner: null, balance: '0' },
          { id: 'usd', kind: 'Banco', name: 'Banco Dólares', currency: 'USD', ownerPersonId: null, isActive: true, owner: null, balance: '0' },
        ],
        totals: [],
        custodyInAgencyBalance: false,
      };
    }
    if (path === '/users') {
      return [
        { id: USER_ID, email: 'vera@ejemplo.test', firstName: 'Vera', lastName: 'Vendedora', role: 'Ventas', status: 'active' },
        { id: 'inv', email: 'nuevo@ejemplo.test', firstName: null, lastName: null, role: 'Ventas', status: 'invited' },
      ];
    }
    if (path.startsWith('/contracts?')) {
      return { items: [{ id: CONTRACT_ID, startDate: '2026-11-01T00:00:00.000Z', property: { id: PROPERTY_ID, title: 'Depto Sintético' } }] };
    }
    if (path.startsWith('/properties?')) return { items: [{ id: PROPERTY_ID, title: 'Depto Sintético' }] };
    if (path === `/contracts/${CONTRACT_ID}/periods`) {
      return [
        { id: 'orig', seq: 1, kind: 'Original', startDate: '2024-11-01T00:00:00.000Z', endDate: '2026-10-31T00:00:00.000Z' },
        { id: PERIOD_ID, seq: 2, kind: 'Renovacion', startDate: '2026-11-01T00:00:00.000Z', endDate: '2028-10-31T00:00:00.000Z' },
      ];
    }
    if (path.startsWith('/persons?')) return { items: [{ id: BUYER_ID, firstName: 'Carla', lastName: 'Compradora', dni: '30111222' }] };
    throw new Error(`unexpected ${method} ${path}`);
  });
  return renderEsWithQuery(<FeeCenter />);
}

const calls = (pred: (path: string, method: string) => boolean) =>
  apiClient.mock.calls.filter(([path, init]) => pred(path as string, (init as { method?: string } | undefined)?.method ?? 'GET'));
const bodyOf = (path: string) => JSON.parse(calls((p, m) => p === path && m !== 'GET').at(-1)![1].body);
const lastDialog = () => screen.getAllByRole('dialog').at(-1)!;

beforeEach(() => {
  apiClient.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe('Honorarios: cuotas', () => {
  it('lista las cuotas pendientes con quién paga, la ajustada y filtra por operación, mes y quién paga', async () => {
    const user = userEvent.setup();
    setup({ role: 'Liquidaciones' });

    expect((await screen.findAllByText('Luis Locador')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Cuota 1 de 2 · Depto Sintético').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ajustada').length).toBeGreaterThan(0);
    expect(calls((p) => p.startsWith('/fees/installments?'))[0][0]).toContain('status=Pendiente');

    await user.selectOptions(screen.getByLabelText('Operación'), 'Renovacion');
    await user.selectOptions(screen.getByLabelText('Quién paga'), 'Locador');
    const month = screen.getByLabelText('Vence en');
    await user.type(month, '2026-11');
    await waitFor(() => {
      const last = calls((p) => p.startsWith('/fees/installments?')).at(-1)![0] as string;
      expect(last).toContain('kind=Renovacion');
      expect(last).toContain('payerRole=Locador');
      expect(last).toContain('period=2026-11');
    });
    // Liquidaciones cobra, pero no carga honorarios ni ve las comisiones del personal.
    expect(screen.queryByRole('button', { name: 'Nuevo honorario' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Comisiones del personal' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Cobrar' }).length).toBeGreaterThan(0);
  });

  it('cobra una cuota a la caja con cuenta y medio, y avisa el número de recibo', async () => {
    const user = userEvent.setup();
    setup({ role: 'Liquidaciones' });
    await user.click((await screen.findAllByRole('button', { name: 'Cobrar' }))[0]);

    const dialog = within(lastDialog());
    expect(dialog.getByText(/Luis Locador \(Locador\)/)).toBeInTheDocument();
    expect(dialog.getByLabelText(/Importe/)).toHaveValue('33000.00');
    await waitFor(() => expect(dialog.getByRole('option', { name: 'Caja Pesos' })).toBeInTheDocument());
    expect(dialog.queryByRole('option', { name: 'Banco Dólares' })).not.toBeInTheDocument();
    await user.selectOptions(dialog.getByLabelText(/^Cuenta/), CAJA_ID);
    await user.selectOptions(dialog.getByLabelText(/Medio de pago/), 'Transferencia');
    await user.click(dialog.getByRole('button', { name: 'Registrar cobro' }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Cobro registrado con el recibo 00000042.'));
    expect(bodyOf(`/fees/${FEE_ID}/installments/1/pay`)).toMatchObject({
      settlement: 'Caja',
      accountId: CAJA_ID,
      method: 'Transferencia',
      amount: '33000.00',
      note: null,
    });
    await waitFor(() => expect(calls((p) => p.startsWith('/fees/installments?')).length).toBeGreaterThan(1));
  });

  it('si paga el locador, se puede descontar de su cuenta corriente sin cuenta de caja', async () => {
    const user = userEvent.setup();
    setup({ role: 'Gerente', pay: fee() });
    await user.click((await screen.findAllByRole('button', { name: 'Cobrar' }))[0]);
    const dialog = within(lastDialog());
    await user.selectOptions(dialog.getByLabelText(/Cómo se cobra/), 'CuentaLocador');
    expect(dialog.queryByLabelText(/^Cuenta/)).not.toBeInTheDocument();
    expect(dialog.queryByLabelText(/Medio de pago/)).not.toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Registrar cobro' }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Cobro registrado.'));
    expect(bodyOf(`/fees/${FEE_ID}/installments/1/pay`)).toMatchObject({ settlement: 'CuentaLocador', accountId: null });
  });

  it('si paga el inquilino no ofrece la cuenta del locador; un error queda en el diálogo', async () => {
    const user = userEvent.setup();
    setup({ role: 'Admin', installments: [installmentItem({}, { payerRole: 'Inquilino', payerName: 'Ana Inquilina' })], failPay: true });
    await user.click((await screen.findAllByRole('button', { name: 'Cobrar' }))[0]);
    const dialog = within(lastDialog());
    expect(dialog.queryByRole('option', { name: /cuenta del locador/ })).not.toBeInTheDocument();
    expect(dialog.getByText(/Solo un honorario que paga el locador/)).toBeInTheDocument();
    await user.clear(dialog.getByLabelText(/Importe/));
    await user.type(dialog.getByLabelText(/Importe/), 'abc');
    await user.click(dialog.getByRole('button', { name: 'Registrar cobro' }));
    expect(await dialog.findByText('El importe tiene que ser positivo, con hasta 2 decimales.')).toBeInTheDocument();

    await user.clear(dialog.getByLabelText(/Importe/));
    await user.click(dialog.getByRole('button', { name: 'Registrar cobro' }));
    expect(await dialog.findByRole('alert')).toBeInTheDocument();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('Lectura ve las cuotas pero no cobra', async () => {
    setup({ role: 'Lectura' });
    expect((await screen.findAllByText('Luis Locador')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Cobrar' })).not.toBeInTheDocument();
  });

  it('un rol sin acceso ve el aviso y no consulta nada', () => {
    setup({ role: 'Marketing' });
    expect(screen.getByText('Tu rol no puede ver los honorarios.')).toBeInTheDocument();
    expect(apiClient).not.toHaveBeenCalled();
  });
});

describe('Honorarios: detalle', () => {
  async function openDetail(user: ReturnType<typeof userEvent.setup>, o: Setup = {}) {
    setup(o);
    await user.click(await screen.findByRole('tab', { name: 'Honorarios' }));
    expect((await screen.findAllByText('0 de 2 cobradas')).length).toBeGreaterThan(0);
    await user.click(screen.getAllByRole('button', { name: 'Ver detalle' })[0]);
    return within(await waitFor(() => {
      const d = lastDialog();
      expect(within(d).getByText('Honorario de Alta de alquiler')).toBeInTheDocument();
      return d;
    }));
  }

  it('muestra importes, cuotas, coorretaje y comisiones; agrega coorretaje y comisión y quita los existentes', async () => {
    const user = userEvent.setup();
    const dialog = await openDetail(user);
    expect(dialog.getByText('Pactado al firmar')).toBeInTheDocument();
    expect(dialog.getByText(/Inmobiliaria Socia · 20 %/)).toBeInTheDocument();
    expect(dialog.getByText(/Vera Vendedora · 10 %/)).toBeInTheDocument();

    await user.type(dialog.getByLabelText('Inmobiliaria'), 'Otra Inmobiliaria');
    await user.type(dialog.getByLabelText('Porcentaje del coorretaje'), '15,5');
    await user.click(dialog.getByRole('button', { name: 'Agregar coorretaje' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Coorretaje agregado.'));
    expect(bodyOf(`/fees/${FEE_ID}/shares`)).toEqual({ counterparty: 'Otra Inmobiliaria', pct: '15.5' });

    await waitFor(() => expect(dialog.getByRole('option', { name: 'Vera Vendedora' })).toBeInTheDocument());
    expect(dialog.queryByRole('option', { name: 'nuevo@ejemplo.test' })).not.toBeInTheDocument();
    await user.selectOptions(dialog.getByLabelText('Persona del personal'), USER_ID);
    await user.type(dialog.getByLabelText('Porcentaje de la comisión'), '5');
    await user.click(dialog.getByRole('button', { name: 'Agregar comisión' }));
    await waitFor(() => expect(bodyOf(`/fees/${FEE_ID}/staff-commissions`)).toEqual({ userId: USER_ID, pct: '5' }));

    const removes = dialog.getAllByRole('button', { name: 'Quitar' });
    await user.click(removes[0]);
    await user.click(removes[1]);
    await waitFor(() => {
      expect(calls((p, m) => m === 'DELETE' && p === `/fees/${FEE_ID}/shares/sh1`)).toHaveLength(1);
      expect(calls((p, m) => m === 'DELETE' && p === `/fees/${FEE_ID}/staff-commissions/sc1`)).toHaveLength(1);
    });
  });

  it('anula con motivo después de confirmar', async () => {
    const user = userEvent.setup();
    const dialog = await openDetail(user, { feeDetail: fee() });
    await user.type(dialog.getByLabelText('Motivo de la anulación'), 'Se cayó la operación');
    await user.click(dialog.getByRole('button', { name: 'Anular honorario' }));
    const confirm = within(lastDialog());
    await user.click(confirm.getByRole('button', { name: 'Anular honorario' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Honorario anulado.'));
    expect(bodyOf(`/fees/${FEE_ID}/cancel`)).toEqual({ reason: 'Se cayó la operación' });
  });

  it('cobra una cuota desde el detalle y un error de la acción se avisa', async () => {
    const user = userEvent.setup();
    const dialog = await openDetail(user);
    await user.click(dialog.getAllByRole('button', { name: 'Cobrar' })[0]);
    await user.click(within(lastDialog()).getByRole('button', { name: 'Registrar cobro' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Cobro registrado con el recibo 00000042.'));
    await waitFor(() => expect(calls((p) => p === `/fees/${FEE_ID}`).length).toBeGreaterThan(1));

    apiClient.mockImplementationOnce(async () => {
      throw new ApiRequestError(409, 'FEE_HAS_PAYMENTS', 'Tiene cobros');
    });
    await user.type(dialog.getByLabelText('Inmobiliaria'), 'Otra');
    await user.type(dialog.getByLabelText('Porcentaje del coorretaje'), '5');
    await user.click(dialog.getByRole('button', { name: 'Agregar coorretaje' }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });

  it('un honorario anulado muestra el motivo y no se edita; Lectura no edita', async () => {
    const user = userEvent.setup();
    const dialog = await openDetail(user, {
      role: 'Lectura',
      feeDetail: fee({ status: 'Anulado', cancelReason: 'Error de carga', installmentRows: [inst(1, { status: 'Anulada' })] }),
    });
    expect(dialog.getByText('Anulado: Error de carga')).toBeInTheDocument();
    expect(dialog.queryByRole('button', { name: 'Agregar coorretaje' })).not.toBeInTheDocument();
    expect(dialog.queryByRole('button', { name: 'Anular honorario' })).not.toBeInTheDocument();
    expect(dialog.queryByRole('button', { name: 'Cobrar' })).not.toBeInTheDocument();
  });
});

describe('Honorarios: comisiones del personal', () => {
  it('lista las pendientes y paga una desde una cuenta de la moneda', async () => {
    const user = userEvent.setup();
    setup({ commissions: [commission(), commission({ id: 'sc2', paidAt: '2026-10-20T00:00:00.000Z', beneficiaryName: 'Pablo Pagado' })] });
    await user.click(await screen.findByRole('tab', { name: 'Comisiones del personal' }));
    expect((await screen.findAllByText('Vera Vendedora')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Depto Sintético · Luis Locador').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/10 % de \$\s48\.000/).length).toBeGreaterThan(0);

    await user.selectOptions(screen.getByLabelText('Estado'), 'true');
    await waitFor(() => expect(calls((p) => p.startsWith('/staff-commissions?')).at(-1)![0]).toContain('paid=true'));

    await user.click(screen.getAllByRole('button', { name: 'Cobrar' })[0]);
    const dialog = within(lastDialog());
    await user.click(dialog.getByRole('button', { name: 'Registrar pago' }));
    expect(await dialog.findByText('Elegí una cuenta.')).toBeInTheDocument();
    await waitFor(() => expect(dialog.getByRole('option', { name: 'Caja Pesos' })).toBeInTheDocument());
    await user.selectOptions(dialog.getByLabelText(/Cuenta de la que sale/), CAJA_ID);
    await user.click(dialog.getByRole('button', { name: 'Registrar pago' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Comisión pagada.'));
    expect(bodyOf('/staff-commissions/sc1/pay')).toMatchObject({ accountId: CAJA_ID, note: null });
  });
});

describe('Honorarios: alta', () => {
  async function openCreate(user: ReturnType<typeof userEvent.setup>) {
    setup();
    await user.click(await screen.findByRole('button', { name: 'Nuevo honorario' }));
    return within(lastDialog());
  }

  it('alta de alquiler: propone con el contrato, todo editable, con coorretaje y comisión, y manda el cuerpo', async () => {
    const user = userEvent.setup();
    const dialog = await openCreate(user);
    expect(dialog.getByText('Elegí el contrato para calcular el honorario.')).toBeInTheDocument();
    await waitFor(() => expect(dialog.getByRole('option', { name: /Depto Sintético · 2026-11/ })).toBeInTheDocument());
    await user.selectOptions(dialog.getByLabelText('Contrato'), CONTRACT_ID);

    await waitFor(() => expect(dialog.getByLabelText('Base')).toHaveValue('1200000.00'));
    expect(calls((p) => p.startsWith('/fees/preview?'))[0][0]).toBe(`/fees/preview?kind=AltaAlquiler&contractId=${CONTRACT_ID}`);
    expect(dialog.getByText(/24 meses del 2026-11-01 al 2028-10-31/)).toBeInTheDocument();
    expect(dialog.getByLabelText('Porcentaje')).toHaveValue('5');
    expect(dialog.getAllByText(/\$ 30\.000,00 · 2 cuotas de \$ 15\.000,00/)).toHaveLength(2);

    await user.clear(dialog.getByLabelText('Parte de Ana Inquilina (%)'));
    await user.type(dialog.getByLabelText('Parte de Ana Inquilina (%)'), '70');
    expect(dialog.getByText('Las partes tienen que sumar 100.')).toBeInTheDocument();
    await user.clear(dialog.getByLabelText('Parte de Luis Locador (%)'));
    await user.type(dialog.getByLabelText('Parte de Luis Locador (%)'), '30');
    await user.selectOptions(dialog.getByLabelText('IVA'), 'Adicional');
    await user.click(dialog.getByRole('button', { name: 'Agregar coorretaje' }));
    await user.type(dialog.getByLabelText('Inmobiliaria'), 'Inmobiliaria Socia');
    await user.type(dialog.getByLabelText('Porcentaje del coorretaje'), '20');
    await user.click(dialog.getByRole('button', { name: 'Agregar comisión' }));
    expect(dialog.getByLabelText('Porcentaje de la comisión')).toHaveValue('10');
    await user.selectOptions(dialog.getByLabelText('Persona del personal'), USER_ID);
    expect(dialog.getByText('Honorario sin IVA de todos los que pagan: $ 60.000,00.')).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Guardar honorario' }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Se cargaron 2 honorarios, uno por cada uno que paga.'));
    expect(bodyOf('/fees')).toEqual({
      kind: 'AltaAlquiler',
      contractId: CONTRACT_ID,
      contractPeriodId: null,
      propertyId: null,
      valuationId: null,
      basis: 'TotalContrato',
      baseAmount: '1200000.00',
      pct: '5',
      currency: 'ARS',
      payers: [
        { role: 'Inquilino', personId: TENANT_ID, sharePct: '70' },
        { role: 'Locador', personId: LESSOR_ID, sharePct: '30' },
      ],
      payerMode: 'Reparto',
      vatMode: 'Adicional',
      vatPct: '21',
      installments: 2,
      firstDueDate: '2026-11-01',
      adjustInstallments: true,
      shares: [{ counterparty: 'Inmobiliaria Socia', pct: '20' }],
      staff: [{ userId: USER_ID, pct: '10' }],
      notes: null,
    });
  });

  it('renovación: elige el período renovado y la propuesta sale de ese período', async () => {
    const user = userEvent.setup();
    const dialog = await openCreate(user);
    await user.selectOptions(dialog.getByLabelText('Operación'), 'Renovacion');
    await waitFor(() => expect(dialog.getByRole('option', { name: /Depto Sintético/ })).toBeInTheDocument());
    await user.selectOptions(dialog.getByLabelText('Contrato'), CONTRACT_ID);
    await waitFor(() => expect(dialog.getByRole('option', { name: 'Período 2: 2026-11-01 a 2028-10-31' })).toBeInTheDocument());
    expect(dialog.queryByRole('option', { name: /Período 1/ })).not.toBeInTheDocument();
    await user.selectOptions(dialog.getByLabelText('Período renovado'), PERIOD_ID);
    await waitFor(() =>
      expect(calls((p) => p.startsWith('/fees/preview?')).at(-1)![0]).toBe(`/fees/preview?kind=Renovacion&contractPeriodId=${PERIOD_ID}`),
    );
  });

  it('venta: cada parte paga, se agregan comprador y vendedor y el valor real; sin quien pague no se guarda', async () => {
    const user = userEvent.setup();
    const dialog = await openCreate(user);
    await user.selectOptions(dialog.getByLabelText('Operación'), 'Venta');
    await waitFor(() => expect(dialog.getByLabelText('Moneda')).toHaveValue('USD'));
    await user.selectOptions(dialog.getByLabelText('Tipo de venta'), 'Lote');
    await waitFor(() => expect(calls((p) => p.startsWith('/fees/preview?')).at(-1)![0]).toContain('saleAsset=Lote'));
    expect(dialog.getByText('Todavía no hay nadie que pague.')).toBeInTheDocument();

    await user.click(dialog.getByRole('button', { name: 'Guardar honorario' }));
    expect(await dialog.findByText('Agregá quién paga; en un reparto, las partes tienen que sumar 100.')).toBeInTheDocument();
    expect(calls((p, m) => p === '/fees' && m === 'POST')).toHaveLength(0);

    const base = dialog.getByLabelText('Base');
    await user.clear(base);
    await user.type(base, '100000');
    await user.type(dialog.getByLabelText('Agregar quién paga'), 'Car');
    await user.click(await dialog.findByRole('button', { name: /^Carla Compradora/ }));
    await user.selectOptions(dialog.getByLabelText('Agregar como'), 'Vendedor');
    await user.type(dialog.getByLabelText('Agregar quién paga'), 'Car');
    await user.click(await dialog.findByRole('button', { name: /^Carla Compradora/ }));
    expect(dialog.getAllByText(/US\$ 3\.000,00 · una cuota/)).toHaveLength(2);
    // Se quita la segunda fila (la de vendedor).
    await user.click(dialog.getAllByRole('button', { name: 'Quitar a Carla Compradora' })[1]);
    await user.click(dialog.getByRole('button', { name: 'Guardar honorario' }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(bodyOf('/fees')).toMatchObject({
      kind: 'Venta',
      basis: 'ValorOperacion',
      baseAmount: '100000',
      pct: '3',
      currency: 'USD',
      payerMode: 'CadaParte',
      payers: [{ role: 'Comprador', personId: BUYER_ID }],
      adjustInstallments: false,
    });
  });

  it('tasación: monto fijo de la propiedad; un error de la API queda en el diálogo', async () => {
    const user = userEvent.setup();
    const dialog = await openCreate(user);
    apiClient.mockImplementationOnce(async () => {
      throw new ApiRequestError(400, 'VALIDATION_ERROR', 'Datos inválidos');
    });
    await user.selectOptions(dialog.getByLabelText('Operación'), 'Tasacion');
    expect(await dialog.findByRole('alert')).toBeInTheDocument();
    await user.selectOptions(dialog.getByLabelText('Propiedad'), PROPERTY_ID);
    await waitFor(() => expect(calls((p) => p.startsWith('/fees/preview?')).at(-1)![0]).toBe(`/fees/preview?kind=Tasacion&propertyId=${PROPERTY_ID}`));
  });
});
