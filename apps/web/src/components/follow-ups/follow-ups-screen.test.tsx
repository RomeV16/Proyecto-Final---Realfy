// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '../index-data/test-utils';

const { apiClient, auth, toastSuccess, search } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  search: { value: '' },
  auth: { role: 'Admin' },
  toastSuccess: vi.fn(),
}));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u1', firstName: 'Usuario', lastName: 'Demo', role: auth.role } }),
  useOptionalAuth: () => ({ user: { id: 'u1', firstName: 'Usuario', lastName: 'Demo', role: auth.role } }),
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useSearchParams: () => new URLSearchParams(search.value),
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
import FollowUpsPage from '@/app/[locale]/(app)/vencimientos/page';
import { FollowUpsScreen } from './follow-ups-screen';

const task = (id: string, code: string, label: string, done = false) => ({
  id,
  code,
  label,
  done,
  doneAt: null,
  doneById: null,
  dueDate: null,
});

const followUp = (id: string, o: Record<string, unknown> = {}) => ({
  id,
  contractId: `c-${id}`,
  kind: 'Renovacion',
  status: 'Abierto',
  outcome: 'Pendiente',
  dueDate: '2026-12-15T00:00:00.000Z',
  assigneeId: null,
  notes: null,
  closedAt: null,
  effectiveEnd: '2026-12-15T00:00:00.000Z',
  signedEnd: '2026-12-15T00:00:00.000Z',
  daysLeft: 43,
  light: 'yellow',
  property: 'Depto Sintético',
  tenantName: 'Inés Ficticia',
  tasks: [task('t1', 'VISITA', 'Visita y estado de la unidad'), task('t2', 'PRECIO', 'Precio nuevo acordado')],
  progress: { done: 0, total: 2 },
  ...o,
});

const paged = (items: unknown[], o: Record<string, unknown> = {}) => ({ items, total: items.length, page: 1, limit: 25, totalPages: 1, ...o });

const ITEMS = [
  followUp('a'),
  followUp('b', {
    property: 'Casa Prueba',
    tenantName: 'Beto Prueba',
    light: 'expired',
    daysLeft: -10,
    assigneeId: 'u1',
    effectiveEnd: '2027-03-31T00:00:00.000Z',
    signedEnd: '2026-10-01T00:00:00.000Z',
  }),
];

function setup(list: unknown = paged(ITEMS), write?: (path: string, init: { method: string; body: string }) => unknown) {
  apiClient.mockImplementation(async (path: string, init?: { method?: string; body: string }) => {
    if (init?.method) return write ? write(path, init as { method: string; body: string }) : {};
    if (path.startsWith('/follow-ups?')) {
      if (list instanceof Error) throw list;
      return list;
    }
    if (path === '/users') return { items: [{ id: 'u2', firstName: 'Beatriz', lastName: 'Gerente' }] };
    throw new Error(`unexpected ${path}`);
  });
  return renderEs(<FollowUpsScreen />);
}

const writes = () => apiClient.mock.calls.filter(([, init]) => init?.method);
const lastUrl = () => apiClient.mock.calls.filter(([p]) => String(p).startsWith('/follow-ups?')).at(-1)![0] as string;

beforeEach(() => {
  apiClient.mockReset();
  toastSuccess.mockReset();
  auth.role = 'Admin';
  search.value = '';
});

