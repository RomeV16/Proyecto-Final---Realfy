// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '../index-data/test-utils';

const { apiClient, auth, toastSuccess, toastError, toastInfo } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  auth: { role: 'Soporte' },
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

import { ApiRequestError } from '@/lib/api-client';
import type { RepairTicket } from '@/lib/ticket-repairs';
import { RepairSection } from './repair-section';
import { RepairStepper } from './repair-stepper';

const TICKET_ID = '11111111-1111-4111-8111-111111111111';
const PROVIDER_ID = '22222222-2222-4222-8222-222222222222';
const LESSOR_ID = '33333333-3333-4333-8333-333333333333';
const CAJA_ID = '44444444-4444-4444-8444-444444444444';
const QUOTE_ID = '55555555-5555-4555-8555-555555555555';

const ticket = (o: Partial<RepairTicket> = {}): RepairTicket => ({
  id: TICKET_ID,
  status: 'Abierto',
  contractId: null,
  providerId: null,
  estimatedAmount: null,
  costAmount: null,
  costCurrency: null,
  costPayer: null,
  preauthorizedAmount: null,
  preauthorizedAt: null,
  preauthorizedChannel: null,
  imputedAt: null,
  quotes: [],
  ...o,
});

const quote = (o: Record<string, unknown> = {}) => ({
  id: QUOTE_ID,
  providerId: PROVIDER_ID,
  amount: '80000',
  currency: 'ARS',
  status: 'Pendiente',
  approvedAt: null,
  channel: null,
  documentUrl: null,
  notes: 'con materiales',
  provider: { id: PROVIDER_ID, firstName: 'Carlos', lastName: 'Plomero' },
  approvedBy: null,
  ...o,
});

interface Setup {
  ticket: RepairTicket;
  payments?: { items: unknown[]; total: string; currency: string | null };
  post?: (path: string, init: { method?: string; body?: string }) => unknown;
  failOptions?: boolean;
}

const writes = () => apiClient.mock.calls.filter(([, init]) => init?.method);
const body = (index = 0) => JSON.parse(writes()[index][1].body as string);

function setup({ ticket: t, payments, post, failOptions }: Setup) {
  const onChanged = vi.fn();
  apiClient.mockImplementation(async (path: string, init?: { method?: string; body?: string }) => {
    if (path.startsWith('/providers?')) {
      if (failOptions) throw new ApiRequestError(500, 'INTERNAL_ERROR', 'boom');
      return { data: [{ id: PROVIDER_ID, firstName: 'Carlos', lastName: 'Plomero' }] };
    }
    if (path.startsWith('/persons?')) return { items: [{ id: LESSOR_ID, firstName: 'Ana', lastName: 'Locadora' }] };
    if (path === '/financial-accounts') {
      return {
        items: [
          { id: CAJA_ID, kind: 'Caja', name: 'Caja ARS', currency: 'ARS', ownerPersonId: null, isActive: true, balance: '0' },
          { id: 'usd', kind: 'Banco', name: 'Banco Dólares', currency: 'USD', ownerPersonId: null, isActive: true, balance: '0' },
        ],
        totals: [],
        custodyInAgencyBalance: false,
      };
    }
    if (path === `/tickets/${TICKET_ID}/provider-payments` && !init?.method) {
      return payments ?? { items: [], total: '0.00', currency: null };
    }
    if (init?.method) return post ? post(path, init) : {};
    throw new Error(`unexpected ${path}`);
  });
  renderEs(<RepairSection ticket={t} onChanged={onChanged} />);
  return { onChanged };
}

const field = (name: string) => screen.getByLabelText(new RegExp(`^${name}`));
const confirmDialog = async () => (await screen.findAllByRole('alertdialog').catch(() => screen.findAllByRole('dialog')))[0];

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = 'Soporte';
});

describe('RepairStepper', () => {
  it('marca lo hecho, la etapa actual y lo pendiente', () => {
    renderEs(<RepairStepper status="Presupuestado" />);
    const steps = screen.getAllByRole('listitem');
    expect(steps).toHaveLength(7);
    expect(steps.map((s) => s.getAttribute('data-state'))).toEqual(['done', 'done', 'current', 'todo', 'todo', 'todo', 'todo']);
    expect(steps[2]).toHaveAttribute('aria-current', 'step');
    expect(within(steps[2]).getByText('(etapa actual)')).toBeInTheDocument();
  });

  it('los estados del proveedor cuentan como ejecución', () => {
    renderEs(<RepairStepper status="ProveedorEnCamino" />);
    expect(screen.getAllByRole('listitem')[4]).toHaveAttribute('aria-current', 'step');
  });

  it('una incidencia cancelada no avanza', () => {
    renderEs(<RepairStepper status="Cancelado" />);
    expect(screen.getByRole('status')).toHaveTextContent('La incidencia se canceló');
    expect(screen.queryByRole('listitem')).toBeNull();
  });
});

