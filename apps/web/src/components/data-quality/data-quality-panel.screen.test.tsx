// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import es from '@/i18n/messages/es.json';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';

const { apiClient, auth, toastSuccess, toastError } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  auth: { role: 'Admin' },
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
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/es/calidad-de-datos',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/toast', () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a), info: vi.fn() },
}));

import { ApiRequestError } from '@/lib/api-client';
import { DATA_QUALITY_CHECKS } from '@realfy/shared';
import { DataQualityPanel } from './data-quality-panel';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const summary = (counts: Record<string, number>) => ({
  generatedAt: '2026-06-15T12:00:00.000Z',
  total: Object.values(counts).reduce((s, n) => s + n, 0),
  checks: DATA_QUALITY_CHECKS.map((c) => ({
    check: c.id,
    group: c.group,
    severity: c.id.startsWith('duplicate-') && c.id !== 'duplicate-cuit' ? 'warning' : 'error',
    count: counts[c.id] ?? 0,
  })),
});

const page = (check: string, items: unknown[], extra: Record<string, unknown> = {}) => ({
  check,
  items,
  total: items.length,
  page: 1,
  limit: 20,
  totalPages: 1,
  ...extra,
});

const dupFinding = {
  id: `duplicate-cuit:20123456786`,
  check: 'duplicate-cuit',
  severity: 'error',
  entityType: 'Person',
  entityId: A,
  label: 'Duplicada, Ana / Duplicada, Anita',
  fields: ['cuit'],
  link: `/persons/${A}`,
  members: [
    { id: A, label: 'Duplicada, Ana' },
    { id: B, label: 'Duplicada, Anita' },
  ],
  details: { value: '20123456786', count: 2 },
};

const sumFinding = {
  id: 'lessors-sum:c1',
  check: 'lessors-sum',
  severity: 'error',
  entityType: 'Contract',
  entityId: 'c1',
  label: 'Depto Rojo',
  fields: ['lessors'],
  link: '/contracts/c1',
  details: { sum: 70, lessors: 2 },
};

function routes(overrides: Record<string, unknown> = {}) {
  const table: Record<string, unknown> = {
    '/data-quality': summary({ 'duplicate-cuit': 1, 'lessors-sum': 1, 'ownership-sum': 1, 'contract-expired-undecided': 1 }),
    '/data-quality/duplicate-cuit?page=1&limit=20': page('duplicate-cuit', [dupFinding]),
    '/data-quality/lessors-sum?page=1&limit=20': page('lessors-sum', [sumFinding]),
    '/data-quality/ownership-sum?page=1&limit=20': page('ownership-sum', [
      { ...sumFinding, id: 'ownership-sum:p1', check: 'ownership-sum', entityType: 'Property', label: 'Casa Azul', link: '/properties/p1', details: { sum: 80, owners: 2, withoutShare: 1 } },
    ]),
    '/data-quality/contract-expired-undecided?page=1&limit=20': page('contract-expired-undecided', [
      { ...sumFinding, id: 'x:c2', check: 'contract-expired-undecided', label: 'Depto Viejo', details: { effectiveEnd: '2026-03-01' }, fields: ['status', 'endDate'] },
    ]),
    ...overrides,
  };
  apiClient.mockImplementation(async (path: string, init?: { method?: string; body?: string }) => {
    const value = table[`${init?.method ?? 'GET'} ${path}`] ?? table[path];
    if (value instanceof Error) throw value;
    if (typeof value === 'function') return value(init);
    if (value === undefined) throw new Error(`unexpected ${path}`);
    return value;
  });
}

function setup() {
  return render(
    <NextIntlClientProvider locale="es" messages={es}>
      <ConfirmProvider>
        <DataQualityPanel />
      </ConfirmProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = 'Admin';
});

