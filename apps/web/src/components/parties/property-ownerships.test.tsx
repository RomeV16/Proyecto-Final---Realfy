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
import { PropertyOwnerships, ownershipShareSummary } from './property-ownerships';
import type { PartyPerson, PropertyOwnership } from './parties';

const PROPERTY = 'p-1';
const ANA: PartyPerson = { id: '00000000-0000-4000-8000-000000000001', firstName: 'Ana', lastName: 'Titular' };
const BETO: PartyPerson = { id: '00000000-0000-4000-8000-000000000002', firstName: 'Beto', lastName: 'Cotitular' };

const own = (id: string, person: PartyPerson, sharePct: string | null, extra: Partial<PropertyOwnership> = {}): PropertyOwnership => ({
  id,
  personId: person.id,
  sharePct,
  title: null,
  since: null,
  until: null,
  person,
  ...extra,
});

let items: PropertyOwnership[];
let mutate: (path: string, init: { method: string; body?: string }) => Promise<unknown>;

function mockApi() {
  apiClient.mockImplementation((path: string, init?: { method?: string; body?: string }) => {
    if (init?.method && init.method !== 'GET') return mutate(path, init as { method: string; body?: string });
    if (path === `/properties/${PROPERTY}/ownerships`) return Promise.resolve(items);
    if (path.startsWith('/persons?search=')) return Promise.resolve({ items: [ANA, BETO] });
    return Promise.resolve({});
  });
}

const mutations = () => apiClient.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET');

describe('ownershipShareSummary', () => {
  it('ignora a los titulares sin porcentaje y compara contra 100 en diezmilésimas', () => {
    expect(ownershipShareSummary([])).toEqual({ count: 0, units: 0, balanced: true });
    expect(ownershipShareSummary([{ sharePct: null }])).toMatchObject({ count: 0, balanced: true });
    expect(ownershipShareSummary([{ sharePct: '33.3333' }, { sharePct: '33.3333' }, { sharePct: '33.3334' }]).balanced).toBe(true);
    expect(ownershipShareSummary([{ sharePct: 30 }, { sharePct: null }])).toMatchObject({ count: 1, units: 300000, balanced: false });
  });
});