describe('Reparación: autorización', () => {
  it('anota el estimado y avisa si hace falta consultar al locador', async () => {
    const { onChanged } = setup({
      ticket: ticket(),
      post: () => ({ requiresAuthorization: true }),
    });
    const user = userEvent.setup();
    await user.type(field('Costo estimado'), '250000');
    await user.click(screen.getByRole('button', { name: 'Anotar estimado' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][0]).toBe(`/tickets/${TICKET_ID}/estimate`);
    expect(body()).toEqual({ amount: '250000', currency: 'ARS' });
    await waitFor(() => expect(toastInfo).toHaveBeenCalledWith(expect.stringContaining('espera la autorización')));
    expect(onChanged).toHaveBeenCalled();
  });

  it('dentro del límite se puede seguir sin consultar', async () => {
    setup({ ticket: ticket(), post: () => ({ requiresAuthorization: false }) });
    const user = userEvent.setup();
    await user.type(field('Costo estimado'), '90000,50');
    await user.click(screen.getByRole('button', { name: 'Anotar estimado' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining('sin consultar')));
    expect(body().amount).toBe('90000.50');
  });

  it('un estimado vacío o inválido no se manda', async () => {
    setup({ ticket: ticket() });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Anotar estimado' }));
    expect(await screen.findByText(/importe mayor a cero/)).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it('un error de la API al anotar el estimado se muestra', async () => {
    setup({
      ticket: ticket(),
      post: () => {
        throw new ApiRequestError(409, 'TICKET_NOT_ESTIMABLE', 'El ticket ya no se puede estimar');
      },
    });
    const user = userEvent.setup();
    await user.type(field('Costo estimado'), '10');
    await user.click(screen.getByRole('button', { name: 'Anotar estimado' }));
    expect(await screen.findByText(/ya no se puede estimar/)).toBeInTheDocument();
  });

  it('esperando la autorización pide tope, quién y canal, y los manda', async () => {
    const { onChanged } = setup({ ticket: ticket({ status: 'PendienteAutorizacion', estimatedAmount: '250000' }) });
    const user = userEvent.setup();
    expect(screen.getByText(/Falta la autorización del locador/)).toBeInTheDocument();
    await screen.findByRole('option', { name: 'Ana Locadora' });

    await user.click(screen.getByRole('button', { name: 'Registrar autorización' }));
    await waitFor(() => expect(field('Quién aprueba')).toHaveAttribute('aria-invalid', 'true'));
    expect(writes()).toHaveLength(0);

    await user.type(field('Tope autorizado'), '300000');
    await user.selectOptions(field('Quién aprueba'), LESSOR_ID);
    await user.selectOptions(field('Por qué canal'), 'WhatsApp');
    await user.click(screen.getByRole('button', { name: 'Registrar autorización' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][0]).toBe(`/tickets/${TICKET_ID}/preauthorize`);
    expect(body()).toEqual({ amount: '300000', approvedByPersonId: LESSOR_ID, channel: 'WhatsApp' });
    expect(onChanged).toHaveBeenCalled();
  });

  it('con la autorización registrada la muestra: tope, quién, canal y fecha', () => {
    setup({
      ticket: ticket({
        status: 'Presupuestado',
        estimatedAmount: '250000',
        preauthorizedAmount: '300000',
        preauthorizedAt: '2026-10-30T15:00:00.000Z',
        preauthorizedChannel: 'Telefono',
        preauthorizedBy: { id: LESSOR_ID, firstName: 'Ana', lastName: 'Locadora' },
      }),
    });
    expect(screen.getByText(/Autorizó Ana Locadora por Teléfono el/)).toBeInTheDocument();
  });

  it('quien solo mira no ve formularios', () => {
    auth.role = 'Lectura';
    setup({ ticket: ticket({ status: 'PendienteAutorizacion' }) });
    expect(screen.queryByRole('button', { name: 'Anotar estimado' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Registrar autorización' })).toBeNull();
    expect(apiClient.mock.calls.some(([p]) => String(p).startsWith('/providers'))).toBe(false);
  });

  it('si no cargan los proveedores y personas lo avisa', async () => {
    setup({ ticket: ticket(), failOptions: true });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('Reparación: presupuestos', () => {
  it('lista los presupuestos con su estado y quién aprobó el elegido', () => {
    setup({
      ticket: ticket({
        status: 'PresupuestoAprobado',
        quotes: [
          quote({ id: 'a', status: 'Rechazado' }),
          quote({
            id: 'b',
            status: 'Aprobado',
            approvedAt: '2026-10-31T12:00:00.000Z',
            channel: 'Presencial',
            approvedBy: { id: LESSOR_ID, firstName: 'Ana', lastName: 'Locadora' },
          }),
        ],
      }),
    });
    expect(screen.getAllByText('Descartado').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Aprobó Ana Locadora por Presencial el/).length).toBeGreaterThan(0);
    // Ya aprobado: no hay acciones sobre los presupuestos.
    expect(screen.queryByRole('button', { name: 'Aprobar' })).toBeNull();
  });

  it('carga un presupuesto de un proveedor', async () => {
    const { onChanged } = setup({ ticket: ticket() });
    const user = userEvent.setup();
    await screen.findByRole('option', { name: 'Carlos Plomero' });
    expect(screen.getAllByText('Todavía no hay presupuestos').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Cargar presupuesto' }));
    await waitFor(() => expect(field('Proveedor')).toHaveAttribute('aria-invalid', 'true'));
    expect(writes()).toHaveLength(0);

    await user.selectOptions(field('Proveedor'), PROVIDER_ID);
    await user.type(field('Importe'), '80000');
    await user.click(screen.getByRole('button', { name: 'Cargar presupuesto' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][0]).toBe(`/tickets/${TICKET_ID}/quotes`);
    expect(body()).toEqual({ providerId: PROVIDER_ID, amount: '80000', currency: 'ARS' });
    expect(onChanged).toHaveBeenCalled();
  });

  it('aprobar pide quién y por qué canal y lo registra', async () => {
    const { onChanged } = setup({ ticket: ticket({ status: 'Presupuestado', quotes: [quote()] }) });
    const user = userEvent.setup();

    await user.click(screen.getAllByRole('button', { name: 'Aprobar' })[0]);
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('option', { name: 'Ana Locadora' });
    expect(within(dialog).getByText(/Presupuesto de Carlos Plomero por/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Aprobar presupuesto' }));
    await waitFor(() => expect(within(dialog).getByLabelText(/^Quién aprueba/)).toHaveAttribute('aria-invalid', 'true'));
    expect(writes()).toHaveLength(0);

    await user.selectOptions(within(dialog).getByLabelText(/^Quién aprueba/), LESSOR_ID);
    await user.selectOptions(within(dialog).getByLabelText(/^Por qué canal/), 'Mail');
    await user.type(within(dialog).getByLabelText('Nota'), 'Lo confirmó por mail');
    await user.click(within(dialog).getByRole('button', { name: 'Aprobar presupuesto' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][0]).toBe(`/tickets/${TICKET_ID}/quotes/${QUOTE_ID}/approve`);
    expect(body()).toEqual({ approvedByPersonId: LESSOR_ID, channel: 'Mail', note: 'Lo confirmó por mail' });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Presupuesto aprobado.'));
    expect(onChanged).toHaveBeenCalled();
  });

  it('cancelar el diálogo de aprobación no manda nada', async () => {
    setup({ ticket: ticket({ status: 'Presupuestado', quotes: [quote()] }) });
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button', { name: 'Aprobar' })[0]);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(writes()).toHaveLength(0);
  });

  it('descartar y quitar piden confirmación', async () => {
    const { onChanged } = setup({ ticket: ticket({ status: 'Presupuestado', quotes: [quote()] }) });
    const user = userEvent.setup();

    await user.click(screen.getAllByRole('button', { name: 'Descartar' })[0]);
    let dialog = await confirmDialog();
    expect(within(dialog).getByText(/Se descarta el presupuesto de Carlos Plomero/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Descartar' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual([`/tickets/${TICKET_ID}/quotes/${QUOTE_ID}/reject`, expect.objectContaining({ method: 'POST' })]);

    await user.click(screen.getAllByRole('button', { name: 'Quitar' })[0]);
    dialog = await confirmDialog();
    await user.click(within(dialog).getByRole('button', { name: 'Quitar' }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1]).toEqual([`/tickets/${TICKET_ID}/quotes/${QUOTE_ID}`, expect.objectContaining({ method: 'DELETE' })]);
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it('si descartar falla lo avisa y si se cancela la confirmación no manda nada', async () => {
    setup({
      ticket: ticket({ status: 'Presupuestado', quotes: [quote()] }),
      post: () => {
        throw new ApiRequestError(409, 'QUOTE_NOT_PENDING', 'El presupuesto ya no está pendiente');
      },
    });
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button', { name: 'Descartar' })[0]);
    let dialog = await confirmDialog();
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(writes()).toHaveLength(0);

    await user.click(screen.getAllByRole('button', { name: 'Descartar' })[0]);
    dialog = await confirmDialog();
    await user.click(within(dialog).getByRole('button', { name: 'Descartar' }));
    expect(await screen.findByText(/ya no está pendiente/)).toBeInTheDocument();
  });
});

describe('Reparación: pago e imputación', () => {
  beforeEach(() => {
    auth.role = 'Liquidaciones';
  });

  const worked = (o: Partial<RepairTicket> = {}) =>
    ticket({ status: 'TrabajoRealizado', providerId: PROVIDER_ID, costAmount: '80000', costCurrency: 'ARS', ...o });
  const paid = {
    items: [{ id: 'm1', date: '2026-10-21T00:00:00.000Z', amount: '80000', currency: 'ARS', note: 'Anticipo', account: { id: CAJA_ID, name: 'Caja ARS' } }],
    total: '80000.00',
    currency: 'ARS',
  };

  it('registra un pago al proveedor desde una cuenta de la inmobiliaria en la moneda del trabajo', async () => {
    const { onChanged } = setup({ ticket: worked(), payments: { items: [], total: '0.00', currency: null } });
    const user = userEvent.setup();
    await screen.findByRole('option', { name: 'Caja ARS (ARS)' });
    expect(screen.queryByRole('option', { name: /Banco Dólares/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Registrar pago' }));
    await waitFor(() => expect(field('Cuenta')).toHaveAttribute('aria-invalid', 'true'));
    expect(writes()).toHaveLength(0);

    await user.selectOptions(field('Cuenta'), CAJA_ID);
    await user.type(field('Importe'), '30000');
    await user.click(screen.getByRole('button', { name: 'Registrar pago' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][0]).toBe(`/tickets/${TICKET_ID}/provider-payments`);
    expect(body()).toMatchObject({ accountId: CAJA_ID, amount: '30000' });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Pago registrado en la caja.'));
    expect(onChanged).toHaveBeenCalled();
  });

  it('muestra los pagos hechos con el total y lo aprobado', async () => {
    setup({ ticket: worked(), payments: paid });
    expect(await screen.findAllByText('Anticipo')).not.toHaveLength(0);
    expect(screen.getByText(/Pagado:/)).toBeInTheDocument();
    expect(screen.getByText(/Aprobado:/)).toBeInTheDocument();
  });

  it('sin cuentas en la moneda del trabajo lo explica', async () => {
    setup({ ticket: worked({ costCurrency: 'EUR' }) });
    expect(await screen.findByText(/No hay una cuenta de la inmobiliaria en EUR/)).toBeInTheDocument();
  });

  it('imputa al locador con un honorario en porcentaje, tras confirmar', async () => {
    const { onChanged } = setup({
      ticket: worked(),
      payments: paid,
      post: () => ({ total: '80000.00', currency: 'ARS', charge: { id: 'c1', status: 'Pendiente', chargedTo: 'Locador' }, feeCharge: { id: 'c2', amount: '8000.00' } }),
    });
    const user = userEvent.setup();
    await screen.findAllByText('Anticipo');

    await user.click(screen.getByRole('button', { name: 'Imputar gasto' }));
    await waitFor(() => expect(field('Quién paga')).toHaveAttribute('aria-invalid', 'true'));
    expect(writes()).toHaveLength(0);

    await user.selectOptions(field('Quién paga'), 'Locador');
    await user.selectOptions(field('Honorario por gestión'), 'Percent');
    await user.type(field('Porcentaje'), '10');
    await user.click(screen.getByRole('button', { name: 'Imputar gasto' }));
    const dialog = await confirmDialog();
    expect(within(dialog).getByText(/Se carga .*80\.000.* a El locador/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Imputar' }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][0]).toBe(`/tickets/${TICKET_ID}/impute`);
    expect(body()).toEqual({ chargedTo: 'Locador', managementFee: { mode: 'Percent', pct: 10 } });
    expect(await screen.findByText(/Honorario por gestión: .*8\.000/)).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it('con importe fijo manda el importe; a la inmobiliaria no hay honorario', async () => {
    setup({ ticket: worked(), payments: paid, post: () => ({ total: '80000.00', currency: 'ARS', charge: { id: 'c1' }, feeCharge: null }) });
    const user = userEvent.setup();
    await screen.findAllByText('Anticipo');

    await user.selectOptions(field('Quién paga'), 'Inquilino');
    await user.selectOptions(field('Honorario por gestión'), 'Fixed');
    await user.type(field('Importe del honorario'), '1500,50');
    await user.click(screen.getByRole('button', { name: 'Imputar gasto' }));
    await user.click(within(await confirmDialog()).getByRole('button', { name: 'Imputar' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(body()).toEqual({ chargedTo: 'Inquilino', managementFee: { mode: 'Fixed', amount: '1500.50' } });

    await user.selectOptions(field('Quién paga'), 'Inmobiliaria');
    expect(screen.queryByLabelText(/^Honorario por gestión/)).toBeNull();
  });

  it('un honorario fijo sin importe no se manda', async () => {
    setup({ ticket: worked(), payments: paid });
    const user = userEvent.setup();
    await screen.findAllByText('Anticipo');
    await user.selectOptions(field('Quién paga'), 'Locador');
    await user.selectOptions(field('Honorario por gestión'), 'Fixed');
    await user.click(screen.getByRole('button', { name: 'Imputar gasto' }));
    expect(await screen.findByText(/Revisá el honorario/)).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it('cancelar la confirmación no imputa; un error de la API se muestra', async () => {
    setup({
      ticket: worked({ costPayer: 'Locador' }),
      payments: paid,
      post: () => {
        throw new ApiRequestError(409, 'TICKET_ALREADY_IMPUTED', 'El gasto ya se imputó');
      },
    });
    const user = userEvent.setup();
    await screen.findAllByText('Anticipo');
    // El pagador ya anotado en el ticket viene elegido.
    expect(field('Quién paga')).toHaveValue('Locador');
    await user.click(screen.getByRole('button', { name: 'Imputar gasto' }));
    await user.click(within(await confirmDialog()).getByRole('button', { name: 'Cancelar' }));
    expect(writes()).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Imputar gasto' }));
    await user.click(within(await confirmDialog()).getByRole('button', { name: 'Imputar' }));
    expect(await screen.findByText(/El gasto ya se imputó/)).toBeInTheDocument();
  });

  it('un ticket ya imputado dice a quién y no ofrece pagar ni imputar', async () => {
    setup({ ticket: worked({ imputedAt: '2026-11-01T10:00:00.000Z', costPayer: 'Inquilino' }), payments: paid });
    expect(await screen.findByText('El gasto ya se imputó a: El inquilino.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Registrar pago' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Imputar gasto' })).toBeNull();
  });

  it('antes de que el trabajo termine explica cuándo se puede imputar', async () => {
    setup({ ticket: ticket({ status: 'Presupuestado' }) });
    expect(await screen.findByText(/Se puede imputar cuando el trabajo esté terminado/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Registrar pago' })).toBeNull();
  });

  it('soporte ve los pagos pero no puede pagar ni imputar', async () => {
    auth.role = 'Soporte';
    const first = setup({ ticket: worked(), payments: paid });
    await screen.findAllByText('Anticipo');
    expect(screen.queryByRole('button', { name: 'Registrar pago' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Imputar gasto' })).toBeNull();
    expect(first.onChanged).not.toHaveBeenCalled();
  });

  it('si no cargan los pagos lo avisa', async () => {
    apiClient.mockImplementation(async (path: string) => {
      if (path.startsWith('/providers?') || path.startsWith('/persons?')) return { data: [], items: [] };
      throw new ApiRequestError(500, 'INTERNAL_ERROR', 'boom');
    });
    renderEs(<RepairSection ticket={worked()} onChanged={vi.fn()} />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
