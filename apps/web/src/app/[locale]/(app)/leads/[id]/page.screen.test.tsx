// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '@/components/index-data/test-utils';

const { apiClient, auth } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  auth: { role: 'Admin' },
}));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u1', role: auth.role, firstName: 'Ana', lastName: 'Prueba' } }),
  useOptionalAuth: () => ({
    user: { id: 'u1', role: auth.role, firstName: 'Ana', lastName: 'Prueba' },
  }),
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/es/leads/l-1',
  useParams: () => ({ id: 'l-1' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import { ApiRequestError } from '@/lib/api-client';
import LeadDetailPage from './page';

const minutesAgo = (m: number) => new Date(Date.now() - m * 60000).toISOString();

function lead(overrides: Record<string, unknown> = {}) {
  return {
    id: 'l-1',
    tenantId: 't-1',
    personId: 'pe-1',
    pipelineId: 'pi-1',
    currentStageId: 'st-1',
    propertyId: 'p-1',
    assignedToUserId: 'u2',
    source: 'WebInquiry',
    status: 'Contactado',
    budget: 150000,
    budgetCurrency: 'USD',
    lastContactAt: minutesAgo(5),
    createdAt: '2026-11-01T15:00:00.000Z',
    updatedAt: '2026-11-01T15:00:00.000Z',
    person: {
      id: 'pe-1',
      firstName: 'Luis',
      lastName: 'Inventado',
      email: 'luis@prueba.test',
      phone: '+54 11 5555-0000',
    },
    pipeline: { id: 'pi-1', name: 'Pipeline de prueba', type: 'Venta' },
    currentStage: { id: 'st-1', name: 'Primer contacto' },
    assignedToUser: { id: 'u2', firstName: 'Carla', lastName: 'Ejemplo', email: 'carla@prueba.test' },
    ...overrides,
  };
}

const interactions = [
  {
    id: 'i-1',
    type: 'Llamada',
    notes: 'Llamada ficticia',
    occurredAt: minutesAgo(90),
    user: { firstName: 'Carla', lastName: 'Ejemplo' },
  },
  { id: 'i-2', type: 'Nota', notes: null, occurredAt: '2026-01-05T12:00:00.000Z', user: null },
  { id: 'i-3', type: 'Email', notes: 'Reciente', occurredAt: minutesAgo(0), user: null },
  { id: 'i-4', type: 'Nota', notes: 'Hace días', occurredAt: minutesAgo(60 * 24 * 3), user: null },
];

const visits = [
  {
    id: 'v-1',
    scheduledAt: '2026-11-15T15:30:00.000Z',
    status: 'Completada',
    outcome: 'Interesado',
    notes: 'Visita ficticia',
    property: { id: 'p-1', title: 'Depto de prueba', street: 'Calle Falsa', number: '123', city: 'Ciudad Prueba' },
    user: { firstName: 'Carla', lastName: 'Ejemplo' },
  },
  {
    id: 'v-2',
    scheduledAt: '2026-12-01T15:30:00.000Z',
    status: 'Programada',
    property: { id: 'p-2', title: 'Solo título' },
  },
];

const templates = [
  {
    id: 'tp-1',
    name: 'Bienvenida prueba',
    subject: 'Hola {{nombre}}',
    body: '<p>Gracias {{nombreCompleto}} {{desconocida}}</p>',
    variables: ['nombre', 'desconocida'],
    isActive: true,
  },
];

interface Opts {
  lead?: () => unknown;
  interactions?: unknown[];
  visits?: unknown[];
  mutate?: (path: string, init: { method?: string }) => unknown;
  templates?: () => unknown;
}

function mockApi(opts: Opts = {}) {
  apiClient.mockImplementation((path: string, init?: { method?: string }) => {
    if (init?.method) {
      return Promise.resolve().then(() => (opts.mutate ? opts.mutate(path, init) : {}));
    }
    if (path === '/leads/l-1') return Promise.resolve().then(opts.lead ?? (() => lead()));
    if (path.startsWith('/leads/l-1/interactions')) {
      return Promise.resolve({ items: opts.interactions ?? interactions });
    }
    if (path.startsWith('/leads/l-1/visits')) {
      return Promise.resolve({ items: opts.visits ?? visits });
    }
    if (path.startsWith('/email-templates')) {
      return Promise.resolve().then(opts.templates ?? (() => ({ items: templates })));
    }
    return Promise.resolve({});
  });
}

const norm = (s: string | null) => (s ?? '').replaceAll(' ', ' ');

async function renderPage() {
  renderEs(<LeadDetailPage />);
  await screen.findByRole('heading', { name: 'Luis Inventado' });
  return userEvent.setup();
}

describe('LeadDetailPage', () => {
  beforeEach(() => {
    apiClient.mockReset();
    auth.role = 'Admin';
  });
  afterEach(() => vi.restoreAllMocks());

  it('muestra la ficha con presupuesto, asignado y enlace con prefijo de idioma', async () => {
    mockApi();
    await renderPage();
    expect(norm(document.body.textContent)).toContain('USD 150.000');
    expect(screen.getByText('Web')).toBeInTheDocument();
    expect(screen.getByText('Carla Ejemplo')).toBeInTheDocument();
    expect(screen.getByText('hace 5 min')).toBeInTheDocument();
    expect(screen.getByText('luis@prueba.test')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver a Leads' }).getAttribute('href')).toBe('/es/leads');
  });

  it('el timeline fusiona interacciones y visitas con fechas formateadas', async () => {
    mockApi();
    await renderPage();
    expect(screen.getByText('Llamada ficticia')).toBeInTheDocument();
    expect(screen.getByText('hace 1h')).toBeInTheDocument();
    expect(screen.getByText('hace 3d')).toBeInTheDocument();
    expect(screen.getByText('ahora')).toBeInTheDocument();
    expect(screen.getByText('05/01/2026')).toBeInTheDocument();
    expect(screen.getAllByText(/15\/11\/2026/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Calle Falsa 123 Ciudad Prueba/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Solo título').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Resultado: Interesado/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Registrado por: Carla Ejemplo/).length).toBeGreaterThan(0);
  });

  it.each(['Admin', 'Gerente', 'Ventas'])('%s ve las acciones', async (role) => {
    auth.role = role;
    mockApi();
    await renderPage();
    expect(screen.getByRole('button', { name: /Registrar Interacción/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Agendar Visita/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Enviar WhatsApp/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Enviar Email/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Actualizar Visita' }).length).toBe(2);
  });

  it.each(['Lectura', 'Soporte', 'Liquidaciones'])('%s no ve ninguna acción', async (role) => {
    auth.role = role;
    mockApi();
    await renderPage();
    expect(screen.queryByRole('button', { name: /Registrar Interacción/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Agendar Visita/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Enviar Email/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Actualizar Visita' })).not.toBeInTheDocument();
  });

  it('abre WhatsApp con el teléfono limpio', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    mockApi();
    const user = await renderPage();
    await user.click(screen.getByRole('button', { name: /Enviar WhatsApp/ }));
    expect(open).toHaveBeenCalledWith(expect.stringContaining('https://wa.me/541155550000'), '_blank');
  });

  it('registra una interacción', async () => {
    mockApi();
    const user = await renderPage();
    await user.click(screen.getByRole('button', { name: /Registrar Interacción/ }));
    await user.selectOptions(screen.getByRole('combobox'), 'Email');
    await user.type(screen.getByPlaceholderText('Detalles de la interacción...'), 'Nota nueva');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith(
        '/leads/l-1/interactions',
        expect.objectContaining({ body: JSON.stringify({ type: 'Email', notes: 'Nota nueva' }) }),
      ),
    );
    expect(await screen.findByText('Interacción registrada')).toBeInTheDocument();
  });

  it('cancelar cierra el modal de interacción', async () => {
    mockApi();
    const user = await renderPage();
    await user.click(screen.getByRole('button', { name: /Registrar Interacción/ }));
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByPlaceholderText('Detalles de la interacción...')).not.toBeInTheDocument();
  });

  it('un error al registrar la interacción se muestra y se descarta', async () => {
    mockApi({
      mutate: () => {
        throw new Error('x');
      },
    });
    const user = await renderPage();
    await user.click(screen.getByRole('button', { name: /Registrar Interacción/ }));
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText(/Error al registrar interacción/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '✕' }));
    expect(screen.queryByText(/Error al registrar interacción/)).not.toBeInTheDocument();
  });

  it('agenda una visita', async () => {
    mockApi();
    const user = await renderPage();
    await user.click(screen.getByRole('button', { name: /Agendar Visita/ }));
    const save = screen.getByRole('button', { name: 'Guardar' });
    expect(save).toBeDisabled();
    const dt = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    fireEvent.change(dt, { target: { value: '2026-12-10T10:00' } });
    await user.type(screen.getByPlaceholderText('Notas sobre la visita...'), 'Traer llaves');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith(
        '/leads/l-1/visits',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    expect(await screen.findByText('Visita agendada')).toBeInTheDocument();
  });

  it('un error al agendar la visita muestra el mensaje de la API', async () => {
    mockApi({
      mutate: () => {
        throw new ApiRequestError(400, 'X', 'Fecha inválida');
      },
    });
    const user = await renderPage();
    await user.click(screen.getByRole('button', { name: /Agendar Visita/ }));
    fireEvent.change(document.querySelector('input[type="datetime-local"]')!, {
      target: { value: '2026-12-10T10:00' },
    });
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText(/Fecha inválida/)).toBeInTheDocument();
  });

  it('actualiza una visita completada con resultado', async () => {
    mockApi();
    const user = await renderPage();
    await user.click(screen.getAllByRole('button', { name: 'Actualizar Visita' })[0]);
    const combos = screen.getAllByRole('combobox');
    expect(combos).toHaveLength(2);
    await user.selectOptions(combos[1], 'Oferta');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith(
        '/leads/l-1/visits/v-1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ status: 'Completada', outcome: 'Oferta' }),
        }),
      ),
    );
    expect(await screen.findByText('Visita actualizada')).toBeInTheDocument();
  });

  it('cambiar el estado a Cancelada oculta el resultado; un fallo se informa', async () => {
    mockApi({
      mutate: () => {
        throw new Error('x');
      },
    });
    const user = await renderPage();
    await user.click(screen.getAllByRole('button', { name: 'Actualizar Visita' })[1]);
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'Cancelada');
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText(/Error al actualizar visita/)).toBeInTheDocument();
  });

  it('envía un email con plantilla y vista previa', async () => {
    mockApi();
    const user = await renderPage();
    await user.click(screen.getByRole('button', { name: /Enviar Email/ }));
    const select = await screen.findByRole('combobox');
    await screen.findByRole('option', { name: 'Bienvenida prueba' });
    expect(screen.getAllByRole('button', { name: 'Enviar Email' }).at(-1)!).toBeDisabled();
    await user.selectOptions(select, 'tp-1');
    expect(screen.getByText('Hola Luis')).toBeInTheDocument();
    expect(screen.getByText(/Gracias Luis Inventado/)).toBeInTheDocument();
    expect(screen.getByText(/nombre: Luis/)).toBeInTheDocument();
    expect(screen.getByText(/desconocida: \{\{desconocida\}\}/)).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Enviar Email' }).at(-1)!);
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith(
        '/leads/l-1/send-email',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    expect(await screen.findByText('Email enviado exitosamente')).toBeInTheDocument();
  });

  it('si el servicio de email no está configurado lo informa', async () => {
    mockApi({
      mutate: () => {
        throw new ApiRequestError(400, 'EMAIL_NOT_CONFIGURED', 'x');
      },
    });
    const user = await renderPage();
    await user.click(screen.getByRole('button', { name: /Enviar Email/ }));
    await screen.findByRole('option', { name: 'Bienvenida prueba' });
    await user.selectOptions(screen.getByRole('combobox'), 'tp-1');
    await user.click(screen.getAllByRole('button', { name: 'Enviar Email' }).at(-1)!);
    expect(await screen.findByText(/no está configurado/)).toBeInTheDocument();
  });

  it('otro fallo al enviar el email muestra el error genérico', async () => {
    mockApi({
      mutate: () => {
        throw new Error('x');
      },
    });
    const user = await renderPage();
    await user.click(screen.getByRole('button', { name: /Enviar Email/ }));
    await screen.findByRole('option', { name: 'Bienvenida prueba' });
    await user.selectOptions(screen.getByRole('combobox'), 'tp-1');
    await user.click(screen.getAllByRole('button', { name: 'Enviar Email' }).at(-1)!);
    expect(await screen.findByText('Error al enviar el email')).toBeInTheDocument();
  });

  it('si fallan las plantillas el selector queda vacío', async () => {
    mockApi({
      templates: () => {
        throw new Error('x');
      },
    });
    const user = await renderPage();
    await user.click(screen.getByRole('button', { name: /Enviar Email/ }));
    const dialogSelect = await screen.findByRole('combobox');
    expect(within(dialogSelect).getAllByRole('option')).toHaveLength(1);
  });

  it('un lead sin datos opcionales ni historial muestra los vacíos', async () => {
    mockApi({
      lead: () =>
        lead({
          budget: null,
          assignedToUser: null,
          lastContactAt: null,
          person: { id: 'pe-1', firstName: 'Luis', lastName: 'Inventado', email: null, phone: null },
        }),
      interactions: [],
      visits: [],
    });
    await renderPage();
    expect(screen.getByText('No hay interacciones registradas')).toBeInTheDocument();
    expect(screen.getByText('No hay visitas agendadas')).toBeInTheDocument();
    expect(screen.queryByText('Presupuesto')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Enviar WhatsApp/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Enviar Email/ })).not.toBeInTheDocument();
  });

  it('un lead inexistente muestra el estado vacío con enlace', async () => {
    apiClient.mockImplementation(() => Promise.reject(new ApiRequestError(404, 'NF', 'no')));
    renderEs(<LeadDetailPage />);
    expect(await screen.findByText('Lead no encontrado')).toBeInTheDocument();
    expect(screen.getByRole('link').getAttribute('href')).toBe('/es/leads');
  });

  it('un error de carga distinto de 404 muestra el mensaje', async () => {
    apiClient.mockImplementation(() => Promise.reject(new Error('Servidor caído')));
    renderEs(<LeadDetailPage />);
    expect(await screen.findByText('Lead no encontrado')).toBeInTheDocument();
  });
});