describe('PropertyOwnerships', () => {
  beforeEach(() => {
    apiClient.mockReset();
    toast.success.mockReset();
    items = [own('o-1', ANA, '60.0000', { title: 'Escritura', since: '2020-03-01T00:00:00.000Z' }), own('o-2', BETO, null)];
    mutate = () => Promise.resolve({});
    mockApi();
  });

  async function renderOwnerships(canEdit = true) {
    const view = renderEs(<PropertyOwnerships propertyId={PROPERTY} canEdit={canEdit} />);
    await screen.findAllByText('Ana Titular');
    return { ...view, user: userEvent.setup() };
  }

  it('lista los titulares con porcentaje, título y período', async () => {
    await renderOwnerships();
    expect(screen.getAllByText('60 %').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Escritura').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Ana Titular' })[0]).toHaveAttribute('href', `/es/persons/${ANA.id}`);
    expect(screen.getByText(/Informativo: los titulares no deciden los pagos/)).toBeInTheDocument();
  });

  it('avisa, sin bloquear, cuando los porcentajes cargados no suman 100', async () => {
    await renderOwnerships();
    const warning = screen.getByRole('status');
    expect(warning).toHaveTextContent('suman 60 %, no 100 %');
    expect(warning).toHaveTextContent('Es solo informativo y no impide guardar');
    expect(screen.getByRole('button', { name: 'Agregar titular' })).toBeEnabled();
  });

  it('no avisa si suman 100, ni si ninguno tiene porcentaje', async () => {
    items = [own('o-1', ANA, '60'), own('o-2', BETO, '40')];
    const { unmount } = await renderOwnerships();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    unmount();

    items = [own('o-1', ANA, null), own('o-2', BETO, null)];
    await renderOwnerships();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('sin titulares muestra el estado vacío; sin permiso no ofrece agregar ni quitar', async () => {
    items = [];
    renderEs(<PropertyOwnerships propertyId={PROPERTY} canEdit={false} />);
    expect(await screen.findByText('No hay titulares cargados')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Agregar titular' })).not.toBeInTheDocument();
  });

  it('si la carga falla muestra el error', async () => {
    apiClient.mockImplementation(() => Promise.reject(new ApiRequestError(500, 'INTERNAL_ERROR', 'caído')));
    renderEs(<PropertyOwnerships propertyId={PROPERTY} canEdit />);
    expect(await screen.findByRole('alert')).toHaveTextContent('El servidor tuvo un problema');
  });

  it('agrega un titular con porcentaje (acepta coma), título y fechas', async () => {
    const { user } = await renderOwnerships();
    await user.click(screen.getByRole('button', { name: 'Agregar titular' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByPlaceholderText('Buscar persona…'), 'Bet');
    await user.click(await within(dialog).findByRole('button', { name: /Beto Cotitular/ }));
    await user.type(within(dialog).getByLabelText('Porcentaje (opcional)'), '40,5');
    await user.type(within(dialog).getByLabelText('Título (opcional)'), 'Usufructo');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(mutations()).toHaveLength(1));
    const [path, init] = mutations()[0];
    expect(path).toBe(`/properties/${PROPERTY}/ownerships`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ personId: BETO.id, sharePct: '40.5', title: 'Usufructo', since: null, until: null });
    expect(toast.success).toHaveBeenCalledWith('Titular guardado');
  });

  it('el porcentaje es opcional; uno fuera de rango o fechas invertidas se marcan', async () => {
    const { user } = await renderOwnerships();
    await user.click(screen.getByRole('button', { name: 'Agregar titular' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByPlaceholderText('Buscar persona…'), 'Bet');
    await user.click(await within(dialog).findByRole('button', { name: /Beto Cotitular/ }));
    await user.type(within(dialog).getByLabelText('Porcentaje (opcional)'), '150');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await within(dialog).findByText(/Ingresá un porcentaje mayor que 0/)).toBeInTheDocument();
    expect(mutations()).toHaveLength(0);

    await user.clear(within(dialog).getByLabelText('Porcentaje (opcional)'));
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(JSON.parse(mutations()[0][1].body).sharePct).toBeNull();
  });

  it('sin elegir persona no guarda', async () => {
    const { user } = await renderOwnerships();
    await user.click(screen.getByRole('button', { name: 'Agregar titular' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('Elegí una persona')).toBeInTheDocument();
    expect(mutations()).toHaveLength(0);
  });

  it('muestra el error de la API al agregar y deja el diálogo abierto', async () => {
    mutate = () => Promise.reject(new ApiRequestError(404, 'PERSON_NOT_FOUND', 'No existe la persona'));
    const { user } = await renderOwnerships();
    await user.click(screen.getByRole('button', { name: 'Agregar titular' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByPlaceholderText('Buscar persona…'), 'Bet');
    await user.click(await within(dialog).findByRole('button', { name: /Beto Cotitular/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await within(dialog).findByText('No existe la persona')).toBeInTheDocument();
  });

  it('quita un titular con confirmación', async () => {
    const { user } = await renderOwnerships();
    await user.click(screen.getAllByRole('button', { name: 'Quitar a Beto Cotitular como titular' })[0]);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Quitar' }));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(mutations()[0][0]).toBe(`/properties/${PROPERTY}/ownerships/o-2`);
    expect(mutations()[0][1].method).toBe('DELETE');
  });

  it('si quitar falla muestra el error', async () => {
    mutate = () => Promise.reject(new ApiRequestError(404, 'OWNERSHIP_NOT_FOUND', 'No se encontró el titular'));
    const { user } = await renderOwnerships();
    await user.click(screen.getAllByRole('button', { name: 'Quitar a Beto Cotitular como titular' })[0]);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Quitar' }));
    expect(await screen.findByText('No se encontró el titular')).toBeInTheDocument();
  });
});
