// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEsWithQuery } from '../index-data/test-utils';

const { portalApiClient } = vi.hoisted(() => ({ portalApiClient: vi.fn() }));

vi.mock('@/lib/portal-api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/portal-api-client')>()),
  portalApiClient: (...args: unknown[]) => portalApiClient(...args),
}));

import { NewClaimDialog } from './new-claim-dialog';

const CONTRACTS = [{ id: 'c-1', propertyId: 'p-1', property: { address: 'Cuba 2310', name: 'Departamento en Belgrano' } }];
const CATEGORIES = [{ id: 'cat-1', name: 'Plomería' }];

function setup(open = true) {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  renderEsWithQuery(<NewClaimDialog open={open} onClose={onClose} onCreated={onCreated} />);
  return { onClose, onCreated, user: userEvent.setup() };
}

const post = () => portalApiClient.mock.calls.find(([, init]) => init?.method === 'POST');

beforeEach(() => {
  portalApiClient.mockReset();
  portalApiClient.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (init?.method === 'POST') return { id: 't-1' };
    if (path === '/portal/contract') return CONTRACTS;
    if (path === '/portal/categories') return CATEGORIES;
    throw new Error(`unexpected ${path}`);
  });
});

describe('NewClaimDialog', () => {
  it('cerrado no dibuja nada', () => {
    setup(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('abre con el foco en el título y cierra con el botón, con Esc y con el fondo', async () => {
    const { onClose, user } = setup();
    expect(screen.getByRole('dialog', { name: /Abrir un reclamo/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Título')).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Cerrar' }));
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('sin título avisa y no envía', async () => {
    const { user } = setup();
    await screen.findByLabelText('Categoría');
    await user.click(screen.getByRole('button', { name: 'Enviar reclamo' }));
    expect(screen.getByRole('alert')).toHaveTextContent('El título es obligatorio');
    expect(post()).toBeUndefined();
  });

  it('con una sola propiedad la manda preseleccionada junto con el título y la categoría', async () => {
    const { onCreated, user } = setup();
    await user.selectOptions(await screen.findByLabelText('Categoría'), 'cat-1');
    await user.type(screen.getByLabelText('Título'), '  Pierde la canilla  ');
    await user.click(screen.getByRole('button', { name: 'Enviar reclamo' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(post()![0]).toBe('/portal/tickets');
    expect(JSON.parse(post()![1].body)).toEqual({ propertyId: 'p-1', title: 'Pierde la canilla', categoryId: 'cat-1' });
  });

  it('si la API falla el aviso queda en el diálogo', async () => {
    portalApiClient.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (init?.method === 'POST') throw new Error('boom');
      return path === '/portal/contract' ? CONTRACTS : CATEGORIES;
    });
    const { onCreated, user } = setup();
    await screen.findByLabelText('Categoría');
    await user.type(screen.getByLabelText('Título'), 'Pierde la canilla');
    await user.click(screen.getByRole('button', { name: 'Enviar reclamo' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
  });
});
