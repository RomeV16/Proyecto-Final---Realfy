// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '../index-data/test-utils';

const { apiClient, auth, toastSuccess, toastError, toastInfo } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  auth: { role: 'Liquidaciones' },
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
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
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
    info: (...a: unknown[]) => toastInfo(...a),
  },
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { ApiRequestError } from '@/lib/api-client';
import { ChargeCenter } from './charge-center';
import { ContractPendingCharges } from './contract-pending-charges';

const CONTRACT_ID = '11111111-1111-4111-8111-111111111111';
const PROPERTY_ID = '22222222-2222-4222-8222-222222222222';

const charge = (id: string, o: Record<string, unknown> = {}) => ({
  id,
  propertyId: PROPERTY_ID,
  contractId: CONTRACT_ID,
  chargedTo: 'Inquilino',
  kind: 'Reparacion',
  description: `Gasto ${id}`,
  amount: '8000.5',
  currency: 'ARS',
  beneficiary: 'Locador',
  incurredAt: '2026-10-20T00:00:00.000Z',
  targetPeriod: null,
  status: 'Pendiente',
  requiresUpfront: false,
  installmentNo: 1,
  installmentOf: 1,
  imputedLiquidacionId: null,
  property: { id: PROPERTY_ID, title: 'Depto Sintético' },
  ...o,
});

interface Setup {
  list?: unknown[];
  post?: (path: string, init: { body: string }) => unknown;
  failList?: boolean;
}

function chargesPage(items: unknown[]) {
  return { items, total: items.length, page: 1, limit: 50, totalPages: 1 };
}

function setup({ list = [], post, failList }: Setup = {}) {
  let current = list;
  apiClient.mockImplementation(async (path: string, init?: { method?: string; body: string }) => {
    if (path.startsWith('/contracts?')) {
      return { items: [{ id: CONTRACT_ID, startDate: '2026-01-01T00:00:00.000Z', property: { id: PROPERTY_ID, title: 'Depto Sintético' } }] };
    }
    if (path.startsWith('/properties?')) return { items: [{ id: PROPERTY_ID, title: 'Depto Sintético' }] };
    if (init?.method === 'POST' || init?.method === 'PATCH') {
      const result = post ? post(path, init) : { items: [charge('new')] };
      current = [];
      return result;
    }
    if (path.startsWith('/charges?')) {
      if (failList) throw new ApiRequestError(500, 'INTERNAL_ERROR', 'boom');
      return chargesPage(current);
    }
    throw new Error(`unexpected ${path}`);
  });
  return renderEs(<ChargeCenter />);
}

const writes = () => apiClient.mock.calls.filter(([, init]) => init?.method);

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = 'Liquidaciones';
});