describe('Vencimientos', () => {
  it('lista los seguimientos con el semáforo, los días y el avance', async () => {
    setup();
    expect((await screen.findAllByText('Depto Sintético')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Casa Prueba').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Por vencer').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Vencido').length).toBeGreaterThan(0);
    expect(screen.getAllByText('0/2').length).toBeGreaterThan(1);
    // El fin real distinto del pactado se marca como prórroga de palabra.
    expect(screen.getAllByText(/prórroga de palabra/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('yo').length).toBeGreaterThan(0);
    expect(lastUrl()).toContain('status=Abierto');
  });

  it('con ?contractId= (desde calidad de datos) muestra solo el seguimiento de ese contrato', async () => {
    search.value = 'contractId=c-a';
    setup();
    await screen.findAllByText('Depto Sintético');
    expect(lastUrl()).toContain('contractId=c-a');
  });

  it('la página monta la pantalla', async () => {
    setup();
    renderEs(<FollowUpsPage />);
    expect((await screen.findAllByText('Depto Sintético')).length).toBeGreaterThan(0);
  });

  it('los filtros viajan a la API y el estado se apaga al filtrar por color', async () => {
    const user = userEvent.setup();
    setup();
    await screen.findAllByText('Depto Sintético');

    await user.selectOptions(screen.getByLabelText('Semáforo'), 'red');
    await waitFor(() => expect(lastUrl()).toContain('light=red'));
    expect(lastUrl()).not.toContain('status=');
    expect(screen.getByLabelText('Estado')).toBeDisabled();

    await user.selectOptions(screen.getByLabelText('Semáforo'), '');
    await user.selectOptions(screen.getByLabelText('Tipo'), 'Devolucion');
    await waitFor(() => expect(lastUrl()).toContain('kind=Devolucion'));
    await user.selectOptions(screen.getByLabelText('Estado'), 'Cerrado');
    await waitFor(() => expect(lastUrl()).toContain('status=Cerrado'));
    await user.click(screen.getByLabelText('Solo los míos'));
    await waitFor(() => expect(lastUrl()).toContain('assigneeId=u1'));
  });

  it('muestra el vacío y el error de la carga', async () => {
    setup(paged([]));
    expect((await screen.findAllByText('No hay seguimientos')).length).toBeGreaterThan(0);
  });

  it('muestra el error cuando la API falla', async () => {
    setup(new ApiRequestError(500, 'INTERNAL_ERROR', 'boom'));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('pagina cuando hay más de una página', async () => {
    const user = userEvent.setup();
    setup(paged(ITEMS, { totalPages: 2, total: 40 }));
    await screen.findAllByText('Depto Sintético');
    await user.click(screen.getByRole('button', { name: /siguiente/i }));
    await waitFor(() => expect(lastUrl()).toContain('page=2'));
  });
});

describe('Seguimiento (cajón)', () => {
  async function open() {
    const user = userEvent.setup();
    const result = setup(paged(ITEMS), (path, init) => {
      const body = JSON.parse(init.body);
      if (path.includes('/tasks/')) {
        return followUp('a', {
          tasks: [task('t1', 'VISITA', 'Visita y estado de la unidad', body.done), task('t2', 'PRECIO', 'Precio nuevo acordado')],
          progress: { done: body.done ? 1 : 0, total: 2 },
        });
      }
      return followUp('a', {
        assigneeId: body.assigneeId ?? null,
        kind: body.kind ?? 'Renovacion',
        notes: body.notes ?? null,
        outcome: body.outcome ?? 'Pendiente',
        status: body.outcome && body.outcome !== 'Pendiente' ? 'Cerrado' : 'Abierto',
        light: body.outcome && body.outcome !== 'Pendiente' ? null : 'yellow',
      });
    });
    await screen.findAllByText('Depto Sintético');
    await user.click(screen.getAllByRole('button', { name: 'Abrir' })[0]);
    const dialog = await screen.findByRole('dialog');
    return { user, dialog: within(dialog), ...result };
  }

  it('muestra el checklist con los pasos traducidos y el avance', async () => {
    const { dialog } = await open();
    expect(dialog.getByText('Checklist')).toBeInTheDocument();
    expect(dialog.getByLabelText('Visita y estado de la unidad')).not.toBeChecked();
    expect(dialog.getByLabelText('Precio nuevo acordado')).toBeInTheDocument();
    expect(dialog.getByRole('link', { name: 'Ver el contrato' })).toHaveAttribute('href', '/contracts/c-a');
  });

  it('marca un paso y refleja el avance en la lista', async () => {
    const { user, dialog } = await open();
    await user.click(dialog.getByLabelText('Visita y estado de la unidad'));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][0]).toBe('/follow-ups/a/tasks/t1');
    expect(JSON.parse(writes()[0][1].body)).toEqual({ done: true });
    await waitFor(() => expect(dialog.getByLabelText('Visita y estado de la unidad')).toBeChecked());
    expect((await screen.findAllByText('1/2')).length).toBeGreaterThan(0);
  });

  it('asigna un responsable, también a uno de la lista de usuarios', async () => {
    const { user, dialog } = await open();
    await waitFor(() => expect(dialog.getByRole('option', { name: 'Beatriz Gerente' })).toBeInTheDocument());
    await user.selectOptions(dialog.getByLabelText('Responsable'), 'u2');
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(JSON.parse(writes()[0][1].body)).toEqual({ assigneeId: 'u2' });
    expect(toastSuccess).toHaveBeenCalledWith('Responsable guardado');
  });

  it('cambia el tipo a devolución', async () => {
    const { user, dialog } = await open();
    await user.selectOptions(dialog.getByLabelText('Qué se prepara'), 'Devolucion');
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(JSON.parse(writes()[0][1].body)).toEqual({ kind: 'Devolucion' });
  });

  it('guarda las notas solo cuando cambian', async () => {
    const { user, dialog } = await open();
    expect(dialog.queryByRole('button', { name: 'Guardar notas' })).not.toBeInTheDocument();
    await user.type(dialog.getByLabelText('Notas'), 'Llamar el lunes');
    await user.click(dialog.getByRole('button', { name: 'Guardar notas' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(JSON.parse(writes()[0][1].body)).toEqual({ notes: 'Llamar el lunes' });
  });

  it('cierra el seguimiento con un resultado', async () => {
    const { user, dialog } = await open();
    await user.selectOptions(dialog.getByLabelText('Resultado'), 'Renovado');
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(JSON.parse(writes()[0][1].body)).toEqual({ outcome: 'Renovado' });
    await waitFor(() => expect(dialog.getByLabelText('Responsable')).toBeDisabled());
  });

  it('muestra el error de la API y no pierde el cajón', async () => {
    const user = userEvent.setup();
    setup(paged(ITEMS), () => {
      throw new ApiRequestError(409, 'FOLLOW_UP_CLOSED', 'closed');
    });
    await screen.findAllByText('Depto Sintético');
    await user.click(screen.getAllByRole('button', { name: 'Abrir' })[0]);
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByLabelText('Precio nuevo acordado'));
    expect(await dialog.findByRole('alert')).toBeInTheDocument();
  });

  it('un rol sin permiso de edición lo ve en solo lectura', async () => {
    auth.role = 'Lectura';
    const user = userEvent.setup();
    setup();
    await screen.findAllByText('Depto Sintético');
    await user.click(screen.getAllByRole('button', { name: 'Abrir' })[0]);
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByLabelText('Visita y estado de la unidad')).toBeDisabled();
    expect(dialog.getByLabelText('Responsable')).toBeDisabled();
    expect(dialog.getByLabelText('Resultado')).toBeDisabled();
  });

  it('se cierra con el botón', async () => {
    const { user, dialog } = await open();
    await user.click(dialog.getByRole('button', { name: 'Cerrar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
