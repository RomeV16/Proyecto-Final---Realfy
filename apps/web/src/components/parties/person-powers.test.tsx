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
import { PersonPowers } from './person-powers';
import type { PartyPerson, PowerOfAttorney } from './parties';

const PRINCIPAL = '00000000-0000-4000-8000-000000000001';
const AGENT_ID = '00000000-0000-4000-8000-000000000002';
const CONTRACT_ID = '00000000-0000-4000-8000-0000000000c1';
const PROPERTY_ID = '00000000-0000-4000-8000-0000000000d1';

const ANA: PartyPerson = { id: PRINCIPAL, firstName: 'Ana', lastName: 'Propietaria' };
const CARLA: PartyPerson = { id: AGENT_ID, firstName: 'Carla', lastName: 'Apoderada' };

function power(extra: Partial<PowerOfAttorney> = {}): PowerOfAttorney {
  return {
    id: 'w-1',
    principalId: PRINCIPAL,
    agentId: AGENT_ID,
    scopes: ['Cobrar', 'Firmar'],
    signatureMode: 'Conjunta',
    groupKey: 'grupo-a',
    validFrom: '2025-01-01T00:00:00.000Z',
    validTo: null,
    documentUrl: 'https://archivos.prueba.test/poder.pdf',
    principal: ANA,
    agent: CARLA,
    ...extra,
  };
}

let granted: PowerOfAttorney[];
let held: PowerOfAttorney[];
let mutate: (path: string, init: { method: string; body?: string }) => Promise<unknown>;

function mockApi() {
  apiClient.mockImplementation((path: string, init?: { method?: string; body?: string }) => {
    if (init?.method && init.method !== 'GET') return mutate(path, init as { method: string; body?: string });
    if (path === `/persons/${PRINCIPAL}/powers`) return Promise.resolve(granted);
    if (path === `/persons/${PRINCIPAL}/powers?as=agent`) return Promise.resolve(held);
    if (path.startsWith('/persons?search=')) return Promise.resolve({ items: [CARLA, ANA] });
    if (path.startsWith('/contracts?personId=')) {
      return Promise.resolve({ items: [{ id: CONTRACT_ID, startDate: '2026-01-01T00:00:00.000Z', property: { title: 'Depto de prueba' } }] });
    }
    if (path.startsWith('/properties')) return Promise.resolve({ items: [{ id: PROPERTY_ID, title: 'Casa de prueba' }] });
    return Promise.resolve({});
  });
}

const mutations = () => apiClient.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET');

async function renderPowers(canEdit = true) {
  const view = renderEs(<PersonPowers personId={PRINCIPAL} canEdit={canEdit} />);
  await screen.findAllByText('Carla Apoderada');
  return { ...view, user: userEvent.setup() };
}

async function openNewPower(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Otorgar poder' }));
  const dialog = screen.getByRole('dialog');
  await user.type(within(dialog).getByPlaceholderText('Buscar persona…'), 'Car');
  await user.click(await within(dialog).findByRole('button', { name: /Carla Apoderada/ }));
  return dialog;
}