describe('Calidad de datos', () => {
  it('muestra el resumen por control y abre el primero con hallazgos', async () => {
    routes();
    setup();

    expect(await screen.findByText('4 hallazgos para revisar')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Personas repetidas' })).toBeInTheDocument();
    const card = screen.getByRole('button', { name: /CUIT repetido/ });
    expect(card).toHaveAttribute('aria-pressed', 'true');
    expect(within(card).getByText('1')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: /Teléfono repetido/ })).getByText('0')).toBeInTheDocument();

    expect((await screen.findAllByText('Duplicada, Ana')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('2 personas').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Corregir').length).toBeGreaterThan(0);
  });

  it('cambiar de control pide sus hallazgos y explica el detalle de cada uno', async () => {
    routes();
    setup();
    const user = userEvent.setup();
    await screen.findAllByText('Duplicada, Ana');

    await user.click(screen.getByRole('button', { name: /Locadores que no suman 100 %/ }));
    expect((await screen.findAllByText('Depto Rojo')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Suman 70 % entre 2 locadores').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Abrir Depto Rojo' })[0]).toHaveAttribute('href', expect.stringContaining('/contracts/c1'));

    await user.click(screen.getByRole('button', { name: /Titulares que no suman 100 %/ }));
    expect((await screen.findAllByText(/Suman 80 % entre 2 titulares · 1 sin parte/)).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: /Vencidos sin decisión/ }));
    expect((await screen.findAllByText(/Venció el/)).length).toBeGreaterThan(0);
    expect(apiClient).toHaveBeenCalledWith('/data-quality/contract-expired-undecided?page=1&limit=20');
  });

  it('un control sin hallazgos muestra el estado vacío', async () => {
    routes({ '/data-quality': summary({}) });
    setup();
    expect(await screen.findByText('Sin hallazgos')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const user = userEvent.setup();
    routes({ '/data-quality': summary({}), '/data-quality/duplicate-email?page=1&limit=20': page('duplicate-email', []) });
    await user.click(screen.getByRole('button', { name: /Correo repetido/ }));
    expect((await screen.findAllByText('Nada para revisar')).length).toBeGreaterThan(0);
  });

  it('muestra el error si el resumen o los hallazgos no cargan', async () => {
    routes({ '/data-quality': new ApiRequestError(500, 'INTERNAL_ERROR', 'Falló el resumen') });
    setup();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('muestra el error de los hallazgos de un control', async () => {
    routes({ '/data-quality/duplicate-cuit?page=1&limit=20': new ApiRequestError(500, 'INTERNAL_ERROR', 'Falló el control') });
    setup();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('actualizar vuelve a pedir el resumen', async () => {
    routes();
    setup();
    const user = userEvent.setup();
    await screen.findAllByText('Duplicada, Ana');
    const before = apiClient.mock.calls.filter(([p]) => p === '/data-quality').length;
    await user.click(screen.getByRole('button', { name: 'Actualizar' }));
    await waitFor(() => expect(apiClient.mock.calls.filter(([p]) => p === '/data-quality').length).toBe(before + 1));
  });

  it('quien no puede verlo recibe el aviso y no se pide nada', () => {
    auth.role = 'Ventas';
    routes();
    setup();
    expect(screen.getByText('No tenés permiso para ver la calidad de los datos.')).toBeInTheDocument();
    expect(apiClient).not.toHaveBeenCalled();
  });

  it('el Gerente ve los hallazgos pero no puede unir personas', async () => {
    auth.role = 'Gerente';
    routes();
    setup();
    await screen.findAllByText('Duplicada, Ana');
    expect(screen.queryByRole('button', { name: 'Unir' })).not.toBeInTheDocument();
  });
});

describe('Unir personas repetidas', () => {
  const preview = {
    keepId: B,
    mergeIds: [A],
    items: [
      { entity: 'propertyOwnership', field: 'personId', count: 2 },
      { entity: 'contractLessor', field: 'personId', count: 1 },
      { entity: 'contractLessor', field: 'payeePersonId', count: 1 },
      { entity: 'ownerLedgerEntry', field: 'personId', count: 4 },
      { entity: 'ownerStatement', field: 'personId', count: 1 },
    ],
    discarded: [{ entity: 'personRoleAssignment', field: 'personId', count: 1 }],
  };

  async function openMerge() {
    const user = userEvent.setup();
    setup();
    await screen.findAllByText('Duplicada, Ana');
    await user.click(screen.getAllByRole('button', { name: 'Unir' })[0]);
    return user;
  }

  it('elige a quién conservar, muestra qué se mueve y une al confirmar', async () => {
    const merge = vi.fn().mockResolvedValue({ ...preview, merged: 1 });
    routes({
      'POST /data-quality/persons/merge/preview': preview,
      'POST /data-quality/persons/merge': (init: { body: string }) => merge(JSON.parse(init.body)),
    });
    const user = await openMerge();

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Elegí la persona que se conserva/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('radio', { name: /Duplicada, Anita/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Revisar qué se mueve' }));

    const confirm = await screen.findByText('Confirmar la unión');
    const body = confirm.closest('[role="dialog"]') as HTMLElement;
    expect(within(body).getByText(/Se conserva a Duplicada, Anita/)).toBeInTheDocument();
    expect(within(body).getByText('Titularidades: 2')).toBeInTheDocument();
    expect(within(body).getByText('Locadores de contratos: 2')).toBeInTheDocument();
    expect(within(body).getByText('Roles: 1')).toBeInTheDocument();
    expect(within(body).getByText('Movimientos de la cuenta corriente: 4')).toBeInTheDocument();
    expect(within(body).getByText('Estados de cuenta: 1')).toBeInTheDocument();
    expect(merge).not.toHaveBeenCalled();

    await user.click(within(body).getByRole('button', { name: 'Unir personas' }));
    await waitFor(() => expect(merge).toHaveBeenCalledWith({ keepId: B, mergeIds: [A] }));
    expect(toastSuccess).toHaveBeenCalledWith('Personas unidas.');
    // Después de unir, se vuelve a pedir el resumen.
    await waitFor(() => expect(apiClient.mock.calls.filter(([p]) => p === '/data-quality').length).toBeGreaterThan(1));
  });

  it('cancelar la confirmación no une', async () => {
    const merge = vi.fn();
    routes({
      'POST /data-quality/persons/merge/preview': { ...preview, items: [], discarded: [] },
      'POST /data-quality/persons/merge': () => merge(),
    });
    const user = await openMerge();
    await user.click(await screen.findByRole('button', { name: 'Revisar qué se mueve' }));
    const confirm = await screen.findByText('Confirmar la unión');
    const body = confirm.closest('[role="dialog"]') as HTMLElement;
    expect(within(body).getByText('Ninguna otra información apunta a las personas que se unen.')).toBeInTheDocument();
    await user.click(within(body).getByRole('button', { name: 'Cancelar' }));
    expect(merge).not.toHaveBeenCalled();
  });

  it('cerrar el diálogo de elección no pide nada', async () => {
    routes();
    const user = await openMerge();
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(apiClient.mock.calls.some(([p]) => String(p).includes('/merge'))).toBe(false);
  });

  it('un choque de datos (409) se explica y no une', async () => {
    routes({
      'POST /data-quality/persons/merge/preview': new ApiRequestError(409, 'MERGE_CONFLICT', 'No se pueden combinar', {
        error: 'MERGE_CONFLICT',
        conflicts: [{ entity: 'providerProfile', field: 'personId', count: 1 }],
      }),
    });
    const user = await openMerge();
    await user.click(await screen.findByRole('button', { name: 'Revisar qué se mueve' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringContaining('providerProfile')));
  });

  it('otro error de la API muestra su mensaje, y uno desconocido el genérico', async () => {
    routes({ 'POST /data-quality/persons/merge/preview': new ApiRequestError(500, 'INTERNAL_ERROR', 'Se cayó') });
    const user = await openMerge();
    await user.click(await screen.findByRole('button', { name: 'Revisar qué se mueve' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Se cayó'));

    routes({ 'POST /data-quality/persons/merge/preview': new Error('boom') });
    await user.click(await screen.findByRole('button', { name: 'Revisar qué se mueve' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('No se pudo unir a las personas.'));
  });
});
