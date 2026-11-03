// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '../index-data/test-utils';

const { apiClient, auth, toastSuccess } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  auth: { role: 'Admin', id: 'u-me' },
  toastSuccess: vi.fn(),
}));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: auth.id, firstName: 'Usuario', lastName: 'Demo', role: auth.role } }),
  useOptionalAuth: () => ({ user: { id: auth.id, firstName: 'Usuario', lastName: 'Demo', role: auth.role } }),
}));
vi.mock('@/lib/toast', () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { ApiRequestError } from '@/lib/api-client';
import { resetInboxSummary } from '@/lib/inbox-summary';
import InboxPage from '@/app/[locale]/(app)/bandeja/page';
import InboxSettingsPage from '@/app/[locale]/(app)/configuracion/bandeja/page';
import { InboxNavBadge } from '@/components/layout/inbox-nav-badge';

const FUTURE = new Date(Date.now() + 10 * 60_000).toISOString();
const PAST = new Date(Date.now() - 5 * 60_000).toISOString();

const item = (o: Record<string, unknown> = {}) => ({
  id: 'c1',
  channel: 'WhatsApp',
  subject: null,
  counterpartName: 'Iris Demo',
  address: '5493515550101',
  status: 'Nueva',
  assigneeUserId: null,
  assigneeName: null,
  unread: 2,
  slaDueAt: FUTURE,
  slaBreachedAt: null,
  firstResponseAt: null,
  slaState: 'ok',
  lastMessageAt: '2026-11-03T12:00:00.000Z',
  preview: 'Hola, ¿sigue disponible?',
  ...o,
});

const detail = (o: Record<string, unknown> = {}) => ({
  id: 'c1',
  channel: 'WhatsApp',
  address: '5493515550101',
  counterpartName: 'Iris Demo',
  subject: null,
  status: 'Nueva',
  assignee: null,
  person: null,
  lead: null,
  related: null,
  unread: 2,
  firstResponseAt: null,
  slaDueAt: FUTURE,
  slaBreachedAt: null,
  slaState: 'ok',
  lastMessageAt: '2026-11-03T12:00:00.000Z',
  replyRoute: { channel: 'WhatsApp', to: '5493515550101' },
  replyBlockedReason: null,
  messages: [
    { id: 'm1', direction: 'In', body: 'Hola, ¿sigue disponible?', at: '2026-11-03T12:00:00.000Z', isAutoReply: false, authorUserId: null, delivery: null },
    {
      id: 'm2',
      direction: 'Out',
      body: 'Gracias por escribirnos.',
      at: '2026-11-03T12:00:05.000Z',
      isAutoReply: true,
      authorUserId: null,
      delivery: { status: 'Pending', reason: 'MESSAGING_OFF', error: null },
    },
  ],
  ...o,
});

const SETTINGS = {
  slaMinutes: 15,
  businessHours: { enabled: true, days: [1, 2, 3, 4, 5], fromHour: 9, untilHour: 18 },
  threadWindowHours: 72,
  defaultAssigneeUserId: null,
  autoreply: {
    enabled: true,
    texts: { WhatsApp: 'Hola {name}, WA', Email: 'Hola {name}, mail', Web: 'Hola {name}, web' },
  },
  quickReplies: [{ id: 'visita', title: 'Coordinar visita', body: 'Hola {name}, ¿cuándo podés venir?' }],
};

interface Routes {
  list?: unknown[];
  detail?: unknown;
  summary?: unknown;
  fail?: Record<string, unknown>;
}

function route({ list = [item()], detail: d = detail(), summary = { unread: 2, breached: 1, unassigned: 1 }, fail = {} }: Routes = {}) {
  apiClient.mockImplementation(async (path: string, init?: { method?: string; body?: string }) => {
    const key = `${init?.method ?? 'GET'} ${path.split('?')[0]}`;
    if (fail[key]) throw fail[key];
    if (key === 'GET /conversations') return { items: list, total: list.length, page: 1, limit: 50, totalPages: 1 };
    if (key === 'GET /conversations/summary') return summary;
    if (key === 'GET /conversations/settings') return SETTINGS;
    if (key === 'GET /users') return [{ id: '11111111-1111-4111-8111-111111111111', firstName: 'Vera', lastName: 'Ventas', role: 'Ventas', status: 'active' }];
    if (key.startsWith('GET /conversations/')) return d;
    if (key === 'POST /conversations/calls') return detail({ id: 'c9', channel: 'Telefono', counterpartName: 'Mario' });
    if (key === 'PUT /conversations/settings') return JSON.parse(init!.body!);
    return { ok: true };
  });
}

const calls = (key: string) => apiClient.mock.calls.filter(([p, i]) => `${i?.method ?? 'GET'} ${String(p).split('?')[0]}` === key);

beforeEach(() => {
  vi.clearAllMocks();
  resetInboxSummary();
  auth.role = 'Admin';
  auth.id = 'u-me';
});

describe('Bandeja de consultas: lista', () => {
  it('muestra las consultas con canal, estado, plazo, sin leer y contadores', async () => {
    route({ list: [item(), item({ id: 'c2', counterpartName: null, address: 'a@b.com', channel: 'Email', status: 'Asignada', assigneeName: 'Ana Demo', unread: 0, slaDueAt: PAST, slaState: 'breached' }), item({ id: 'c3', counterpartName: 'Mario Demo', firstResponseAt: PAST, status: 'EnCurso' })] });
    renderEs(<InboxPage />);
    const list = await screen.findByRole('list', { name: 'Consultas' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(within(rows[2]).getByText('Respondida')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Iris Demo')).toBeInTheDocument();
    expect(within(rows[0]).getByText(/Vence en/)).toBeInTheDocument();
    expect(within(rows[0]).getByLabelText('2 mensajes sin leer')).toBeInTheDocument();
    expect(within(rows[1]).getByText('a@b.com')).toBeInTheDocument();
    expect(within(rows[1]).getByText(/Vencida hace/)).toBeInTheDocument();
    expect(within(rows[1]).getByText('Ana Demo')).toBeInTheDocument();
    expect(await screen.findByText('1 con el plazo vencido')).toBeInTheDocument();
    expect(calls('GET /conversations')[0][0]).toContain('open=true');
  });

  it('los filtros vuelven a pedir la lista', async () => {
    route();
    renderEs(<InboxPage />);
    await screen.findByRole('list', { name: 'Consultas' });
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Canal'), 'Email');
    await user.selectOptions(screen.getByLabelText('Responsable'), 'me');
    await user.selectOptions(screen.getByLabelText('Estado'), 'Resuelta');
    await user.click(screen.getByLabelText('Plazo vencido'));
    await user.type(screen.getByLabelText('Buscar por nombre, dirección o asunto'), 'iris');
    await user.selectOptions(screen.getByLabelText('Estado'), 'all');
    await waitFor(() => {
      const last = String(calls('GET /conversations').at(-1)![0]);
      expect(last).toContain('channel=Email');
      expect(last).toContain('assignee=me');
      expect(last).toContain('slaBreached=true');
      expect(last).toContain('search=iris');
      expect(last).not.toContain('status=');
      expect(last).not.toContain('open=');
    });
  });

  it('sin consultas muestra el aviso y si falla la carga, el error', async () => {
    route({ list: [] });
    const first = renderEs(<InboxPage />);
    expect(await screen.findByText('No hay consultas')).toBeInTheDocument();
    first.unmount();
    route({ fail: { 'GET /conversations': new ApiRequestError(500, 'ERR_500', 'Falló') } });
    renderEs(<InboxPage />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('un rol sin acceso no ve la bandeja ni consulta nada', () => {
    auth.role = 'Lectura';
    renderEs(<InboxPage />);
    expect(screen.getByText('No tenés acceso a la bandeja de consultas.')).toBeInTheDocument();
    expect(apiClient).not.toHaveBeenCalled();
  });
});

describe('Bandeja de consultas: hilo', () => {
  async function open() {
    const user = userEvent.setup();
    renderEs(<InboxPage />);
    await user.click(await screen.findByRole('button', { name: /Iris Demo/ }));
    await screen.findByRole('region', { name: 'Consulta' });
    return user;
  }

  it('abre el hilo con los mensajes, la autorrespuesta y su estado de entrega, y marca como leída', async () => {
    route();
    await open();
    expect(screen.getByText('Hola, ¿sigue disponible?', { selector: 'div' })).toBeInTheDocument();
    expect(screen.getByText('Autorrespuesta')).toBeInTheDocument();
    expect(screen.getByText('MESSAGING_OFF')).toBeInTheDocument();
    expect(screen.getByText('Se responde por WhatsApp a 5493515550101.')).toBeInTheDocument();
    await waitFor(() => expect(calls('POST /conversations/c1/read')).toHaveLength(1));
  });

  it('responde: manda el texto, limpia el cuadro y recarga', async () => {
    route();
    const user = await open();
    const send = screen.getByRole('button', { name: 'Enviar' });
    expect(send).toBeDisabled();
    await user.type(screen.getByLabelText('Respuesta'), 'Sí, está disponible');
    await user.click(send);
    await waitFor(() => expect(calls('POST /conversations/c1/reply')).toHaveLength(1));
    expect(JSON.parse(calls('POST /conversations/c1/reply')[0][1].body)).toEqual({ body: 'Sí, está disponible' });
    expect(toastSuccess).toHaveBeenCalledWith('Respuesta enviada a la bandeja de salida.');
    expect(screen.getByLabelText('Respuesta')).toHaveValue('');
  });

  it('una respuesta rápida completa el nombre de pila', async () => {
    route();
    const user = await open();
    await user.selectOptions(screen.getByLabelText('Respuestas rápidas'), 'visita');
    expect(screen.getByLabelText('Respuesta')).toHaveValue('Hola Iris, ¿cuándo podés venir?');
  });

  it('si no se puede responder lo explica y bloquea el cuadro', async () => {
    route({ detail: detail({ replyRoute: null, replyBlockedReason: 'WHATSAPP_WINDOW_CLOSED' }) });
    await open();
    expect(screen.getByRole('alert')).toHaveTextContent('Pasaron más de 24 horas');
    expect(screen.getByLabelText('Respuesta')).toBeDisabled();
  });

  it('un error al responder se muestra', async () => {
    route({ fail: { 'POST /conversations/c1/reply': new ApiRequestError(409, 'WHATSAPP_WINDOW_CLOSED', 'Ventana cerrada') } });
    const user = await open();
    await user.type(screen.getByLabelText('Respuesta'), 'Hola');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByText(/Ventana cerrada/)).toBeInTheDocument();
  });

  it('Admin asigna a otra persona y cambia el estado', async () => {
    route();
    const user = await open();
    const thread = screen.getByRole('region', { name: 'Consulta' });
    await screen.findByRole('option', { name: 'Vera Ventas' });
    await user.selectOptions(within(thread).getByLabelText('Responsable'), '11111111-1111-4111-8111-111111111111');
    await waitFor(() => expect(calls('PUT /conversations/c1/assignee')).toHaveLength(1));
    expect(JSON.parse(calls('PUT /conversations/c1/assignee')[0][1].body)).toEqual({ assigneeUserId: '11111111-1111-4111-8111-111111111111' });
    await user.selectOptions(within(thread).getByLabelText('Estado'), 'Resuelta');
    await waitFor(() => expect(calls('PUT /conversations/c1/status')).toHaveLength(1));
  });

  it('quien no administra puede tomar la consulta para sí', async () => {
    auth.role = 'Ventas';
    auth.id = 'u-ventas-1';
    route();
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Tomar' }));
    await waitFor(() => expect(calls('PUT /conversations/c1/assignee')).toHaveLength(1));
    expect(JSON.parse(calls('PUT /conversations/c1/assignee')[0][1].body)).toEqual({ assigneeUserId: 'u-ventas-1' });
    expect(calls('GET /users')).toHaveLength(0);
  });

  it('si ya es suya no ofrece tomarla; muestra los vínculos', async () => {
    auth.role = 'Ventas';
    auth.id = 'u-1';
    route({
      detail: detail({
        assignee: { id: 'u-1', name: 'Yo Demo' },
        person: { id: 'p1', firstName: 'Iris', lastName: 'Demo', email: null, phone: null },
        lead: { id: 'l1', status: 'Nuevo', propertyId: null },
        related: { type: 'Property', id: 'pr1' },
      }),
    });
    await open();
    expect(screen.queryByRole('button', { name: 'Tomar' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Persona: Iris Demo' })).toHaveAttribute('href', '/persons/p1');
    expect(screen.getByRole('link', { name: 'Ver propiedad' })).toHaveAttribute('href', '/properties/pr1');
    expect(screen.getByRole('link', { name: 'Ver interés' })).toBeInTheDocument();
  });

  it('un contrato vinculado lleva a su ficha; sin vínculos lo dice; y se vuelve a la lista', async () => {
    route({ detail: detail({ related: { type: 'Contract', id: 'ct1' } }) });
    const user = await open();
    expect(screen.getByRole('link', { name: 'Ver contrato' })).toHaveAttribute('href', '/contracts/ct1');
    await user.click(screen.getByRole('button', { name: '← Volver' }));
    expect(screen.queryByRole('region', { name: 'Consulta' })).not.toBeInTheDocument();
  });

  it('sin vínculos lo aclara', async () => {
    route();
    await open();
    expect(screen.getByText('Sin persona, propiedad ni contrato vinculados.')).toBeInTheDocument();
  });

  it('un error al cargar el hilo se muestra', async () => {
    route({ fail: { 'GET /conversations/c1': new ApiRequestError(500, 'ERR_500', 'Falló el hilo') } });
    const user = userEvent.setup();
    renderEs(<InboxPage />);
    await user.click(await screen.findByRole('button', { name: /Iris Demo/ }));
    expect(await screen.findByText(/Falló el hilo/)).toBeInTheDocument();
  });
});

describe('Bandeja de consultas: registrar llamada y vincular', () => {
  it('registra una llamada y abre la consulta creada', async () => {
    route();
    const user = userEvent.setup();
    renderEs(<InboxPage />);
    await screen.findByRole('list', { name: 'Consultas' });
    await user.click(screen.getByRole('button', { name: 'Registrar llamada' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Registrar' }));
    expect(within(dialog).getAllByText('Este dato es obligatorio.').length).toBeGreaterThan(0);
    expect(calls('POST /conversations/calls')).toHaveLength(0);
    await user.type(within(dialog).getByLabelText(/Nombre/), 'Mario Demo');
    await user.type(within(dialog).getByLabelText(/Teléfono/), '351 555-0114');
    await user.type(within(dialog).getByLabelText(/Qué se habló/), 'Pidió requisitos');
    await user.click(within(dialog).getByLabelText(/Ya se atendió/));
    await user.click(within(dialog).getByRole('button', { name: 'Registrar' }));
    await waitFor(() => expect(calls('POST /conversations/calls')).toHaveLength(1));
    expect(JSON.parse(calls('POST /conversations/calls')[0][1].body)).toEqual({
      name: 'Mario Demo',
      phone: '351 555-0114',
      summary: 'Pidió requisitos',
      answered: false,
    });
    await waitFor(() => expect(calls('GET /conversations/c9')).toHaveLength(1));
  });

  it('un error al registrar se muestra y el diálogo sigue abierto', async () => {
    route({ fail: { 'POST /conversations/calls': new ApiRequestError(400, 'INVALID_PHONE', 'Teléfono inválido') } });
    const user = userEvent.setup();
    renderEs(<InboxPage />);
    await user.click(await screen.findByRole('button', { name: 'Registrar llamada' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Nombre/), 'Mario');
    await user.type(within(dialog).getByLabelText(/Teléfono/), '351 555-0114');
    await user.type(within(dialog).getByLabelText(/Qué se habló/), 'x');
    await user.click(within(dialog).getByRole('button', { name: 'Registrar' }));
    expect(await within(dialog).findByText(/Teléfono inválido/)).toBeInTheDocument();
  });

  it('vincula una persona buscada y desvincula', async () => {
    route({
      detail: detail({
        person: { id: 'p0', firstName: 'Vieja', lastName: 'Persona', email: null, phone: null },
        lead: { id: 'l1', status: 'Nuevo', propertyId: null },
        related: { type: 'Property', id: 'pr1' },
      }),
    });
    apiClient.mockImplementation(
      ((impl) => async (path: string, init?: { method?: string }) => {
        if (path.startsWith('/persons?')) return { items: [{ id: 'p1', firstName: 'Iris', lastName: 'Demo', email: 'i@d.com', phone: null }] };
        if (path.startsWith('/properties?')) return { items: [{ id: 'pr2', title: 'Depto Centro', city: 'Córdoba' }] };
        if (path.startsWith('/contracts?')) return { items: [{ id: 'ct1', status: 'Activo', property: { title: 'Depto Norte' } }, { id: 'ct2abcdef', status: 'Borrador' }] };
        return impl(path, init);
      })(apiClient.getMockImplementation()!),
    );
    const user = userEvent.setup();
    renderEs(<InboxPage />);
    await user.click(await screen.findByRole('button', { name: /Iris Demo/ }));
    await user.click(await screen.findByRole('button', { name: 'Vincular' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Escribí al menos dos letras para buscar.')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Buscar…'), 'ir');
    await user.click(await within(dialog).findByRole('button', { name: /Iris Demo/ }));
    await waitFor(() => expect(calls('PUT /conversations/c1/links')).toHaveLength(1));
    expect(JSON.parse(calls('PUT /conversations/c1/links')[0][1].body)).toEqual({ personId: 'p1' });
  });

  it('busca propiedades y contratos de la persona, y desvincula', async () => {
    route({
      detail: detail({
        person: { id: 'p0', firstName: 'Vieja', lastName: 'Persona', email: null, phone: null },
        lead: { id: 'l1', status: 'Nuevo', propertyId: null },
        related: { type: 'Property', id: 'pr1' },
      }),
    });
    const base = apiClient.getMockImplementation()!;
    apiClient.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path.startsWith('/properties?')) return { items: [{ id: 'pr2', title: 'Depto Centro', city: 'Córdoba' }] };
      if (path.startsWith('/contracts?')) return { items: [{ id: 'ct1', status: 'Activo', property: { title: 'Depto Norte' } }, { id: 'ct2abcdef', status: 'Borrador' }] };
      return base(path, init);
    });
    const user = userEvent.setup();
    renderEs(<InboxPage />);
    await user.click(await screen.findByRole('button', { name: /Iris Demo/ }));
    await user.click(await screen.findByRole('button', { name: 'Vincular' }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Qué vincular'), 'property');
    await user.type(within(dialog).getByLabelText('Buscar…'), 'dep');
    await user.click(await within(dialog).findByRole('button', { name: /Depto Centro/ }));
    await waitFor(() => expect(calls('PUT /conversations/c1/links')).toHaveLength(1));
    expect(JSON.parse(calls('PUT /conversations/c1/links')[0][1].body)).toEqual({ related: { type: 'Property', id: 'pr2' } });
  });

  it('un contrato se elige entre los de la persona vinculada; sin persona lo pide', async () => {
    route({ detail: detail({ person: { id: 'p0', firstName: 'Vieja', lastName: 'Persona', email: null, phone: null } }) });
    const base = apiClient.getMockImplementation()!;
    apiClient.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path.startsWith('/contracts?')) return { items: [{ id: 'ct1', status: 'Activo', property: { title: 'Depto Norte' } }, { id: 'ct2abcdef', status: 'Borrador' }] };
      return base(path, init);
    });
    const user = userEvent.setup();
    renderEs(<InboxPage />);
    await user.click(await screen.findByRole('button', { name: /Iris Demo/ }));
    await user.click(await screen.findByRole('button', { name: 'Vincular' }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Qué vincular'), 'contract');
    expect(await within(dialog).findByRole('button', { name: /ct2abcde/ })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /Depto Norte/ }));
    await waitFor(() => expect(calls('PUT /conversations/c1/links')).toHaveLength(1));
    expect(JSON.parse(calls('PUT /conversations/c1/links')[0][1].body)).toEqual({ related: { type: 'Contract', id: 'ct1' } });
    await user.click(await screen.findByRole('button', { name: 'Vincular' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Desvincular persona' }));
    await waitFor(() => expect(calls('PUT /conversations/c1/links')).toHaveLength(2));
    expect(JSON.parse(calls('PUT /conversations/c1/links')[1][1].body)).toEqual({ personId: null });
  });

  it('sin persona vinculada pide vincularla antes de elegir un contrato', async () => {
    route();
    const user = userEvent.setup();
    renderEs(<InboxPage />);
    await user.click(await screen.findByRole('button', { name: /Iris Demo/ }));
    await user.click(await screen.findByRole('button', { name: 'Vincular' }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Qué vincular'), 'contract');
    expect(within(dialog).getByText('Para vincular un contrato, primero vinculá a la persona.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Contador de la bandeja en el menú', () => {
  it('muestra los sin leer y se pinta distinto si hay plazos vencidos', async () => {
    route({ summary: { unread: 120, breached: 0, unassigned: 0 } });
    renderEs(<InboxNavBadge />);
    expect(await screen.findByRole('status')).toHaveTextContent('99+');
  });

  it('sin sin leer o sin permiso no muestra nada', async () => {
    route({ summary: { unread: 0, breached: 0, unassigned: 0 } });
    const first = renderEs(<InboxNavBadge />);
    await act(async () => {});
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    first.unmount();
    auth.role = 'Lectura';
    renderEs(<InboxNavBadge floating />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('Configuración de la bandeja', () => {
  it('carga la configuración, la edita y la guarda', async () => {
    route();
    const user = userEvent.setup();
    renderEs(<InboxSettingsPage />);
    const minutes = await screen.findByLabelText('Minutos');
    expect(minutes).toHaveValue(15);
    await user.clear(minutes);
    await user.type(minutes, '30');
    await user.click(screen.getByLabelText('Mié'));
    await user.click(screen.getByLabelText('Sáb'));
    await user.clear(screen.getByLabelText('Desde (hora)'));
    await user.type(screen.getByLabelText('Desde (hora)'), '8');
    await user.clear(screen.getByLabelText('Hasta (hora)'));
    await user.type(screen.getByLabelText('Hasta (hora)'), '20');
    await user.clear(screen.getByLabelText('Ventana del hilo (horas)'));
    await user.type(screen.getByLabelText('Ventana del hilo (horas)'), '48');
    await user.selectOptions(screen.getByLabelText('Responsable por defecto'), '11111111-1111-4111-8111-111111111111');
    const wa = screen.getByLabelText('Texto para WhatsApp');
    await user.clear(wa);
    await user.type(wa, 'Hola, ya te leemos');
    await user.click(screen.getByRole('button', { name: 'Agregar respuesta rápida' }));
    await user.click(screen.getAllByRole('button', { name: 'Quitar' })[0]);
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(calls('PUT /conversations/settings')).toHaveLength(1));
    const body = JSON.parse(calls('PUT /conversations/settings')[0][1].body);
    expect(body).toMatchObject({
      slaMinutes: 30,
      threadWindowHours: 48,
      defaultAssigneeUserId: '11111111-1111-4111-8111-111111111111',
      businessHours: { fromHour: 8, untilHour: 20, days: [1, 2, 4, 5, 6] },
      autoreply: { enabled: true, texts: { WhatsApp: 'Hola, ya te leemos' } },
    });
    expect(body.quickReplies).toHaveLength(1);
    expect(body.quickReplies[0]).toMatchObject({ id: 'nueva-respuesta', title: 'Nueva respuesta' });
    expect(toastSuccess).toHaveBeenCalledWith('Configuración guardada.');
  });

  it('apagar el horario o la autorrespuesta oculta sus campos; un valor inválido no se manda', async () => {
    route();
    const user = userEvent.setup();
    renderEs(<InboxSettingsPage />);
    const minutes = await screen.findByLabelText('Minutos');
    await user.click(screen.getByLabelText('Contar el plazo sólo dentro del horario de atención'));
    expect(screen.queryByLabelText('Desde (hora)')).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('Responder automáticamente la primera vez'));
    expect(screen.queryByLabelText('Texto para WhatsApp')).not.toBeInTheDocument();
    await user.clear(minutes);
    await user.type(minutes, '0');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(calls('PUT /conversations/settings')).toHaveLength(0);
  });

  it('un error al guardar o al cargar se muestra; sin permiso sólo lee el aviso', async () => {
    route({ fail: { 'PUT /conversations/settings': new ApiRequestError(400, 'X', 'No se pudo guardar') } });
    const user = userEvent.setup();
    const first = renderEs(<InboxSettingsPage />);
    await screen.findByLabelText('Minutos');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText(/No se pudo guardar/)).toBeInTheDocument();
    first.unmount();

    route({ fail: { 'GET /conversations/settings': new ApiRequestError(500, 'ERR_500', 'Falló la carga') } });
    const second = renderEs(<InboxSettingsPage />);
    expect(await screen.findByText(/Falló la carga/)).toBeInTheDocument();
    second.unmount();

    auth.role = 'Ventas';
    renderEs(<InboxSettingsPage />);
    expect(screen.getByText('Sólo Admin y Gerente pueden cambiar la configuración de la bandeja.')).toBeInTheDocument();
  });
});
