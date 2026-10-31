// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '../index-data/test-utils';

const { apiClient, toast } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('@/lib/toast', () => ({ toast }));

import { ApiRequestError } from '@/lib/api-client';
import { PersonBankAccounts } from './person-bank-accounts';
import type { BankAccount } from './parties';

const PERSON = '00000000-0000-4000-8000-000000000001';
const ARS_1: BankAccount = { id: 'ba-1', currency: 'ARS', bankName: 'Banco de Prueba', cbu: '0000000000000000000001', alias: 'ana.pesos', holder: 'Ana Prueba', isDefault: true };
const ARS_2: BankAccount = { id: 'ba-2', currency: 'ARS', bankName: 'Banco Ficticio', cbu: null, alias: 'ana.otra', holder: null, isDefault: false };
const USD_1: BankAccount = { id: 'ba-3', currency: 'USD', bankName: null, cbu: null, alias: 'ana.dolares', holder: null, isDefault: true };

let accounts: BankAccount[];
let mutate: (path: string, init: { method: string; body?: string }) => Promise<unknown>;

function mockApi() {
  apiClient.mockImplementation((path: string, init?: { method?: string; body?: string }) => {
    if (init?.method && init.method !== 'GET') return mutate(path, init as { method: string; body?: string });
    return Promise.resolve(accounts);
  });
}

const mutations = () => apiClient.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET');

async function renderAccounts(canEdit = true) {
  const view = renderEs(<PersonBankAccounts personId={PERSON} canEdit={canEdit} />);
  await screen.findAllByText('ana.pesos');
  return { ...view, user: userEvent.setup() };
}

