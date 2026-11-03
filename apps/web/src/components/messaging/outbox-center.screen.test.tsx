// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEsWithQuery } from '../index-data/test-utils';

const { apiClient, auth, search, toastSuccess, toastError } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  auth: { role: 'Admin' },
  search: { value: '' },
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
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a), info: vi.fn() },
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/es/mensajeria',
  useSearchParams: () => new URLSearchParams(search.value),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

import { ApiRequestError } from '@/lib/api-client';
import MessagingPage from '@/app/[locale]/(app)/mensajeria/page';
import LoadingMessaging from '@/app/[locale]/(app)/mensajeria/loading';
import ErrorMessaging from '@/app/[locale]/(app)/mensajeria/error';
import NotFoundMessaging from '@/app/[locale]/(app)/mensajeria/not-found';
import { SegmentError, SegmentLoading, SegmentNotFound } from '@/components/ui/segment-states';

const PERSON = '66666666-6666-4666-8666-666666666666';

function message(id: string, o: Record<string, unknown> = {}) {
  return {
    id,
    channel: 'Email',
    personId: PERSON,
    personName: 'Ana Prueba',
    to: 'ana@example.test',
    templateKey: 'receipt',
    vars: {},
    status: 'Sent',
    statusReason: null,
    error: null,
    attempts: 1,
    nextAttemptAt: null,
    scheduledAt: '2026-11-02T13:00:00.000Z',
    sentAt: '2026-11-02T13:00:05.000Z',
    deliveredAt: null,
    relatedType: 'Receipt',
    relatedId: 'r-1',
    createdAt: '2026-11-02T13:00:00.000Z',
    ...o,
  };
}

const ITEMS = [
  message('m1'),
  message('m2', { status: 'Failed', error: 'mailbox full', attempts: 5, relatedType: 'OwnerStatement', relatedId: 'st-1', templateKey: 'owner_statement' }),
  message('m3', { status: 'Blocked', statusReason: 'NO_OPT_IN', channel: 'WhatsApp', to: '5491100000000', relatedType: 'UserInvitation' }),
  message('m4', { status: 'Pending', statusReason: 'QUIET_HOURS', personId: null, personName: null, relatedType: null, relatedId: null, templateKey: 'algo_nuevo' }),
];

interface Setup {
  items?: unknown[];
  fail?: boolean;
  totalPages?: number;
  write?: (path: string) => unknown;
}

function mockApi({ items = ITEMS, fail, totalPages = 1, write }: Setup = {}) {
  apiClient.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (init?.method) return write ? write(path) : message('x');
    if (path.startsWith('/outbox?')) {
      if (fail) throw new ApiRequestError(500, 'INTERNAL_ERROR', 'boom');
      return { items, total: items.length, page: 1, limit: 50, totalPages };
    }
    throw new Error(`unexpected ${path}`);
  });
}

const lastQuery = () => apiClient.mock.calls.filter(([p, init]) => !init && String(p).startsWith('/outbox?')).at(-1)?.[0] as string;
const lastDialog = () => screen.getAllByRole('dialog').at(-1)!;

beforeEach(() => {
  apiClient.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  auth.role = 'Admin';
  search.value = '';
});

