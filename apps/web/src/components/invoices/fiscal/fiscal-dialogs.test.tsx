// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '../../index-data/test-utils';

const { apiClient } = vi.hoisted(() => ({ apiClient: vi.fn() }));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));

import { ApiRequestError } from '@/lib/api-client';
import type { ArcaIssuerDTO } from '@/lib/schemas/invoices';
import { IssuersSection } from './issuers-section';
import { PdvSection } from './pdv-section';

const ISSUER: ArcaIssuerDTO = {
  id: 'iss-1',
  cuit: '20123456786',
  businessName: 'Inmobiliaria Demo',
  fiscalCondition: 'ResponsableInscripto',
  delegationStatus: 'Active',
  isSelf: true,
  isActive: true,
  puntosDeVenta: [{ id: 'pdv-1', number: 1, nombre: 'Web Services', bloqueado: false }],
};

const postBody = () => JSON.parse(apiClient.mock.calls.find(([, init]) => init?.method === 'POST')![1].body);

beforeEach(() => {
  apiClient.mockReset();
});

describe('IssuersSection: agregar emisor', () => {
  function setup() {
    const onRefresh = vi.fn();
    renderEs(<IssuersSection issuers={[ISSUER]} selectedIssuerId={null} onSelectIssuer={vi.fn()} onRefresh={onRefresh} />);
    return { onRefresh, user: userEvent.setup() };
  }

  it('abre el diálogo con el foco en el CUIT y lo cierra con Cancelar y con Esc', async () => {
    const { user } = setup();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Agregar emisor' }));
    expect(screen.getByRole('dialog', { name: /Agregar emisor/ })).toBeInTheDocument();
    expect(screen.getByLabelText(/^CUIT/)).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Agregar emisor' }));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(apiClient).not.toHaveBeenCalled();
  });

  it('un CUIT con dígito verificador incorrecto no se envía', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Agregar emisor' }));
    await user.type(screen.getByLabelText(/^CUIT/), '20-11111111-1');
    await user.type(screen.getByLabelText(/Razón social/), 'Otra SA');
    expect(screen.getByRole('alert')).toHaveTextContent('CUIT inválido');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Agregar emisor' }));
    expect(apiClient).not.toHaveBeenCalled();
  });

  it('con datos válidos crea el emisor, cierra y refresca; cada apertura arranca vacía', async () => {
    apiClient.mockResolvedValue({});
    const { onRefresh, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Agregar emisor' }));
    await user.type(screen.getByLabelText(/^CUIT/), '20-12345678-6');
    await user.type(screen.getByLabelText(/Razón social/), 'Otra SA');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Agregar emisor' }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    expect(postBody()).toMatchObject({ cuit: '20123456786', businessName: 'Otra SA', fiscalCondition: 'ResponsableInscripto' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Agregar emisor' }));
    expect(screen.getByLabelText(/^CUIT/)).toHaveValue('');
  });

  it('si la API rechaza, el error queda dentro del diálogo', async () => {
    apiClient.mockRejectedValue(new ApiRequestError(409, 'ISSUER_EXISTS', 'Ese CUIT ya está cargado'));
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Agregar emisor' }));
    await user.type(screen.getByLabelText(/^CUIT/), '20123456786');
    await user.type(screen.getByLabelText(/Razón social/), 'Otra SA');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Agregar emisor' }));
    expect(await screen.findByText('Ese CUIT ya está cargado')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('PdvSection: agregar punto de venta', () => {
  function setup() {
    const onRefresh = vi.fn();
    renderEs(<PdvSection issuer={ISSUER} onRefresh={onRefresh} />);
    return { onRefresh, user: userEvent.setup() };
  }

  it('abre con el foco en el número y se cierra con Cancelar', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Agregar manualmente' }));
    expect(screen.getByRole('dialog', { name: /Agregar Punto de Venta/ })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Número/)).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(apiClient).not.toHaveBeenCalled();
  });

  it('crea el punto de venta, cierra y refresca', async () => {
    apiClient.mockResolvedValue({});
    const { onRefresh, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Agregar manualmente' }));
    await user.type(screen.getByLabelText(/^Número/), '4');
    await user.type(screen.getByLabelText('Nombre'), 'Mostrador');
    await user.click(screen.getByRole('button', { name: 'Agregar' }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    expect(apiClient).toHaveBeenCalledWith('/invoices/issuers/iss-1/pdv', expect.objectContaining({ method: 'POST' }));
    expect(postBody()).toEqual({ number: 4, nombre: 'Mostrador' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('si la API rechaza, el error queda dentro del diálogo', async () => {
    apiClient.mockRejectedValue(new Error('boom'));
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Agregar manualmente' }));
    await user.type(screen.getByLabelText(/^Número/), '4');
    await user.click(screen.getByRole('button', { name: 'Agregar' }));
    expect(await screen.findByText('Error al agregar el punto de venta')).toBeInTheDocument();
  });
});
