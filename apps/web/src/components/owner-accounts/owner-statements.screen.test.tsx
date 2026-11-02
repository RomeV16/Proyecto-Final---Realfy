// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '../index-data/test-utils';

const { apiClient, auth, toastSuccess, toastError, downloadFile } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  auth: { role: 'Admin' },
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  downloadFile: vi.fn(),
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
vi.mock('@/lib/download', () => ({ downloadFile: (...a: unknown[]) => downloadFile(...a) }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useParams: () => ({ id: 'st-1' }),
  usePathname: () => '/es/estados-de-cuenta',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

import { ApiRequestError } from '@/lib/api-client';
import { OwnerStatements } from './owner-statements';
import { OwnerStatementDetail } from './owner-statement-detail';
import OwnerStatementsPage from '@/app/[locale]/(app)/estados-de-cuenta/page';
import OwnerStatementPage from '@/app/[locale]/(app)/estados-de-cuenta/[id]/page';

const ANA = '66666666-6666-4666-8666-666666666666';
const CAJA = '11111111-1111-4111-8111-111111111111';
const nb = (s: string | null) => (s ?? '').replaceAll(' ', ' ');

const summary = (id: string, o: Record<string, unknown> = {}) => ({
  id,
  personId: ANA,
  person: { id: ANA, name: 'Ana Locadora', cuit: '27-11111111-1', dni: null },
  period: '2026-10-01T00:00:00.000Z',
  currency: 'ARS',
  status: 'Borrador',
  opening: '-1500.00',
  credits: '100000.00',
  debits: '20200.00',
  payouts: '0.00',
  closing: '78300.00',
  issuedAt: null,
  sentAt: null,
  annulledAt: null,
  annulReason: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  ...o,
});

const line = (id: string, o: Record<string, unknown> = {}) => ({
  id,
  date: '2026-10-08T00:00:00.000Z',
  type: 'Alquiler',
  amount: '100000.00',
  description: 'Alquiler octubre de 2026',
  propertyId: 'p1',
  contractId: 'c1',
  groupLabel: 'Belgrano 100',
  ...o,
});

const detail = (o: Record<string, unknown> = {}) => ({
  ...summary('st-1'),
  from: '2026-10-01T00:00:00.000Z',
  to: '2026-10-31T00:00:00.000Z',
  totals: { opening: '-1500.00', initial: '-1500.00', credits: '100000.00', debits: '20200.00', payouts: '0.00', closing: '78300.00' },
  custody: '300.00',
  groups: [
    {
      propertyId: 'p1',
      label: 'Belgrano 100',
      credits: '100000.00',
      debits: '20200.00',
      payouts: '0.00',
      net: '79800.00',
      entries: [
        line('e1'),
        line('e2', { type: 'Comision', amount: '-7000.00', description: 'Comisión octubre de 2026' }),
        line('e3', { type: 'Cargo', amount: '-12000.00', description: 'Cambio de canilla', provisional: true }),
      ],
    },
    { propertyId: null, label: null, credits: '0', debits: '0', payouts: '0', net: '0.00', entries: [line('e4', { type: 'Ajuste', amount: '0.00', propertyId: null, groupLabel: null, description: 'Ajuste' })] },
  ],
  ...o,
});

interface Setup {
  write?: (path: string, init: { method: string; body?: string }) => unknown;
  detail?: Record<string, unknown>;
  failList?: boolean;
  failDetail?: boolean;
  pages?: number;
}

function mockApi({ write, detail: over, failList, failDetail, pages = 1 }: Setup = {}) {
  apiClient.mockImplementation(async (path: string, init?: { method?: string; body?: string }) => {
    if (init?.method) return write ? write(path, init as { method: string; body?: string }) : {};
    if (path === '/tenants/me/read-access') return { role: auth.role, resources: { renditions: true } };
    if (path.startsWith('/owner-statements?')) {
      if (failList) throw new ApiRequestError(500, 'INTERNAL_ERROR', 'boom');
      return { items: [summary('st-1'), summary('st-2', { currency: 'USD', status: 'Emitido', closing: '-20.00' })], total: 2, page: 1, limit: 50, totalPages: pages };
    }
    if (path === '/owner-statements/st-1') {
      if (failDetail) throw new ApiRequestError(404, 'STATEMENT_NOT_FOUND', 'nf');
      return detail(over);
    }
    if (path.startsWith('/financial-accounts')) {
      return { items: [{ id: CAJA, kind: 'Caja', name: 'Caja ARS', currency: 'ARS', ownerPersonId: null, isActive: true, balance: '1' }], totals: [] };
    }
    throw new Error(`unexpected ${path}`);
  });
}

const writes = () => apiClient.mock.calls.filter(([, init]) => init?.method);

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = 'Admin';
});

