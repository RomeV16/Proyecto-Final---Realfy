// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEsWithQuery } from '../index-data/test-utils';
import type { KeyMovement, KeyOut, KeySet } from '@/lib/sales';

const { apiClient, auth } = vi.hoisted(() => ({ apiClient: vi.fn(), auth: { role: 'Admin' } }));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u1', role: auth.role } }),
  useOptionalAuth: () => ({ user: { id: 'u1', role: auth.role } }),
}));
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { KeysOutList } from './keys-out-list';
import { PropertyKeysCard } from './property-keys-card';

const PROPERTY_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '55555555-5555-4555-8555-555555555555';

const movement = (over: Partial<KeyMovement> = {}): KeyMovement => ({
  id: 'mv-1',
  holder: 'Empleado',
  holderName: null,
  holderPerson: null,
  holderUser: { id: USER_ID, firstName: 'Vera', lastName: 'Vendedora' },
  reason: 'Visita con interesado',
  outAt: '2026-11-05T00:00:00.000Z',
  expectedReturnAt: '2026-11-08T00:00:00.000Z',
  returnedAt: null,
  notes: null,
  ...over,
});

const keySet = (over: Partial<KeySet> = {}): KeySet => ({
  id: 'k1',
  label: 'Principal',
  copies: 2,
  holder: 'Oficina',
  holderName: null,
  holderPerson: null,
  holderUser: null,
  location: 'Caja fuerte, gancho 4',
  isActive: true,
  overdue: false,
  daysOverdue: 0,
  openMovement: null,
  movements: [],
  ...over,
});

const writes = () => apiClient.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET');
const lastWrite = () => {
  const [path, init] = writes().at(-1)!;
  return { path: path as string, method: init.method as string, body: JSON.parse(init.body) };
};
const dialog = () => within(screen.getByRole('dialog'));

function setupCard(sets: KeySet[], role = 'Admin', staff = [{ id: USER_ID, firstName: 'Vera', lastName: 'Vendedora', status: 'active', email: 'v@x.test', role: 'Ventas' }]) {
  auth.role = role;
  apiClient.mockReset();
  apiClient.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path === '/users') return staff;
    if (path === `/properties/${PROPERTY_ID}/keys` && !init?.method) return { items: sets };
    return {};
  });
  renderEsWithQuery(<PropertyKeysCard propertyId={PROPERTY_ID} />);
}

beforeEach(() => {
  apiClient.mockReset();
});

describe('Llaves de la propiedad', () => {
  it('muestra cada juego: en la oficina con su lugar y fuera con quién las tiene, desde cuándo y el atraso', async () => {
    setupCard([
      keySet(),
      keySet({
        id: 'k2',
        label: 'Cochera',
        copies: 1,
        holder: 'Empleado',
        holderUser: { id: USER_ID, firstName: 'Vera', lastName: 'Vendedora' },
        overdue: true,
        daysOverdue: 3,
        openMovement: movement(),
        movements: [movement(), movement({ id: 'mv-0', returnedAt: '2026-11-01T00:00:00.000Z', reason: null, holder: 'Tercero', holderUser: null, holderName: 'Plomero' })],
      }),
    ]);
    expect(await screen.findByText('Principal')).toBeInTheDocument();
    expect(screen.getByText('En la oficina')).toBeInTheDocument();
    expect(screen.getByText('Guardadas en: Caja fuerte, gancho 4')).toBeInTheDocument();
    expect(screen.getByText('2 copias')).toBeInTheDocument();
    expect(screen.getByText('Empleado: Vera Vendedora')).toBeInTheDocument();
    expect(screen.getByText('Atrasadas 3 d')).toBeInTheDocument();
    expect(screen.getByText('Historial (2)')).toBeInTheDocument();
    expect(screen.getByText(/sigue afuera/)).toBeInTheDocument();
    expect(screen.getByText(/Plomero/)).toBeInTheDocument();
  });

  it('sin juegos avisa y ofrece cargar uno', async () => {
    setupCard([]);
    expect(await screen.findByText('Todavía no hay llaves cargadas para esta propiedad.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Agregar juego de llaves' }));
    await screen.findByRole('dialog');
    await userEvent.type(dialog().getByLabelText(/^Nombre del juego/), 'Baulera');
    await userEvent.selectOptions(dialog().getByLabelText(/^Quién las tiene/), 'Propietario');
    await userEvent.type(dialog().getByLabelText(/^Nombre de quien las tiene/), 'Luis Locador');
    await userEvent.click(dialog().getByRole('button', { name: 'Guardar' }));
    await waitFor(() =>
      expect(lastWrite()).toMatchObject({
        path: `/properties/${PROPERTY_ID}/keys`,
        method: 'POST',
        body: { label: 'Baulera', copies: 1, holder: 'Propietario', holderName: 'Luis Locador', location: null },
      }),
    );
  });

  it('un juego en la oficina sale a un empleado con motivo y fecha de vuelta', async () => {
    setupCard([keySet()]);
    await userEvent.click(await screen.findByRole('button', { name: 'Registrar salida' }));
    await screen.findByRole('dialog');
    await waitFor(() => expect(dialog().getByLabelText(/^Empleado/)).toBeInTheDocument());
    await userEvent.selectOptions(dialog().getByLabelText(/^Empleado/), USER_ID);
    await userEvent.type(dialog().getByLabelText(/^Para qué/), 'Visita');
    await userEvent.type(dialog().getByLabelText(/^Fecha en que deberían volver/), '2026-11-12');
    await userEvent.click(dialog().getByRole('button', { name: 'Registrar salida' }));
    await waitFor(() =>
      expect(lastWrite()).toMatchObject({
        path: '/keys/k1/check-out',
        method: 'POST',
        body: { holder: 'Empleado', holderUserId: USER_ID, reason: 'Visita', expectedReturnAt: '2026-11-12' },
      }),
    );
  });

  it('a un tercero se le anota el nombre; sin personal cargado el empleado también', async () => {
    setupCard([keySet()], 'Ventas', []);
    await userEvent.click(await screen.findByRole('button', { name: 'Registrar salida' }));
    await screen.findByRole('dialog');
    await userEvent.type(dialog().getByLabelText(/^Nombre de quien las tiene/), 'Escribana Gómez');
    await userEvent.selectOptions(dialog().getByLabelText(/^Quién las tiene/), 'Tercero');
    await userEvent.click(dialog().getByRole('button', { name: 'Registrar salida' }));
    await waitFor(() => expect(lastWrite().body).toMatchObject({ holder: 'Tercero', holderName: 'Escribana Gómez', expectedReturnAt: null }));
  });

  it('la devolución cierra la salida y puede anotar dónde queda guardado', async () => {
    setupCard([keySet({ holder: 'Empleado', openMovement: movement() })]);
    await userEvent.click(await screen.findByRole('button', { name: 'Registrar devolución' }));
    await screen.findByRole('dialog');
    await userEvent.type(dialog().getByLabelText(/^Dónde se guardan/), 'Gancho 5');
    await userEvent.click(dialog().getByRole('button', { name: 'Registrar devolución' }));
    await waitFor(() => expect(lastWrite()).toMatchObject({ path: '/keys/k1/check-in', method: 'POST', body: { location: 'Gancho 5' } }));
  });

  it('un juego dado de baja no ofrece movimientos y Lectura no puede cargar nada', async () => {
    setupCard([keySet({ isActive: false })], 'Lectura');
    expect(await screen.findByText('Dado de baja')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Registrar salida' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Agregar juego de llaves' })).not.toBeInTheDocument();
  });

  it('Liquidaciones no ve las llaves', () => {
    setupCard([keySet()], 'Liquidaciones');
    expect(screen.queryByText('Principal')).not.toBeInTheDocument();
    expect(apiClient).not.toHaveBeenCalled();
  });
});