describe('PersonPowers', () => {
  beforeEach(() => {
    apiClient.mockReset();
    toast.success.mockReset();
    granted = [power()];
    held = [power({ id: 'w-2', principalId: CARLA.id, agentId: PRINCIPAL, principal: CARLA, agent: ANA, scopes: ['Administrar'], signatureMode: 'Indistinta', groupKey: null, documentUrl: null, validTo: '2020-01-01T00:00:00.000Z' })];
    mutate = () => Promise.resolve({});
    mockApi();
  });

  it('lista los poderes otorgados y los ejercidos como apoderada, solo lectura estos últimos', async () => {
    await renderPowers();
    expect(screen.getByRole('heading', { name: 'Poderes que otorgó' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Poderes que ejerce como apoderada' })).toBeInTheDocument();
    expect(screen.getAllByText('Cobrar').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Conjunta (firman todos)').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/grupo grupo-a/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Ver documento' })[0]).toHaveAttribute('href', 'https://archivos.prueba.test/poder.pdf');
    // El poder ejercido está vencido: se marca y no tiene acciones.
    expect(screen.getAllByText('No vigente').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /^Revocar el poder/ })).toHaveLength(2); // tabla y tarjeta del otorgado
  });

  it('sin permiso de edición no ofrece otorgar, editar ni revocar', async () => {
    await renderPowers(false);
    expect(screen.queryByRole('button', { name: 'Otorgar poder' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Editar el poder/ })).not.toBeInTheDocument();
  });

  it('muestra los estados vacíos', async () => {
    granted = [];
    held = [];
    renderEs(<PersonPowers personId={PRINCIPAL} canEdit />);
    expect(await screen.findByText('No otorgó poderes')).toBeInTheDocument();
    expect(await screen.findByText('No actúa como apoderada de nadie')).toBeInTheDocument();
  });

  it('si la carga falla muestra el error', async () => {
    apiClient.mockImplementation(() => Promise.reject(new ApiRequestError(500, 'INTERNAL_ERROR', 'caído')));
    renderEs(<PersonPowers personId={PRINCIPAL} canEdit />);
    expect((await screen.findAllByRole('alert'))[0]).toHaveTextContent('El servidor tuvo un problema');
  });

  it('valida el formulario: sin apoderado ni alcances no llama a la API', async () => {
    const { user } = await renderPowers();
    await user.click(screen.getByRole('button', { name: 'Otorgar poder' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await within(dialog).findByText('Elegí al apoderado')).toBeInTheDocument();
    expect(within(dialog).getByText('Elegí al menos un alcance')).toBeInTheDocument();
    expect(mutations()).toHaveLength(0);
  });

  it('no ofrece a la propia poderdante como apoderada', async () => {
    const { user } = await renderPowers();
    await user.click(screen.getByRole('button', { name: 'Otorgar poder' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByPlaceholderText('Buscar persona…'), 'An');
    expect(await within(dialog).findByRole('button', { name: /Carla Apoderada/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Ana Propietaria/ })).not.toBeInTheDocument();
  });

  it('otorga un poder general con firma indistinta', async () => {
    const { user } = await renderPowers();
    const dialog = await openNewPower(user);
    await user.click(within(dialog).getByLabelText('Cobrar'));
    await user.click(within(dialog).getByLabelText('Administrar'));
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(mutations()).toHaveLength(1));
    const [path, init] = mutations()[0];
    expect(path).toBe(`/persons/${PRINCIPAL}/powers`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      agentId: AGENT_ID,
      scopes: ['Cobrar', 'Administrar'],
      signatureMode: 'Indistinta',
      groupKey: null,
      validTo: null,
      documentUrl: null,
    });
    expect(toast.success).toHaveBeenCalledWith('Poder guardado');
  });

  it('firma conjunta pide clave de grupo y un poder de contrato elige entre sus contratos', async () => {
    const { user } = await renderPowers();
    const dialog = await openNewPower(user);
    expect(within(dialog).queryByLabelText('Clave de grupo')).not.toBeInTheDocument();
    await user.click(within(dialog).getByLabelText('Firmar'));
    await user.selectOptions(within(dialog).getByLabelText('Modo de firma'), 'Conjunta');
    await user.type(within(dialog).getByLabelText('Clave de grupo'), 'grupo-b');
    await user.selectOptions(within(dialog).getByLabelText('Aplica a'), 'contract');

    // Sin elegir el contrato no se envía.
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await within(dialog).findByText('Elegí el contrato')).toBeInTheDocument();
    expect(mutations()).toHaveLength(0);

    const select = within(dialog).getByLabelText(/^Contrato/);
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(2));
    expect(apiClient).toHaveBeenCalledWith(`/contracts?personId=${PRINCIPAL}&limit=100`);
    await user.selectOptions(select, CONTRACT_ID);
    await user.type(within(dialog).getByLabelText('Enlace al documento del poder'), 'https://archivos.prueba.test/p.pdf');
    fireDate(within(dialog).getByLabelText('Vigente desde'), '2026-02-01');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(JSON.parse(mutations()[0][1].body)).toMatchObject({
      agentId: AGENT_ID,
      scopes: ['Firmar'],
      signatureMode: 'Conjunta',
      groupKey: 'grupo-b',
      contractId: CONTRACT_ID,
      validFrom: '2026-02-01T00:00:00.000Z',
      documentUrl: 'https://archivos.prueba.test/p.pdf',
    });
    expect(JSON.parse(mutations()[0][1].body)).not.toHaveProperty('propertyId');
  });

  it('un poder de propiedad elige entre las propiedades', async () => {
    const { user } = await renderPowers();
    const dialog = await openNewPower(user);
    await user.click(within(dialog).getByLabelText('Cobrar'));
    await user.selectOptions(within(dialog).getByLabelText('Aplica a'), 'property');
    const select = within(dialog).getByLabelText(/^Propiedad/);
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(2));
    await user.selectOptions(select, PROPERTY_ID);
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(JSON.parse(mutations()[0][1].body).propertyId).toBe(PROPERTY_ID);
  });

  it('un enlace inválido o una vigencia invertida se marcan en el campo', async () => {
    const { user } = await renderPowers();
    const dialog = await openNewPower(user);
    await user.click(within(dialog).getByLabelText('Cobrar'));
    await user.type(within(dialog).getByLabelText('Enlace al documento del poder'), 'no-es-un-enlace');
    fireDate(within(dialog).getByLabelText('Vigente desde'), '2026-05-01');
    fireDate(within(dialog).getByLabelText('Vigente hasta'), '2026-04-01');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await within(dialog).findByText('Ingresá un enlace válido (https://…)')).toBeInTheDocument();
    expect(within(dialog).getByText('La fecha de fin debe ser posterior al inicio')).toBeInTheDocument();
    expect(mutations()).toHaveLength(0);
  });

  it('POWER_SELF de la API se muestra en el formulario', async () => {
    mutate = () => Promise.reject(new ApiRequestError(400, 'POWER_SELF', 'self'));
    const { user } = await renderPowers();
    const dialog = await openNewPower(user);
    await user.click(within(dialog).getByLabelText('Cobrar'));
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await within(dialog).findByText('Una persona no puede darse poder a sí misma.')).toBeInTheDocument();
  });

  it('edita alcances, firma y vigencia sin tocar al apoderado', async () => {
    const { user } = await renderPowers();
    await user.click(screen.getAllByRole('button', { name: 'Editar el poder de Carla Apoderada' })[0]);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Carla Apoderada')).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Aplica a')).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('Cobrar')).toBeChecked();
    await user.click(within(dialog).getByLabelText('Firmar'));
    await user.selectOptions(within(dialog).getByLabelText('Modo de firma'), 'Indistinta');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(mutations()).toHaveLength(1));
    const [path, init] = mutations()[0];
    expect(path).toBe(`/persons/${PRINCIPAL}/powers/w-1`);
    expect(init.method).toBe('PATCH');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ scopes: ['Cobrar'], signatureMode: 'Indistinta', groupKey: null, validFrom: '2025-01-01T00:00:00.000Z' });
    expect(body).not.toHaveProperty('agentId');
  });

  it('revoca con confirmación', async () => {
    const { user } = await renderPowers();
    await user.click(screen.getAllByRole('button', { name: 'Revocar el poder de Carla Apoderada' })[0]);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Revocar' }));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(mutations()[0][0]).toBe(`/persons/${PRINCIPAL}/powers/w-1`);
    expect(mutations()[0][1].method).toBe('DELETE');
  });

  it('un poder en uso no se revoca: muestra POWER_IN_USE', async () => {
    mutate = () => Promise.reject(new ApiRequestError(409, 'POWER_IN_USE', 'en uso'));
    const { user } = await renderPowers();
    await user.click(screen.getAllByRole('button', { name: 'Revocar el poder de Carla Apoderada' })[0]);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Revocar' }));
    expect(await screen.findByText(/El poder está en uso/)).toBeInTheDocument();
  });
});

import { fireEvent } from '@testing-library/react';
function fireDate(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
}