describe('Centro de carga: lista', () => {
  it('muestra los cargos pendientes con su estado, concepto, destino e importe', async () => {
    setup({
      list: [
        charge('a'),
        charge('b', { kind: 'Devolucion', amount: '-3000', description: 'Arreglo del inquilino' }),
        charge('c', { chargedTo: 'Locador', installmentNo: 2, installmentOf: 3, targetPeriod: '2026-12-01T00:00:00.000Z' }),
      ],
    });
    expect(await screen.findAllByText('Gasto a')).not.toHaveLength(0);
    expect(apiClient).toHaveBeenCalledWith('/charges?page=1&limit=50&status=Pendiente');
    expect(screen.getAllByText('Reparación · cuota 2/3').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Devolución').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Locador').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2026-12').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Pendiente').length).toBeGreaterThan(0);
  });

  it('un cargo que supera el umbral lleva la chapa de anticipo y se puede imputar a la fuerza', async () => {
    setup({ list: [charge('big', { requiresUpfront: true, amount: '90000' })] });
    const user = userEvent.setup();
    expect((await screen.findAllByText('Pide anticipo')).length).toBeGreaterThan(0);

    await user.click(screen.getAllByRole('button', { name: 'Imputar en la liquidación' })[0]);
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual([
      '/charges/big',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ requiresUpfront: false }) }),
    ]);
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('El cargo entra en la próxima liquidación'));
  });

  it('marcar cobrado por adelantado y anular piden confirmación', async () => {
    setup({ list: [charge('x', { requiresUpfront: true })] });
    const user = userEvent.setup();
    await screen.findAllByText('Gasto x');

    await user.click(screen.getAllByRole('button', { name: 'Cobrado por adelantado' })[0]);
    const dialog = await screen.findByRole('alertdialog').catch(() => screen.findByRole('dialog'));
    await user.click(within(dialog).getByRole('button', { name: 'Cobrado por adelantado' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][0]).toBe('/charges/x/mark-paid-upfront');

    await user.click(screen.getAllByRole('button', { name: 'Anular' })[0]);
    const cancelDialog = await screen.findByRole('alertdialog').catch(() => screen.findByRole('dialog'));
    expect(within(cancelDialog).getByText('¿Anular el cargo?')).toBeInTheDocument();
    await user.click(within(cancelDialog).getByRole('button', { name: 'Anular' }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1][0]).toBe('/charges/x/cancel');
  });

  it('cancelar la confirmación no manda nada', async () => {
    setup({ list: [charge('y')] });
    const user = userEvent.setup();
    await screen.findAllByText('Gasto y');
    await user.click(screen.getAllByRole('button', { name: 'Anular' })[0]);
    const dialog = await screen.findByRole('alertdialog').catch(() => screen.findByRole('dialog'));
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(writes()).toHaveLength(0);
  });

  it('un cargo imputado se libera y un error de la acción se avisa', async () => {
    setup({
      list: [charge('i', { status: 'Imputado', imputedLiquidacionId: 'liq-1' })],
      post: () => {
        throw new ApiRequestError(409, 'CHARGE_LIQUIDATION_ACTIVE', 'La liquidación sigue vigente');
      },
    });
    const user = userEvent.setup();
    await screen.findAllByText('Gasto i');
    await user.click(screen.getAllByRole('button', { name: 'Liberar' })[0]);
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringContaining('liquidación')));
    expect(writes()[0][0]).toBe('/charges/i/release');
  });

  it('un error que no es de la API usa el aviso genérico', async () => {
    setup({
      list: [charge('g')],
      post: () => {
        throw new Error('red caída');
      },
    });
    const user = userEvent.setup();
    await screen.findAllByText('Gasto g');
    await user.click(screen.getAllByRole('button', { name: 'Cobrado por adelantado' })[0]);
    const dialog = await screen.findByRole('alertdialog').catch(() => screen.findByRole('dialog'));
    await user.click(within(dialog).getByRole('button', { name: 'Cobrado por adelantado' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('No se pudo completar la acción'));
  });

  it('los filtros se mandan a la API', async () => {
    setup({ list: [charge('a')] });
    const user = userEvent.setup();
    await screen.findAllByText('Gasto a');

    await user.selectOptions(screen.getByLabelText('Estado'), 'Imputado');
    await waitFor(() => expect(apiClient).toHaveBeenCalledWith('/charges?page=1&limit=50&status=Imputado'));
    await user.selectOptions(screen.getByLabelText('Estado'), '');
    await user.click(screen.getByLabelText('Solo los que piden anticipo'));
    await waitFor(() => expect(apiClient).toHaveBeenCalledWith('/charges?page=1&limit=50&requiresUpfront=true'));
    await user.type(screen.getByLabelText('Mes'), '2026-11');
    await waitFor(() => expect(apiClient).toHaveBeenCalledWith('/charges?page=1&limit=50&period=2026-11&requiresUpfront=true'));
  });

  it('sin cargos muestra el estado vacío y ofrece cargar uno', async () => {
    setup({ list: [] });
    expect((await screen.findAllByText('No hay cargos')).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Cargar un gasto' }).length).toBeGreaterThan(1);
  });

  it('un error de la lista se muestra', async () => {
    setup({ failList: true });
    expect(await screen.findByText(/problema/i)).toBeInTheDocument();
  });

  it('un rol sin permiso no ve la pantalla ni pide nada', () => {
    auth.role = 'Lectura';
    setup();
    expect(screen.getByText('No tenés permiso para cargar gastos.')).toBeInTheDocument();
    expect(apiClient).not.toHaveBeenCalled();
  });
});

describe('Centro de carga: alta rápida', () => {
  it('carga un gasto al inquilino con cuotas y avisa que pide anticipo', async () => {
    setup({
      list: [],
      post: () => ({ items: [charge('n1', { requiresUpfront: true }), charge('n2', { requiresUpfront: true })] }),
    });
    const user = userEvent.setup();
    await screen.findAllByText('No hay cargos');
    await user.click(screen.getAllByRole('button', { name: 'Cargar un gasto' })[0]);
    const dialog = await screen.findByRole('dialog');

    await waitFor(() => expect(within(dialog).getByRole('option', { name: /Depto Sintético · 2026-01/ })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByLabelText('Contrato'), CONTRACT_ID);
    await user.type(within(dialog).getByLabelText('Descripción'), 'Techo del baño');
    await user.type(within(dialog).getByLabelText('Importe'), '90000,5');
    await user.clear(within(dialog).getByLabelText('Cuotas'));
    await user.type(within(dialog).getByLabelText('Cuotas'), '2');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    const [path, init] = writes()[0];
    expect(path).toBe('/charges');
    expect(JSON.parse(init.body)).toMatchObject({
      contractId: CONTRACT_ID,
      chargedTo: 'Inquilino',
      kind: 'Reparacion',
      description: 'Techo del baño',
      amount: '90000.5',
      installments: 2,
      beneficiary: 'Locador',
    });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Se cargaron 2 cuotas'));
    expect(toastInfo).toHaveBeenCalledWith(expect.stringContaining('umbral de anticipo'));
  });

  it('un gasto al locador de una propiedad vacía pide la propiedad, no el contrato', async () => {
    setup({ list: [] });
    const user = userEvent.setup();
    await screen.findAllByText('No hay cargos');
    await user.click(screen.getAllByRole('button', { name: 'Cargar un gasto' })[0]);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Depto Sintético' })).toBeInTheDocument());

    await user.selectOptions(within(dialog).getByLabelText('A cargo de'), 'Locador');
    expect(within(dialog).getByText(/Se descuenta en el estado del locador/)).toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText('Clase de gasto'), 'ExpensaExtra');
    await user.selectOptions(within(dialog).getByLabelText('Propiedad'), PROPERTY_ID);
    await user.type(within(dialog).getByLabelText('Descripción'), 'Expensa extraordinaria');
    await user.type(within(dialog).getByLabelText('Importe'), '120000');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(JSON.parse(writes()[0][1].body)).toMatchObject({
      propertyId: PROPERTY_ID,
      contractId: null,
      chargedTo: 'Locador',
      kind: 'ExpensaExtra',
    });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Se cargó 1 cargo'));
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it('valida los campos y no manda nada con errores', async () => {
    setup({ list: [] });
    const user = userEvent.setup();
    await screen.findAllByText('No hay cargos');
    await user.click(screen.getAllByRole('button', { name: 'Cargar un gasto' })[0]);
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await within(dialog).findByText('Un cargo al inquilino necesita un contrato')).toBeInTheDocument();
    expect(within(dialog).getByText('Escribí una descripción')).toBeInTheDocument();
    expect(within(dialog).getByText(/Ingresá un importe válido distinto de cero/)).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it('un error de la API queda en el formulario y no lo cierra', async () => {
    setup({
      list: [],
      post: () => {
        throw new ApiRequestError(404, 'CONTRACT_NOT_FOUND', 'Contract not found');
      },
    });
    const user = userEvent.setup();
    await screen.findAllByText('No hay cargos');
    await user.click(screen.getAllByRole('button', { name: 'Cargar un gasto' })[0]);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: /Depto Sintético · 2026-01/ })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByLabelText('Contrato'), CONTRACT_ID);
    await user.type(within(dialog).getByLabelText('Descripción'), 'x');
    await user.type(within(dialog).getByLabelText('Importe'), '10');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(await within(dialog).findByText('El contrato no existe.')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('Centro de carga: planilla', () => {
  async function openSheet() {
    const user = userEvent.setup();
    await screen.findAllByText('No hay cargos');
    await user.click(screen.getByRole('button', { name: 'Carga por planilla' }));
    await screen.findByRole('grid', { name: 'Cargos a cargar' });
    await user.click(screen.getByRole('button', { name: 'Agregar fila' }));
    return user;
  }

  it('pegar filas de una planilla las carga con los valores habituales y guarda todo junto', async () => {
    setup({
      list: [],
      post: () => ({ created: 2, failed: 0, results: [{ index: 0, status: 'created' }, { index: 1, status: 'created' }] }),
    });
    const user = await openSheet();
    await waitFor(() => expect(screen.getByLabelText('Contrato 1')).toBeInTheDocument());
    await user.click(screen.getByLabelText('Descripción 1'));
    await user.paste('Canilla\t8000,50\nLlave\t1500');

    expect(screen.getByLabelText('Descripción 2')).toHaveValue('Llave');
    await user.selectOptions(screen.getByLabelText('Contrato 1'), CONTRACT_ID);
    await user.selectOptions(screen.getByLabelText('Contrato 2'), CONTRACT_ID);
    await user.click(screen.getByRole('button', { name: 'Guardar 2 cargos' }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    const [path, init] = writes()[0];
    expect(path).toBe('/charges/bulk');
    const { rows } = JSON.parse(init.body);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      contractId: CONTRACT_ID,
      chargedTo: 'Inquilino',
      kind: 'Reparacion',
      description: 'Canilla',
      amount: '8000.50',
    });
    expect(rows[0].incurredAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(rows[1]).toMatchObject({ description: 'Llave', amount: '1500' });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Se guardaron 2 cargos'));
  });

  it('las filas que fallan quedan para corregir y las guardadas salen de la planilla', async () => {
    setup({
      list: [],
      post: () => ({
        created: 1,
        failed: 1,
        results: [
          { index: 0, status: 'created' },
          { index: 1, status: 'error', error: { code: 'CONTRACT_NOT_FOUND', message: 'Contract not found' } },
        ],
      }),
    });
    const user = await openSheet();
    await waitFor(() => expect(screen.getByLabelText('Contrato 1')).toBeInTheDocument());
    await user.click(screen.getByLabelText('Descripción 1'));
    await user.paste('Una\t100\nOtra\t200');
    await user.selectOptions(screen.getByLabelText('Contrato 1'), CONTRACT_ID);
    await user.selectOptions(screen.getByLabelText('Contrato 2'), CONTRACT_ID);
    await user.click(screen.getByRole('button', { name: 'Guardar 2 cargos' }));

    expect(await screen.findByText('Estas filas no se guardaron')).toBeInTheDocument();
    expect(screen.getByRole('listitem')).toHaveTextContent('Otra: El contrato no existe.');
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringContaining('1 fila con error')));
    // Solo queda la fila que falló.
    expect(screen.getByLabelText('Descripción 1')).toHaveValue('Otra');
    expect(screen.queryByLabelText('Descripción 2')).not.toBeInTheDocument();
  });

  it('valida cada celda y no guarda con errores; un error de red se avisa', async () => {
    setup({
      list: [],
      post: () => {
        throw new ApiRequestError(500, 'INTERNAL_ERROR', 'boom');
      },
    });
    const user = await openSheet();
    await waitFor(() => expect(screen.getByLabelText('Contrato 1')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Descripción 1'), 'Algo');
    await user.type(screen.getByLabelText('Importe 1'), '0');
    await user.type(screen.getByLabelText('Fecha 1'), '31/02/2026');
    await user.type(screen.getByLabelText('Cuotas 1'), '40');
    expect(await screen.findAllByText(/importe válido distinto de cero/)).not.toHaveLength(0);
    expect(screen.getByText(/Fecha inválida/)).toBeInTheDocument();
    expect(screen.getByText('De 1 a 36')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Guardar/ }));
    expect(writes()).toHaveLength(0);

    await user.selectOptions(screen.getByLabelText('Contrato 1'), CONTRACT_ID);
    await user.clear(screen.getByLabelText('Importe 1'));
    await user.type(screen.getByLabelText('Importe 1'), '100');
    await user.clear(screen.getByLabelText('Fecha 1'));
    await user.clear(screen.getByLabelText('Cuotas 1'));
    await user.click(screen.getByRole('button', { name: 'Guardar 1 cargo' }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: 'Ocultar la planilla' }));
    expect(screen.queryByRole('grid', { name: 'Cargos a cargar' })).not.toBeInTheDocument();
  });
});

describe('Detalle del contrato: cargos pendientes', () => {
  it('lista los cargos pendientes del contrato, enlaza al centro y permite cargar uno', async () => {
    apiClient.mockImplementation(async (path: string) => {
      if (path === `/charges?contractId=${CONTRACT_ID}&status=Pendiente&limit=50`) {
        return chargesPage([charge('k1', { requiresUpfront: true, amount: '90000' })]);
      }
      if (path.startsWith('/contracts?')) return { items: [] };
      if (path.startsWith('/properties?')) return { items: [] };
      throw new Error(`unexpected ${path}`);
    });
    const user = userEvent.setup();
    renderEs(<ContractPendingCharges contractId={CONTRACT_ID} />);

    expect(await screen.findAllByText('Gasto k1')).not.toHaveLength(0);
    expect(screen.getByText('Cargos pendientes')).toBeInTheDocument();
    expect(screen.getAllByText('Pide anticipo').length).toBeGreaterThan(0);
    // En el detalle del contrato la propiedad ya está a la vista.
    expect(screen.queryByText('Propiedad')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver el centro de carga' })).toHaveAttribute('href', '/cargos');

    await user.click(screen.getByRole('button', { name: 'Cargar un gasto' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Contrato')).toBeInTheDocument();
  });

  it('un rol sin permiso de carga solo lee', async () => {
    auth.role = 'Lectura';
    apiClient.mockImplementation(async () => chargesPage([charge('k2')]));
    renderEs(<ContractPendingCharges contractId={CONTRACT_ID} />);
    expect(await screen.findAllByText('Gasto k2')).not.toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Cargar un gasto' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Anular' })).not.toBeInTheDocument();
    expect(apiClient).toHaveBeenCalledTimes(1);
  });

  it('un error de la carga se muestra', async () => {
    apiClient.mockImplementation(async () => {
      throw new ApiRequestError(500, 'INTERNAL_ERROR', 'boom');
    });
    renderEs(<ContractPendingCharges contractId={CONTRACT_ID} />);
    expect(await screen.findByText(/problema/i)).toBeInTheDocument();
  });
});
