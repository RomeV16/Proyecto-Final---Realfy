// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '../index-data/test-utils';

const { apiClient, auth, toastSuccess } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  auth: { role: 'Liquidaciones' },
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
  usePathname: () => '/es/caja',
}));

import { ApiRequestError } from '@/lib/api-client';
import { SendDocument } from './send-document';

const RECEIPT = '22222222-2222-4222-8222-222222222222';

const queued = (o: Record<string, unknown> = {}) => ({
  id: 'm-new',
  channel: 'WhatsApp',
  personId: 'pe-1',
  personName: 'Ana Prueba',
  to: '5491100000000',
  templateKey: 'receipt',
  vars: {},
  status: 'Blocked',
  statusReason: 'NO_OPT_IN',
  error: null,
  attempts: 0,
  nextAttemptAt: null,
  scheduledAt: '2026-11-02T13:00:00.000Z',
  sentAt: null,
  deliveredAt: null,
  relatedType: 'Receipt',
  relatedId: RECEIPT,
  createdAt: '2026-11-02T13:00:00.000Z',
  ...o,
});

interface Setup {
  history?: unknown[];
  failHistory?: boolean;
  send?: (body: Record<string, unknown>) => unknown;
}

function mockApi({ history = [], failHistory, send }: Setup = {}) {
  apiClient.mockImplementation(async (path: string, init?: { method?: string; body?: string }) => {
    if (path === '/outbox/send') {
      const body = JSON.parse(init?.body ?? '{}');
      return send ? send(body) : queued({ channel: body.channel });
    }
    if (path.startsWith('/outbox?')) {
      if (failHistory) throw new ApiRequestError(500, 'INTERNAL_ERROR', 'boom');
      return { items: history, total: history.length, page: 1, limit: 20, totalPages: 1 };
    }
    throw new Error(`unexpected ${path}`);
  });
}

const dialog = () => within(screen.getByRole('dialog'));

beforeEach(() => {
  apiClient.mockReset();
  toastSuccess.mockReset();
  auth.role = 'Liquidaciones';
});

describe('SendDocument', () => {
  it.each(['Lectura', 'Ventas', 'Soporte'])('%s no ve el botón', (role) => {
    auth.role = role;
    renderEs(<SendDocument kind="Receipt" id={RECEIPT} />);
    expect(screen.queryByRole('button', { name: 'Enviar' })).not.toBeInTheDocument();
  });

  it('abre el diálogo con los mensajes del documento y el enlace a la bandeja', async () => {
    mockApi({ history: [queued({ id: 'm-old', channel: 'Email', to: 'ana@example.test', status: 'Delivered', statusReason: null })] });
    const user = userEvent.setup();
    renderEs(<SendDocument kind="Receipt" id={RECEIPT} />);
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(dialog().getByRole('heading', { name: 'Enviar el recibo' })).toBeInTheDocument();
    expect((await dialog().findAllByText('ana@example.test')).length).toBeGreaterThan(0);
    expect(dialog().getAllByText('Entregado').length).toBeGreaterThan(0);
    expect(apiClient).toHaveBeenCalledWith(`/outbox?relatedType=Receipt&relatedId=${RECEIPT}&page=1&limit=20`);
    expect(dialog().getByRole('link', { name: 'Ver en la bandeja de salida' })).toHaveAttribute(
      'href',
      `/es/mensajeria?relatedType=Receipt&relatedId=${RECEIPT}`,
    );
  });

  it('manda por WhatsApp y muestra cómo quedó el mensaje y por qué', async () => {
    mockApi();
    const user = userEvent.setup();
    renderEs(<SendDocument kind="Receipt" id={RECEIPT} />);
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await dialog().findByText('Todavía no se mandó por ningún canal.')).toBeInTheDocument();
    await user.click(dialog().getByRole('button', { name: 'Enviar por WhatsApp' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Mensaje en la bandeja de salida'));
    expect(apiClient).toHaveBeenCalledWith('/outbox/send', {
      method: 'POST',
      body: JSON.stringify({ kind: 'Receipt', id: RECEIPT, channel: 'WhatsApp' }),
    });
    const last = within(dialog().getByRole('region', { name: 'Último envío' }));
    expect(last.getByText('Bloqueado')).toBeInTheDocument();
    expect(last.getByText(/5491100000000/)).toBeInTheDocument();
    expect(last.getByText('WhatsApp necesita el alta explícita de la persona y no está registrada.')).toBeInTheDocument();
    // Vuelve a leer los mensajes del documento.
    expect(apiClient.mock.calls.filter(([p]) => String(p).startsWith('/outbox?'))).toHaveLength(2);
  });

  it('un estado de cuenta se manda por mail con su tipo', async () => {
    mockApi();
    const user = userEvent.setup();
    renderEs(<SendDocument kind="OwnerStatement" id="st-1" size="md" />);
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(dialog().getByRole('heading', { name: 'Enviar el estado de cuenta' })).toBeInTheDocument();
    await user.click(dialog().getByRole('button', { name: 'Enviar por mail' }));
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith('/outbox/send', {
        method: 'POST',
        body: JSON.stringify({ kind: 'OwnerStatement', id: 'st-1', channel: 'Email' }),
      }),
    );
    expect(await dialog().findByRole('region', { name: 'Último envío' })).toBeInTheDocument();
  });

  it('el error de la API se explica con el texto del código', async () => {
    mockApi({
      send: () => {
        throw new ApiRequestError(422, 'NO_CONTACT_ADDRESS', 'sin dirección');
      },
    });
    const user = userEvent.setup();
    renderEs(<SendDocument kind="Receipt" id={RECEIPT} />);
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    await user.click(dialog().getByRole('button', { name: 'Enviar por mail' }));
    expect(await dialog().findByRole('alert')).toHaveTextContent(
      'La persona no tiene cargado un mail o un celular para ese canal: completalo en su ficha.',
    );
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('si no se pueden leer los mensajes del documento lo avisa y cerrar quita el diálogo', async () => {
    mockApi({ failHistory: true });
    const user = userEvent.setup();
    renderEs(<SendDocument kind="Receipt" id={RECEIPT} />);
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await dialog().findByRole('alert')).toHaveTextContent('INTERNAL_ERROR');
    await user.click(dialog().getByRole('button', { name: 'Cerrar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