describe('Estados de cuenta: lista y generación (CP-475)', () => {
  it('lista los estados del mes con su saldo leído y estado; filtra y pagina', async () => {
    mockApi({ pages: 2 });
    const user = userEvent.setup();
    renderEs(<OwnerStatements />);
    const links = await screen.findAllByRole('link', { name: 'Ana Locadora' });
    expect(links[0]).toHaveAttribute('href', '/es/estados-de-cuenta/st-1');
    const text = nb(document.body.textContent);
    expect(text).toContain('$ 78.300,00');
    expect(text).toContain('Le debe a la inmobiliaria');
    expect(screen.getAllByText('Borrador').length).toBeGreaterThan(0);
    const month = screen.getByLabelText('Mes') as HTMLInputElement;
    expect(apiClient).toHaveBeenCalledWith(`/owner-statements?page=1&limit=50&period=${month.value}`);

    await user.selectOptions(screen.getByLabelText('Estado'), 'Emitido');
    await user.selectOptions(screen.getByLabelText('Moneda'), 'USD');
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith(`/owner-statements?page=1&limit=50&period=${month.value}&status=Emitido&currency=USD`),
    );
    await user.click(screen.getAllByRole('button', { name: /Siguiente/ })[0]);
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith(`/owner-statements?page=2&limit=50&period=${month.value}&status=Emitido&currency=USD`),
    );
  });

  it('genera los borradores del mes y explica lo creado, lo descontado y lo omitido', async () => {
    mockApi({
      write: () => ({
        period: '2026-10',
        created: 2,
        updated: 1,
        chargesPosted: 1,
        skipped: [
          { personId: ANA, currency: 'ARS', reason: 'STATEMENT_ALREADY_ISSUED' },
          { personId: ANA, currency: 'USD', reason: 'STATEMENT_ALREADY_ISSUED' },
          { personId: 'x', currency: 'ARS', reason: 'OTRO' },
        ],
      }),
    });
    const user = userEvent.setup();
    renderEs(<OwnerStatements />);
    await screen.findAllByRole('link', { name: 'Ana Locadora' });
    const month = screen.getByLabelText('Mes');
    await user.clear(month);
    await user.type(month, '2026-10');
    await user.click(screen.getByRole('button', { name: 'Generar estados del mes' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][0]).toBe('/owner-statements/generate?period=2026-10');
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Octubre de 2026: 2 estados nuevos y 1 recalculado.');
    expect(status).toHaveTextContent('Se descontó 1 gasto del centro de carga.');
    expect(status).toHaveTextContent('2 omitidos: ya estaba emitido');
    expect(status).toHaveTextContent('1 omitido: OTRO');
  });

  it('si la generación falla lo muestra', async () => {
    mockApi({
      write: () => {
        throw new ApiRequestError(400, 'VALIDATION_ERROR', 'Mes inválido');
      },
    });
    const user = userEvent.setup();
    renderEs(<OwnerStatements />);
    await screen.findAllByRole('link', { name: 'Ana Locadora' });
    await user.click(screen.getByRole('button', { name: 'Generar estados del mes' }));
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
  });

  it('Lectura ve la lista sin generar; un rol sin acceso no consulta; un error de la lista se muestra', async () => {
    auth.role = 'Lectura';
    mockApi();
    renderEs(<OwnerStatements />);
    await screen.findAllByRole('link', { name: 'Ana Locadora' });
    expect(screen.queryByRole('button', { name: 'Generar estados del mes' })).not.toBeInTheDocument();

    vi.clearAllMocks();
    auth.role = 'Ventas';
    renderEs(<OwnerStatements />);
    expect(screen.getByText('No tenés permiso para ver la cuenta corriente de los locadores.')).toBeInTheDocument();
    expect(apiClient).not.toHaveBeenCalled();
  });

  it('un error al cargar la lista se muestra; la ruta abre la pantalla', async () => {
    mockApi({ failList: true });
    renderEs(<OwnerStatementsPage />);
    expect(await screen.findByRole('heading', { name: 'Estados de cuenta' })).toBeInTheDocument();
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
  });
});

