// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '../index-data/test-utils';

const { apiClient, auth, toastSuccess } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  auth: { role: 'Ventas' },
  toastSuccess: vi.fn(),
}));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u1', role: auth.role } }),
  useOptionalAuth: () => ({ user: { id: 'u1', role: auth.role } }),
}));
vi.mock('@/lib/toast', () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn(), info: vi.fn() } }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/es/persons/pe-1',
}));

import { ApiRequestError } from '@/lib/api-client';
import { PersonConsents } from './person-consents';

const CONSENTS = {
  personId: 'pe-1',
  channels: [
    {
      channel: 'Email',
      status: 'OptOut',
      source: 'Complaint',
      at: '2026-10-20T15:00:00.000Z',
      note: null,
      address: 'luis@example.test',
      history: [
        { status: 'OptOut', source: 'Complaint', at: '2026-10-20T15:00:00.000Z', note: null, address: 'luis@example.test' },
        { status: 'OptIn', source: 'Manual', at: '2026-09-01T12:00:00.000Z', note: 'Lo pidió en la oficina', address: 'luis@example.test' },
      ],
    },
    { channel: 'WhatsApp', status: null, source: null, at: null, note: null, address: null, history: [] },
  ],
};

const AFTER_OPT_IN = {
  ...CONSENTS,
  channels: [
    CONSENTS.channels[0],
    {
      channel: 'WhatsApp',
      status: 'OptIn',
      source: 'Manual',
      at: '2026-11-02T15:00:00.000Z',
      note: 'Pidió los recibos por WhatsApp',
      address: '5491100000000',
      history: [{ status: 'OptIn', source: 'Manual', at: '2026-11-02T15:00:00.000Z', note: 'Pidió los recibos por WhatsApp', address: '5491100000000' }],
    },
  ],
};

function mockApi(put?: (body: Record<string, unknown>) => unknown, fail = false) {
  apiClient.mockImplementation(async (path: string, init?: { method?: string; body?: string }) => {
    if (path !== '/persons/pe-1/consents') throw new Error(`unexpected ${path}`);
    if (init?.method === 'PUT') return put ? put(JSON.parse(init.body ?? '{}')) : AFTER_OPT_IN;
    if (fail) throw new ApiRequestError(500, 'INTERNAL_ERROR', 'boom');
    return CONSENTS;
  });
}

const lastDialog = () => within(screen.getAllByRole('dialog').at(-1)!);

beforeEach(() => {
  apiClient.mockReset();
  toastSuccess.mockReset();
  auth.role = 'Ventas';
});

describe('PersonConsents', () => {
  it('muestra cada canal con su estado, origen, dirección, la ayuda legal y el enlace a los mensajes', async () => {
    mockApi();
    renderEs(<PersonConsents personId="pe-1" />);
    expect((await screen.findAllByText('Baja')).length).toBe(2);
    expect(screen.getByRole('heading', { name: 'Consentimiento de mensajes' })).toBeInTheDocument();
    expect(screen.getByText(/WhatsApp necesita el alta explícita de la persona/)).toBeInTheDocument();
    expect(screen.getAllByText('Marcó un mensaje como spam').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Se aplica a luis@example.test').length).toBeGreaterThan(0);
    expect(screen.getByText('Sin registrar')).toBeInTheDocument();
    expect(screen.getByText('Sin dirección cargada para este canal')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver mensajes' })).toHaveAttribute('href', '/es/mensajeria?personId=pe-1');
    // El historial se despliega con la nota de cada registro.
    expect(screen.getByText('Historial (2)')).toBeInTheDocument();
    expect(screen.getByText('Lo pidió en la oficina')).toBeInTheDocument();
  });

  it('registra un alta con nota y muestra el estado nuevo', async () => {
    let sent: Record<string, unknown> | null = null;
    mockApi((body) => {
      sent = body;
      return AFTER_OPT_IN;
    });
    const user = userEvent.setup();
    renderEs(<PersonConsents personId="pe-1" />);
    await screen.findByText('Sin registrar');
    await user.click(screen.getAllByRole('button', { name: 'Registrar alta' })[1]);
    expect(lastDialog().getByRole('heading', { name: 'Registrar el alta en WhatsApp' })).toBeInTheDocument();
    await user.type(lastDialog().getByLabelText('Nota'), '  Pidió los recibos por WhatsApp ');
    await user.click(lastDialog().getByRole('button', { name: 'Registrar' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Consentimiento registrado'));
    expect(sent).toEqual({ channel: 'WhatsApp', status: 'OptIn', note: 'Pidió los recibos por WhatsApp' });
    expect(screen.queryByText('Sin registrar')).not.toBeInTheDocument();
    expect(screen.getAllByText('Se aplica a 5491100000000').length).toBeGreaterThan(0);
  });

  it('registra una baja sin nota', async () => {
    let sent: Record<string, unknown> | null = null;
    mockApi((body) => {
      sent = body;
      return CONSENTS;
    });
    const user = userEvent.setup();
    renderEs(<PersonConsents personId="pe-1" />);
    await screen.findByText('Sin registrar');
    await user.click(screen.getAllByRole('button', { name: 'Registrar baja' })[0]);
    expect(lastDialog().getByRole('heading', { name: 'Registrar la baja en Mail' })).toBeInTheDocument();
    await user.click(lastDialog().getByRole('button', { name: 'Registrar' }));
    await waitFor(() => expect(sent).toEqual({ channel: 'Email', status: 'OptOut' }));
  });

  it('un error al registrar se muestra y el diálogo queda abierto; cancelar lo cierra', async () => {
    mockApi(() => {
      throw new ApiRequestError(404, 'PERSON_NOT_FOUND', 'La persona no existe.');
    });
    const user = userEvent.setup();
    renderEs(<PersonConsents personId="pe-1" />);
    await screen.findByText('Sin registrar');
    await user.click(screen.getAllByRole('button', { name: 'Registrar alta' })[0]);
    await user.click(lastDialog().getByRole('button', { name: 'Registrar' }));
    expect(await lastDialog().findByRole('alert')).toHaveTextContent('La persona no existe.');
    await user.click(lastDialog().getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it.each(['Lectura', 'Soporte'])('%s ve el consentimiento sin poder registrarlo', async (role) => {
    auth.role = role;
    mockApi();
    renderEs(<PersonConsents personId="pe-1" />);
    await screen.findByText('Sin registrar');
    expect(screen.queryByRole('button', { name: 'Registrar alta' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver mensajes' })).toBeInTheDocument();
  });

  it('Marketing no ve la sección ni la consulta', () => {
    auth.role = 'Marketing';
    mockApi();
    const { container } = renderEs(<PersonConsents personId="pe-1" />);
    expect(container).toBeEmptyDOMElement();
    expect(apiClient).not.toHaveBeenCalled();
  });

  it('un error al cargar se muestra', async () => {
    mockApi(undefined, true);
    renderEs(<PersonConsents personId="pe-1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('INTERNAL_ERROR');
  });
});
