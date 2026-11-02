// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '../index-data/test-utils';

const { apiClient, downloadFile, toastError } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  downloadFile: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('@/lib/download', () => ({ downloadFile: (...a: unknown[]) => downloadFile(...a) }));
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a), info: vi.fn() } }));

import { ApiRequestError } from '@/lib/api-client';
import { PaymentForm } from './payment-form';

const CAJA = '11111111-1111-4111-8111-111111111111';
const BANCO = '22222222-2222-4222-8222-222222222222';
const RECEIPT = '33333333-3333-4333-8333-333333333333';

const ACCOUNTS = {
  items: [
    { id: CAJA, kind: 'Caja', name: 'Caja ARS', currency: 'ARS', ownerPersonId: null, isActive: true, owner: null, balance: '0.00' },
    { id: BANCO, kind: 'Banco', name: 'Banco Pesos', currency: 'ARS', ownerPersonId: null, isActive: true, owner: null, balance: '0.00' },
    { id: 'usd', kind: 'Banco', name: 'Banco Dólares', currency: 'USD', ownerPersonId: null, isActive: true, owner: null, balance: '0.00' },
    { id: 'cust', kind: 'Custodia', name: 'Custodia Ana', currency: 'ARS', ownerPersonId: 'p', isActive: true, owner: null, balance: '0.00' },
  ],
  totals: [],
  custodyInAgencyBalance: false,
};

function setup(post: () => unknown, props: { onSuccess?: () => void; onClose?: () => void } = {}) {
  apiClient.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (init?.method === 'POST') return post();
    if (path === '/financial-accounts') return ACCOUNTS;
    throw new Error(`unexpected ${path}`);
  });
  const onSuccess = props.onSuccess ?? vi.fn();
  renderEs(
    <PaymentForm liquidacionId="l-1" remainingBalance={100000} currency="ARS" onSuccess={onSuccess} onClose={props.onClose ?? vi.fn()} />,
  );
  return { onSuccess, user: userEvent.setup() };
}

const postBody = () => JSON.parse(apiClient.mock.calls.find(([, init]) => init?.method === 'POST')![1].body);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PaymentForm: quién recibió el cobro', () => {
  it('por defecto es según el contrato: no manda receptor ni cuenta y no consulta cuentas', async () => {
    const { onSuccess, user } = setup(() => ({}));
    expect(screen.getByLabelText('¿Quién recibió el cobro?')).toHaveValue('');
    expect(screen.queryByLabelText('Cuenta donde entró')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(/Método/), 'Efectivo');
    await user.click(screen.getByRole('button', { name: 'Registrar Pago' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    const body = postBody();
    expect(body).not.toHaveProperty('receivedBy');
    expect(body).not.toHaveProperty('accountId');
    expect(body).not.toHaveProperty('inCustody');
    expect(apiClient).toHaveBeenCalledTimes(1);
  });

  it('la inmobiliaria elige la cuenta de la moneda, guarda en custodia y emite recibo para imprimir', async () => {
    downloadFile.mockResolvedValue(undefined);
    const { onSuccess, user } = setup(() => ({
      registeredPayment: {
        id: 'pay-1',
        receivedBy: 'Inmobiliaria',
        inCustody: true,
        account: { id: BANCO, name: 'Banco Pesos', kind: 'Banco', currency: 'ARS' },
        receipt: { id: RECEIPT, series: 'RECIBO_COBRO_ARS', number: 7, label: 'ARS-00000007' },
      },
    }));
    await user.selectOptions(screen.getByLabelText('¿Quién recibió el cobro?'), 'Inmobiliaria');
    const account = await screen.findByLabelText('Cuenta donde entró');
    await waitFor(() => expect(within(account).getAllByRole('option')).toHaveLength(3));
    expect(within(account).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Automática: la caja o el banco en ARS',
      'Caja ARS',
      'Banco Pesos',
    ]);
    await user.selectOptions(account, BANCO);
    await user.click(screen.getByLabelText(/Guardar la parte de los locadores en custodia/));
    await user.type(screen.getByLabelText('Referencia externa'), ' ANT-001 ');
    await user.selectOptions(screen.getByLabelText(/Método/), 'Transferencia');
    await user.click(screen.getByRole('button', { name: 'Registrar Pago' }));

    expect(await screen.findByText('Se emitió el recibo Nº ARS-00000007.')).toBeInTheDocument();
    expect(postBody()).toMatchObject({ receivedBy: 'Inmobiliaria', accountId: BANCO, inCustody: true, externalRef: 'ANT-001' });
    expect(onSuccess).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Imprimir recibo' }));
    expect(downloadFile).toHaveBeenCalledWith(`/receipts/${RECEIPT}/pdf`, 'recibo-ARS-00000007.pdf');
    await user.click(screen.getByRole('button', { name: 'Listo' }));
    expect(onSuccess).toHaveBeenCalled();
  });

  it('con la cuenta automática no manda accountId; si el recibo no se descarga lo avisa', async () => {
    downloadFile.mockRejectedValue(new Error('offline'));
    const { user } = setup(() => ({
      registeredPayment: {
        id: 'pay-2',
        receivedBy: 'Inmobiliaria',
        inCustody: false,
        account: { id: CAJA, name: 'Caja ARS', kind: 'Caja', currency: 'ARS' },
        receipt: { id: RECEIPT, series: 'RECIBO_COBRO', number: 3, label: '00000003' },
      },
    }));
    await user.selectOptions(screen.getByLabelText('¿Quién recibió el cobro?'), 'Inmobiliaria');
    await user.selectOptions(screen.getByLabelText(/Método/), 'Efectivo');
    await user.click(screen.getByRole('button', { name: 'Registrar Pago' }));
    expect(await screen.findByText('Se emitió el recibo Nº 00000003.')).toBeInTheDocument();
    expect(postBody()).toMatchObject({ receivedBy: 'Inmobiliaria' });
    expect(postBody()).not.toHaveProperty('accountId');
    expect(postBody()).not.toHaveProperty('inCustody');
    await user.click(screen.getByRole('button', { name: 'Imprimir recibo' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('No se pudo descargar el archivo. Intentá de nuevo.'));
  });

  it('si cobró el locador no ofrece cuenta ni custodia y cierra sin recibo', async () => {
    const { onSuccess, user } = setup(() => ({
      registeredPayment: { id: 'pay-3', receivedBy: 'Locador', inCustody: false, account: null, receipt: null },
    }));
    await user.selectOptions(screen.getByLabelText('¿Quién recibió el cobro?'), 'Inmobiliaria');
    await user.click(await screen.findByLabelText(/Guardar la parte de los locadores en custodia/));
    await user.selectOptions(screen.getByLabelText('¿Quién recibió el cobro?'), 'Locador');
    expect(screen.queryByLabelText('Cuenta donde entró')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(/Método/), 'Transferencia');
    await user.click(screen.getByRole('button', { name: 'Registrar Pago' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(postBody()).toMatchObject({ receivedBy: 'Locador' });
    expect(postBody()).not.toHaveProperty('inCustody');
  });

  it('una referencia externa repetida se explica', async () => {
    const { user } = setup(() => {
      throw new ApiRequestError(409, 'PAYMENT_EXTERNAL_REF_EXISTS', 'dup');
    });
    await user.type(screen.getByLabelText('Referencia externa'), 'ANT-001');
    await user.selectOptions(screen.getByLabelText(/Método/), 'Efectivo');
    await user.click(screen.getByRole('button', { name: 'Registrar Pago' }));
    expect(await screen.findByText('Ya hay un pago con esa referencia externa.')).toBeInTheDocument();
  });
});