describe('Estado de cuenta: detalle (CP-476)', () => {
  it('muestra el resumen con el saldo arrastrado, la lectura del cierre, la custodia y los movimientos por unidad', async () => {
    mockApi();
    renderEs(<OwnerStatementDetail statementId="st-1" />);
    expect(await screen.findByRole('heading', { name: 'Ana Locadora — Octubre de 2026' })).toBeInTheDocument();
    const text = nb(document.body.textContent);
    expect(text).toContain('Del 01/10/2026 al 31/10/2026 · ARS');
    expect(text).toContain('Saldo inicial');
    expect(text).toContain('Saldo a favor del locador: la inmobiliaria le debe $ 78.300,00.');
    expect(text).toContain('De ese saldo, en efectivo en custodia:');
    expect(screen.getByRole('region', { name: 'Belgrano 100' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Movimientos generales' })).toBeInTheDocument();
    expect((await screen.findAllByText('previsto: se descuenta al emitir')).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Ver la cuenta corriente' })).toHaveAttribute('href', `/es/locadores/${ANA}?currency=ARS`);
  });

  it('un estado emitido ofrece la facturación por cuenta del locador; un borrador no', async () => {
    mockApi({ detail: { status: 'Emitido' } });
    const { unmount } = renderEs(<OwnerStatementDetail statementId="st-1" />);
    await screen.findByRole('heading', { name: 'Ana Locadora — Octubre de 2026' });
    await waitFor(() => expect(apiClient).toHaveBeenCalledWith('/owner-statements/st-1/invoices'));
    unmount();
    apiClient.mockClear();
    mockApi();
    renderEs(<OwnerStatementDetail statementId="st-1" />);
    await screen.findByRole('heading', { name: 'Ana Locadora — Octubre de 2026' });
    expect(apiClient).not.toHaveBeenCalledWith('/owner-statements/st-1/invoices');
  });

  it('descarga el PDF y avisa si falla', async () => {
    mockApi();
    downloadFile.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('x'));
    const user = userEvent.setup();
    renderEs(<OwnerStatementDetail statementId="st-1" />);
    await screen.findByRole('heading', { name: 'Ana Locadora — Octubre de 2026' });
    await user.click(screen.getByRole('button', { name: 'Descargar PDF' }));
    expect(downloadFile).toHaveBeenCalledWith('/owner-statements/st-1/pdf', 'estado-de-cuenta-2026-10-ARS.pdf');
    await user.click(screen.getByRole('button', { name: 'Descargar PDF' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringContaining('No se pudo descargar')));
  });

  it('emite tras confirmar; cancelar no emite; un 409 se traduce', async () => {
    let fail = false;
    mockApi({
      write: () => {
        if (fail) throw new ApiRequestError(409, 'STATEMENT_PERIOD_CLOSED', 'closed');
        return summary('st-1', { status: 'Emitido' });
      },
    });
    const user = userEvent.setup();
    renderEs(<OwnerStatementDetail statementId="st-1" />);
    await screen.findByRole('heading', { name: 'Ana Locadora — Octubre de 2026' });
    await user.click(screen.getByRole('button', { name: 'Emitir' }));
    await user.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(writes()).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Emitir' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Emitir' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][0]).toBe('/owner-statements/st-1/issue');
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Estado emitido.'));

    fail = true;
    await user.click(screen.getByRole('button', { name: 'Emitir' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Emitir' }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Ya hay un estado emitido de este mes o de uno posterior para este locador.'),
    );
  });

  it('anula pidiendo el motivo; un 409 se muestra en el diálogo', async () => {
    let fail = true;
    mockApi({
      detail: { status: 'Emitido' },
      write: () => {
        if (fail) throw new ApiRequestError(409, 'STATEMENT_NOT_LATEST', 'not latest');
        return summary('st-1', { status: 'Anulado' });
      },
    });
    const user = userEvent.setup();
    renderEs(<OwnerStatementDetail statementId="st-1" />);
    await screen.findByRole('heading', { name: 'Ana Locadora — Octubre de 2026' });
    expect(screen.queryByRole('button', { name: 'Emitir' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Anular' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Anular estado' }));
    expect(within(dialog).getByText('Contá el motivo de la anulación.')).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
    await user.type(within(dialog).getByLabelText(/Motivo/), 'faltaba un gasto');
    await user.click(within(dialog).getByRole('button', { name: 'Anular estado' }));
    expect(await within(dialog).findByText('Primero anulá los estados posteriores de este locador.')).toBeInTheDocument();

    fail = false;
    await user.click(within(dialog).getByRole('button', { name: 'Anular estado' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Estado anulado.'));
    expect(writes().at(-1)![0]).toBe('/owner-statements/st-1/annul');
    expect(JSON.parse(writes().at(-1)![1].body)).toEqual({ reason: 'faltaba un gasto' });
  });

  it('un estado anulado muestra el motivo y no ofrece emitir ni anular', async () => {
    mockApi({ detail: { status: 'Anulado', annulReason: 'error de carga', groups: [] } });
    renderEs(<OwnerStatementDetail statementId="st-1" />);
    expect(await screen.findByText('Anulado: error de carga')).toBeInTheDocument();
    expect(screen.getByText('Sin movimientos en el período.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Emitir' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Anular' })).not.toBeInTheDocument();
  });

  it('registra un pago al locador desde el estado con lo pendiente propuesto', async () => {
    mockApi({ write: () => ({ balance: '300.00' }) });
    const user = userEvent.setup();
    renderEs(<OwnerStatementDetail statementId="st-1" />);
    await screen.findByRole('heading', { name: 'Ana Locadora — Octubre de 2026' });
    await user.click(screen.getByRole('button', { name: 'Registrar pago al locador' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/Importe/)).toHaveValue('78000.00');
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('Liquidaciones emite pero no anula; Lectura solo descarga', async () => {
    auth.role = 'Liquidaciones';
    mockApi();
    renderEs(<OwnerStatementDetail statementId="st-1" />);
    await screen.findByRole('heading', { name: 'Ana Locadora — Octubre de 2026' });
    expect(screen.getByRole('button', { name: 'Emitir' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Anular' })).not.toBeInTheDocument();
  });

  it('Lectura solo descarga; un rol sin acceso no consulta', async () => {
    auth.role = 'Lectura';
    mockApi();
    renderEs(<OwnerStatementDetail statementId="st-1" />);
    await screen.findByRole('heading', { name: 'Ana Locadora — Octubre de 2026' });
    expect(screen.queryByRole('button', { name: 'Emitir' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Registrar pago al locador' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Descargar PDF' })).toBeInTheDocument();

    vi.clearAllMocks();
    auth.role = 'Soporte';
    renderEs(<OwnerStatementDetail statementId="st-1" />);
    expect(screen.getAllByText('No tenés permiso para ver la cuenta corriente de los locadores.').length).toBeGreaterThan(0);
    expect(apiClient).not.toHaveBeenCalled();
  });

  it('un estado que no existe muestra el error; la ruta abre el detalle', async () => {
    mockApi({ failDetail: true });
    renderEs(<OwnerStatementDetail statementId="st-1" />);
    expect(await screen.findByText('El estado de cuenta no existe.')).toBeInTheDocument();

    mockApi();
    renderEs(<OwnerStatementPage />);
    expect(await screen.findByRole('heading', { name: 'Ana Locadora — Octubre de 2026' })).toBeInTheDocument();
  });
});