describe('Mensajería: bandeja de salida', () => {
  it('lista los mensajes con destinatario, canal, plantilla, documento, estado y motivo', async () => {
    mockApi();
    renderEsWithQuery(<MessagingPage />);
    expect(await screen.findByRole('heading', { name: 'Mensajería' })).toBeInTheDocument();
    await screen.findAllByText('ana@example.test');
    expect(lastQuery()).toBe('/outbox?page=1&limit=50');
    expect(screen.getAllByText('Recibo de cobro').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Enviado').length).toBeGreaterThan(0);
    expect(screen.getAllByText('El proveedor respondió: mailbox full').length).toBeGreaterThan(0);
    expect(screen.getAllByText('WhatsApp necesita el alta explícita de la persona y no está registrada.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Fuera del horario de envío: sale cuando abra.').length).toBeGreaterThan(0);
    // Una plantilla que la web no conoce se muestra tal cual; sin persona, el aviso.
    expect(screen.getAllByText('algo_nuevo').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Sin persona').length).toBeGreaterThan(0);
    // El estado de cuenta enlaza a su pantalla; la invitación no tiene una.
    expect(screen.getAllByRole('link', { name: 'Estado de cuenta' })[0]).toHaveAttribute('href', '/es/estados-de-cuenta/st-1');
    expect(screen.getAllByText('Invitación').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Ana Prueba' })[0]).toHaveAttribute('href', `/es/persons/${PERSON}`);
    expect(screen.getByRole('link', { name: 'Configuración de mensajería' })).toHaveAttribute('href', '/es/configuracion/mensajeria');
  });

  it('ofrece reintentar y cancelar solo en los estados permitidos', async () => {
    mockApi();
    renderEsWithQuery(<MessagingPage />);
    await screen.findAllByText('ana@example.test');
    // Fallido y bloqueado se reintentan; pendiente y bloqueado se cancelan (tabla y tarjetas: x2).
    expect(screen.getAllByRole('button', { name: 'Reintentar' })).toHaveLength(4);
    expect(screen.getAllByRole('button', { name: 'Cancelar' })).toHaveLength(4);
  });

  it('reintenta con confirmación, avisa y vuelve a leer la lista', async () => {
    mockApi();
    const user = userEvent.setup();
    renderEsWithQuery(<MessagingPage />);
    await screen.findAllByText('ana@example.test');
    const before = apiClient.mock.calls.length;
    await user.click(screen.getAllByRole('button', { name: 'Reintentar' })[0]);
    expect(within(lastDialog()).getByText(/El mensaje a ana@example.test vuelve a la cola/)).toBeInTheDocument();
    await user.click(within(lastDialog()).getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('El mensaje volvió a la cola'));
    expect(apiClient).toHaveBeenCalledWith('/outbox/m2/retry', { method: 'POST' });
    await waitFor(() => expect(apiClient.mock.calls.length).toBeGreaterThan(before + 1));
  });

  it('volver en la confirmación no cancela nada', async () => {
    mockApi();
    const user = userEvent.setup();
    renderEsWithQuery(<MessagingPage />);
    await screen.findAllByText('ana@example.test');
    await user.click(screen.getAllByRole('button', { name: 'Cancelar' })[0]);
    await user.click(within(lastDialog()).getByRole('button', { name: 'Volver' }));
    expect(apiClient.mock.calls.some(([, init]) => init?.method)).toBe(false);
  });

  it('un error al cancelar se muestra con el texto del código', async () => {
    mockApi({
      write: () => {
        throw new ApiRequestError(409, 'MESSAGE_NOT_CANCELLABLE', 'no');
      },
    });
    const user = userEvent.setup();
    renderEsWithQuery(<MessagingPage />);
    await screen.findAllByText('ana@example.test');
    await user.click(screen.getAllByRole('button', { name: 'Cancelar' })[0]);
    await user.click(within(lastDialog()).getByRole('button', { name: 'Cancelar el mensaje' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Solo se cancela un mensaje pendiente o bloqueado.'));
    expect(apiClient).toHaveBeenCalledWith('/outbox/m3/cancel', { method: 'POST' });
  });

  it.each(['Liquidaciones', 'Lectura', 'Ventas', 'Soporte'])('%s ve la bandeja sin acciones ni configuración', async (role) => {
    auth.role = role;
    mockApi();
    renderEsWithQuery(<MessagingPage />);
    await screen.findAllByText('ana@example.test');
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Configuración de mensajería' })).not.toBeInTheDocument();
  });

  it('Marketing no ve la bandeja ni la consulta', () => {
    auth.role = 'Marketing';
    mockApi();
    renderEsWithQuery(<MessagingPage />);
    expect(screen.getByText('Tu rol no tiene acceso a la bandeja de salida.')).toBeInTheDocument();
  });

  it('filtra por estado y canal', async () => {
    mockApi();
    const user = userEvent.setup();
    renderEsWithQuery(<MessagingPage />);
    await screen.findAllByText('ana@example.test');
    await user.selectOptions(screen.getByLabelText('Estado'), 'Failed');
    await waitFor(() => expect(lastQuery()).toBe('/outbox?page=1&limit=50&status=Failed'));
    await user.selectOptions(screen.getByLabelText('Canal'), 'WhatsApp');
    await waitFor(() => expect(lastQuery()).toBe('/outbox?page=1&limit=50&status=Failed&channel=WhatsApp'));
  });

  it('llega filtrada por persona desde la dirección y "Ver todos" quita el filtro', async () => {
    search.value = `personId=${PERSON}`;
    mockApi();
    const user = userEvent.setup();
    renderEsWithQuery(<MessagingPage />);
    expect(await screen.findByText('Mensajes de Ana Prueba')).toBeInTheDocument();
    expect(lastQuery()).toBe(`/outbox?page=1&limit=50&personId=${PERSON}`);
    await user.click(screen.getByRole('button', { name: 'Ver todos' }));
    await waitFor(() => expect(lastQuery()).toBe('/outbox?page=1&limit=50'));
    expect(screen.queryByText('Mensajes de Ana Prueba')).not.toBeInTheDocument();
  });

  it('filtrada por persona sin mensajes muestra el aviso genérico y el vacío', async () => {
    search.value = `personId=${PERSON}`;
    mockApi({ items: [] });
    renderEsWithQuery(<MessagingPage />);
    expect(await screen.findByText('Mensajes de una persona')).toBeInTheDocument();
    expect(await screen.findByText('No hay mensajes')).toBeInTheDocument();
  });

  it('llega filtrada por documento', async () => {
    search.value = 'relatedType=Receipt&relatedId=r-1';
    mockApi();
    renderEsWithQuery(<MessagingPage />);
    expect(await screen.findByText('Mensajes de un documento (Recibo)')).toBeInTheDocument();
    expect(lastQuery()).toBe('/outbox?page=1&limit=50&relatedType=Receipt&relatedId=r-1');
  });

  it('pagina cuando hay más de una página', async () => {
    mockApi({ totalPages: 3 });
    const user = userEvent.setup();
    renderEsWithQuery(<MessagingPage />);
    await screen.findAllByText('ana@example.test');
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    await waitFor(() => expect(lastQuery()).toBe('/outbox?page=2&limit=50'));
  });

  it('un error de la API se muestra en lugar de la lista', async () => {
    mockApi({ fail: true });
    renderEsWithQuery(<MessagingPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('INTERNAL_ERROR');
  });

  it('el segmento usa los estados compartidos', () => {
    expect(LoadingMessaging).toBe(SegmentLoading);
    expect(ErrorMessaging).toBe(SegmentError);
    expect(NotFoundMessaging).toBe(SegmentNotFound);
  });
});