const out = (over: Partial<KeyOut> = {}): KeyOut => ({
  ...movement(),
  overdue: false,
  daysOverdue: 0,
  keySet: { id: 'k2', label: 'Cochera', copies: 1, propertyId: PROPERTY_ID, property: { id: PROPERTY_ID, title: 'Depto Sintético', street: 'Calle Ficticia', number: '100' } },
  ...over,
});

function setupOut(items: KeyOut[], role = 'Admin') {
  auth.role = role;
  apiClient.mockReset();
  apiClient.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path.startsWith('/keys/out')) return { items, total: items.length, page: 1, limit: 50, totalPages: 1 };
    if (path === '/users') return [];
    if (init?.method) return {};
    throw new Error(`ruta inesperada ${path}`);
  });
  renderEsWithQuery(<KeysOutList />);
}

describe('Llaves fuera', () => {
  it('lista las salidas con quién las tiene y marca las atrasadas', async () => {
    setupOut([out({ overdue: true, daysOverdue: 3 }), out({ id: 'mv-2', holderUser: null, holderName: 'Plomero', holder: 'Tercero', reason: null, expectedReturnAt: null })]);
    const table = within(await screen.findByRole('table'));
    expect(table.getByText('Vera Vendedora')).toBeInTheDocument();
    expect(table.getByText('Atrasadas 3 d')).toBeInTheDocument();
    expect(table.getByText('Plomero')).toBeInTheDocument();
    expect(table.getAllByRole('link', { name: 'Depto Sintético · Calle Ficticia 100' })[0]).toHaveAttribute('href', `/properties/${PROPERTY_ID}`);
  });

  it('los filtros viajan a la API', async () => {
    setupOut([out()]);
    await screen.findByRole('table');
    await userEvent.selectOptions(screen.getByLabelText('Quién las tiene'), 'Tercero');
    await userEvent.selectOptions(screen.getByLabelText('Atraso'), 'true');
    await waitFor(() => {
      const last = apiClient.mock.calls.at(-1)![0] as string;
      expect(last).toContain('holder=Tercero');
      expect(last).toContain('overdue=true');
    });
  });

  it('registra la devolución desde la lista', async () => {
    setupOut([out()]);
    await userEvent.click((await screen.findAllByRole('button', { name: 'Registrar devolución' }))[0]);
    await screen.findByRole('dialog');
    await userEvent.click(dialog().getByRole('button', { name: 'Registrar devolución' }));
    await waitFor(() => expect(lastWrite()).toMatchObject({ path: '/keys/k2/check-in', method: 'POST' }));
  });

  it('Lectura ve la lista sin el botón de devolución; sin permiso avisa', async () => {
    setupOut([out()], 'Lectura');
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: 'Registrar devolución' })).not.toBeInTheDocument();
  });

  it('Liquidaciones no entra', () => {
    setupOut([], 'Liquidaciones');
    expect(screen.getByText('No tenés permiso para ver las llaves.')).toBeInTheDocument();
  });
});