describe('PersonBankAccounts', () => {
  beforeEach(() => {
    apiClient.mockReset();
    toast.success.mockReset();
    accounts = [ARS_1, ARS_2, USD_1];
    mutate = () => Promise.resolve({});
    mockApi();
  });

  it('lista las cuentas y marca la predeterminada de cada moneda', async () => {
    await renderAccounts();
    expect(apiClient).toHaveBeenCalledWith(`/persons/${PERSON}/bank-accounts`);
    expect(screen.getAllByText('Predeterminada')).toHaveLength(4); // tabla y tarjetas
    expect(screen.getAllByText('USD').length).toBeGreaterThan(0);
  });

  it('sin permiso de edición no muestra acciones', async () => {
    await renderAccounts(false);
    expect(screen.queryByRole('button', { name: 'Agregar cuenta' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Eliminar/ })).not.toBeInTheDocument();
  });

  it('sin cuentas muestra el estado vacío', async () => {
    accounts = [];
    renderEs(<PersonBankAccounts personId={PERSON} canEdit />);
    expect(await screen.findByText('No hay cuentas bancarias cargadas')).toBeInTheDocument();
  });

  it('si la carga falla muestra el error y no una lista vacía', async () => {
    apiClient.mockImplementation(() => Promise.reject(new ApiRequestError(500, 'INTERNAL_ERROR', 'caído')));
    renderEs(<PersonBankAccounts personId={PERSON} canEdit />);
    expect(await screen.findByRole('alert')).toHaveTextContent('El servidor tuvo un problema');
    expect(screen.queryByText('No hay cuentas bancarias cargadas')).not.toBeInTheDocument();
  });

  it('agrega una cuenta con moneda, CBU de 22 dígitos y titular', async () => {
    const { user } = await renderAccounts();
    await user.click(screen.getByRole('button', { name: 'Agregar cuenta' }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Moneda'), 'USD');
    await user.type(within(dialog).getByLabelText('Banco'), 'Banco Nuevo');
    await user.type(within(dialog).getByLabelText('CBU'), '12345678901234567890ab12');
    expect(within(dialog).getByLabelText('CBU')).toHaveValue('1234567890123456789012');
    await user.type(within(dialog).getByLabelText('Alias'), 'nueva.usd');
    await user.type(within(dialog).getByLabelText('Titular'), 'Ana Prueba');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(mutations()).toHaveLength(1));
    const [path, init] = mutations()[0];
    expect(path).toBe(`/persons/${PERSON}/bank-accounts`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      currency: 'USD',
      bankName: 'Banco Nuevo',
      cbu: '1234567890123456789012',
      alias: 'nueva.usd',
      holder: 'Ana Prueba',
      isDefault: false,
    });
    expect(toast.success).toHaveBeenCalledWith('Cuenta guardada');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('un CBU incompleto se rechaza en el formulario sin llamar a la API', async () => {
    const { user } = await renderAccounts();
    await user.click(screen.getByRole('button', { name: 'Agregar cuenta' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('CBU'), '123');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await within(dialog).findByText('El CBU debe tener 22 dígitos')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('CBU')).toHaveAttribute('aria-invalid', 'true');
    expect(mutations()).toHaveLength(0);
  });

  it('marcar como predeterminada manda isDefault true a esa cuenta', async () => {
    const { user } = await renderAccounts();
    await user.click(screen.getAllByRole('button', { name: 'Hacer predeterminada la cuenta ana.otra' })[0]);
    await waitFor(() => expect(mutations()).toHaveLength(1));
    const [path, init] = mutations()[0];
    expect(path).toBe(`/persons/${PERSON}/bank-accounts/ba-2`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ isDefault: true });
    // La predeterminada actual no ofrece "Hacer predeterminada".
    expect(screen.queryByRole('button', { name: 'Hacer predeterminada la cuenta ana.pesos' })).not.toBeInTheDocument();
  });

  it('editar una cuenta no cambia la moneda y solo manda isDefault si cambió', async () => {
    const { user } = await renderAccounts();
    await user.click(screen.getAllByRole('button', { name: 'Editar la cuenta ana.otra' })[0]);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Moneda')).toBeDisabled();
    await user.clear(within(dialog).getByLabelText('Alias'));
    await user.type(within(dialog).getByLabelText('Alias'), 'ana.nueva');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(mutations()).toHaveLength(1));
    const body = JSON.parse(mutations()[0][1].body);
    expect(body).not.toHaveProperty('currency');
    expect(body).not.toHaveProperty('isDefault');
    expect(body.alias).toBe('ana.nueva');
    expect(body.bankName).toBe('Banco Ficticio');
  });

  it('dejar sin predeterminada la cuenta que lo es muestra BANK_ACCOUNT_DEFAULT_REQUIRED en el formulario', async () => {
    mutate = () => Promise.reject(new ApiRequestError(409, 'BANK_ACCOUNT_DEFAULT_REQUIRED', 'default required'));
    const { user } = await renderAccounts();
    await user.click(screen.getAllByRole('button', { name: 'Editar la cuenta ana.pesos' })[0]);
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByLabelText(/Cuenta predeterminada de la moneda/));
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(JSON.parse(mutations()[0][1].body).isDefault).toBe(false);
    expect(await within(dialog).findByText(/Tiene que haber una cuenta predeterminada por moneda/)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('eliminar pide confirmación y borra la cuenta', async () => {
    const { user } = await renderAccounts();
    await user.click(screen.getAllByRole('button', { name: 'Eliminar la cuenta ana.otra' })[0]);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('¿Eliminar la cuenta ana.otra?');
    await user.click(within(dialog).getByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(mutations()[0][0]).toBe(`/persons/${PERSON}/bank-accounts/ba-2`);
    expect(mutations()[0][1].method).toBe('DELETE');
  });

  it('cancelar la confirmación no borra nada', async () => {
    const { user } = await renderAccounts();
    await user.click(screen.getAllByRole('button', { name: 'Eliminar la cuenta ana.otra' })[0]);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(mutations()).toHaveLength(0);
  });

  it('eliminar la predeterminada con otras de la misma moneda muestra el error de la regla', async () => {
    mutate = () => Promise.reject(new ApiRequestError(409, 'BANK_ACCOUNT_DEFAULT_REQUIRED', 'default required'));
    const { user } = await renderAccounts();
    await user.click(screen.getAllByRole('button', { name: 'Eliminar la cuenta ana.pesos' })[0]);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Eliminar' }));
    expect(await screen.findByText(/Tiene que haber una cuenta predeterminada por moneda/)).toBeInTheDocument();
  });
});
