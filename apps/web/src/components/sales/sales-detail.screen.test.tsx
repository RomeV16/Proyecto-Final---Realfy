// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEsWithQuery } from '../index-data/test-utils';
import { BUYER_ID, deposit, doc, OP_ID, operation, party, SELLER_ID } from './sales.testing';
import type { SalesOperation } from '@/lib/sales';

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

import { ApiRequestError } from '@/lib/api-client';
import { SalesDetail } from './sales-detail';

let current: SalesOperation;
let fail = false;

const writes = () => apiClient.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET');
const lastWrite = () => {
  const [path, init] = writes().at(-1)!;
  return { path: path as string, method: init.method as string, body: init.body ? JSON.parse(init.body) : undefined };
};

function setup(op: SalesOperation, role = 'Admin') {
  auth.role = role;
  current = op;
  fail = false;
  apiClient.mockReset();
  apiClient.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (fail && init?.method) throw new ApiRequestError(409, 'X', 'No se pudo');
    if (path === `/sales-operations/${OP_ID}/fee-proposal`) {
      return { pct: '3', baseAmount: '115000', currency: 'USD', saleAsset: 'Construido', firstDueDate: '2026-11-10', payers: [] };
    }
    if (path.startsWith('/persons?')) return { items: [{ id: 'new-person', firstName: 'Nora', lastName: 'Nueva' }] };
    if (path === `/sales-operations/${OP_ID}` && !init?.method) {
      if (fail) throw new ApiRequestError(500, 'X', 'caído');
      return current;
    }
    return {};
  });
  renderEsWithQuery(<SalesDetail id={OP_ID} />);
}

beforeEach(() => {
  apiClient.mockReset();
});

const dialog = () => within(screen.getByRole('dialog'));
/** Los botones de las filas están en la tabla y en las tarjetas del móvil: se usa el primero. */
const first = async (name: string) => (await screen.findAllByRole('button', { name }))[0];
const none = (name: string) => expect(screen.queryAllByRole('button', { name })).toHaveLength(0);

describe('Ventas: detalle', () => {
  it('muestra la etapa, el resumen, las partes, las señas y la documentación', async () => {
    setup(
      operation({
        status: 'Reservada',
        agreedPrice: '115000.00',
        boletoDate: '2026-11-20T00:00:00.000Z',
        exclusive: true,
        validTransitions: ['SenaRecibida', 'Publicada', 'Cancelada'],
        deposits: [deposit({ status: 'Recibida', receivedAt: '2026-11-01T00:00:00.000Z', unresolvedMoney: true, expired: true, expiresAt: '2000-01-01T00:00:00.000Z' })],
      }),
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'Depto Sintético · Calle Ficticia 100' })).toBeInTheDocument();
    expect(screen.getAllByText('Reservada').length).toBeGreaterThan(0);
    expect(screen.getByText('Exclusiva')).toBeInTheDocument();
    expect(screen.getByText('Vera Sintético')).toBeInTheDocument();
    expect(screen.getByText('Beto Sintético')).toBeInTheDocument();
    expect(screen.getByText('1 de 2 documentos obligatorios reunidos')).toBeInTheDocument();
    expect(screen.getAllByText('Dinero recibido sin resolver').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Ver la propiedad' })).toHaveAttribute('href', expect.stringContaining('/properties/'));
    expect(screen.getByRole('checkbox', { name: /Informe de dominio/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Informe de inhibición/ })).not.toBeChecked();
    expect(screen.getByText('Todavía no hay honorario pactado.')).toBeInTheDocument();
  });

  it('reservar abre la confirmación y envía la etapa con el precio pactado', async () => {
    setup(operation({ deposits: [deposit()] }));
    await userEvent.click(await screen.findByRole('button', { name: 'Reservar' }));
    await screen.findByRole('dialog');
    expect(dialog().getByText('Requiere un comprador y una reserva cargada.')).toBeInTheDocument();
    await userEvent.type(dialog().getByLabelText('Precio pactado (opcional)'), '115000');
    await userEvent.click(dialog().getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(lastWrite()).toMatchObject({ path: `/sales-operations/${OP_ID}/transition`, method: 'POST', body: { to: 'Reservada', agreedPrice: '115000' } }));
  });

  it('cancelar exige el motivo', async () => {
    setup(operation());
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar operación' }));
    await screen.findByRole('dialog');
    await userEvent.click(dialog().getByRole('button', { name: 'Confirmar' }));
    expect(await dialog().findByText('Este dato es obligatorio.')).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
    await userEvent.type(dialog().getByLabelText(/Motivo/), 'el comprador desistió');
    await userEvent.click(dialog().getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(lastWrite().body).toMatchObject({ to: 'Cancelada', reason: 'el comprador desistió' }));
  });

  it('el boleto pide su fecha y, si falta documentación obligatoria, el motivo para seguir', async () => {
    setup(operation({ status: 'SenaRecibida', validTransitions: ['Boleto', 'Publicada', 'Cancelada'] }));
    await userEvent.click(await screen.findByRole('button', { name: 'Pasar a boleto' }));
    await screen.findByRole('dialog');
    await userEvent.type(dialog().getByLabelText(/Motivo para seguir/), 'el escribano reúne los informes');
    await userEvent.click(dialog().getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(lastWrite().body).toMatchObject({ to: 'Boleto', docsOverrideReason: 'el escribano reúne los informes' }));
    expect(lastWrite().body.boletoDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('con la documentación completa el boleto no pide motivo; escriturar pide la fecha', async () => {
    setup(operation({ status: 'Boleto', docProgress: { done: 2, total: 3, requiredDone: 2, requiredTotal: 2 }, validTransitions: ['Escriturada', 'Cancelada'] }));
    await userEvent.click(await screen.findByRole('button', { name: 'Registrar escritura' }));
    await screen.findByRole('dialog');
    expect(dialog().getByLabelText(/Fecha de la escritura/)).toBeInTheDocument();
    await userEvent.click(dialog().getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(lastWrite().body).toMatchObject({ to: 'Escriturada' }));
  });

  it('un error al cambiar de etapa se muestra en el diálogo', async () => {
    setup(operation({ validTransitions: ['Publicada'], status: 'Captacion' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Publicar o liberar' }));
    fail = true;
    await userEvent.click(dialog().getByRole('button', { name: 'Confirmar' }));
    expect(await dialog().findByText(/No se pudo/)).toBeInTheDocument();
  });

  it('edita las partes: suma a otro vendedor, avisa si no suma 100 y guarda', async () => {
    setup(operation());
    await userEvent.click(await screen.findByRole('button', { name: 'Editar partes' }));
    await screen.findByRole('dialog');
    await userEvent.type(dialog().getByLabelText('Agregar Vendedor'), 'No');
    await userEvent.click(await dialog().findByRole('button', { name: /Nora Nueva/ }));
    await userEvent.click(dialog().getByRole('button', { name: 'Guardar partes' }));
    expect(await dialog().findByText('Cada parte tiene que ser mayor a cero.')).toBeInTheDocument();
    const shareNora = dialog().getByLabelText('Parte de Nora Nueva');
    await userEvent.type(shareNora, '40');
    await userEvent.click(dialog().getByRole('button', { name: 'Guardar partes' }));
    expect(await dialog().findByText('Las partes de Vendedor tienen que sumar 100 %.')).toBeInTheDocument();
    const shareVera = dialog().getByLabelText('Parte de Vera Sintético');
    await userEvent.clear(shareVera);
    await userEvent.type(shareVera, '60');
    await userEvent.click(dialog().getByRole('button', { name: 'Guardar partes' }));
    await waitFor(() => expect(lastWrite()).toMatchObject({ path: `/sales-operations/${OP_ID}/parties`, method: 'PUT' }));
    expect(lastWrite().body.parties).toEqual([
      { role: 'Vendedor', personId: SELLER_ID, sharePct: '60' },
      { role: 'Comprador', personId: BUYER_ID, sharePct: '100' },
      { role: 'Vendedor', personId: 'new-person', sharePct: '40' },
    ]);
  });

  it('quitar una parte la saca de la lista', async () => {
    setup(operation({ parties: [party('Vendedor', SELLER_ID, 'Vera'), party('Comprador', BUYER_ID, 'Beto')] }));
    await userEvent.click(await screen.findByRole('button', { name: 'Editar partes' }));
    await screen.findByRole('dialog');
    await userEvent.click(dialog().getByRole('button', { name: 'Quitar a Beto Sintético' }));
    expect(dialog().queryByLabelText('Parte de Beto Sintético')).not.toBeInTheDocument();
    await userEvent.click(dialog().getByRole('button', { name: 'Guardar partes' }));
    await waitFor(() => expect(lastWrite().body.parties).toHaveLength(1));
  });

  it('tilda la documentación', async () => {
    setup(operation());
    await userEvent.click(await screen.findByRole('checkbox', { name: /Informe de inhibición/ }));
    await waitFor(() => expect(lastWrite()).toMatchObject({ path: `/sales-operations/${OP_ID}/docs/informe_inhibicion`, method: 'PATCH', body: { done: true } }));
  });
});

describe('Ventas: reservas y señas', () => {
  it('agrega una reserva con vencimiento y quién la entrega', async () => {
    setup(operation());
    await userEvent.click(await screen.findByRole('button', { name: 'Agregar reserva o seña' }));
    await screen.findByRole('dialog');
    await userEvent.type(dialog().getByLabelText(/^Importe/), '2000');
    await userEvent.selectOptions(dialog().getByLabelText(/Comprador que lo entrega/), BUYER_ID);
    await userEvent.type(dialog().getByLabelText(/^Vencimiento/), '2026-12-01');
    await userEvent.click(dialog().getByRole('button', { name: 'Guardar' }));
    await waitFor(() =>
      expect(lastWrite()).toMatchObject({
        path: `/sales-operations/${OP_ID}/deposits`,
        method: 'POST',
        body: { kind: 'Reserva', amount: '2000', currency: 'USD', holder: 'Inmobiliaria', payerPersonId: BUYER_ID, expiresAt: '2026-12-01' },
      }),
    );
  });

  it('una seña no pide vencimiento', async () => {
    setup(operation({ status: 'Reservada' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Agregar reserva o seña' }));
    await screen.findByRole('dialog');
    await userEvent.selectOptions(dialog().getByLabelText(/^Tipo/), 'Sena');
    expect(dialog().queryByLabelText(/^Vencimiento/)).not.toBeInTheDocument();
    await userEvent.type(dialog().getByLabelText(/^Importe/), '10000');
    await userEvent.click(dialog().getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(lastWrite().body).toMatchObject({ kind: 'Sena', amount: '10000', expiresAt: null }));
  });

  it('recibe el dinero eligiendo el medio y se puede prorrogar la reserva', async () => {
    setup(operation({ status: 'Reservada', deposits: [deposit()] }));
    await userEvent.click(await first('Recibir'));
    await screen.findByRole('dialog');
    await userEvent.selectOptions(dialog().getByLabelText(/^Medio/), 'Transferencia');
    await userEvent.click(dialog().getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(lastWrite()).toMatchObject({ path: `/sales-operations/${OP_ID}/deposits/dep-1/receive`, body: { method: 'Transferencia' } }));

    await userEvent.click(await first('Prorrogar'));
    await screen.findByRole('dialog');
    const date = dialog().getByLabelText(/^Vencimiento/);
    await userEvent.clear(date);
    await userEvent.type(date, '2027-01-15');
    await userEvent.click(dialog().getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(lastWrite()).toMatchObject({ path: `/sales-operations/${OP_ID}/deposits/dep-1`, method: 'PATCH', body: { expiresAt: '2027-01-15' } }));
  });

  it('si lo guarda el escribano no pide el medio', async () => {
    setup(operation({ status: 'Reservada', deposits: [deposit({ holder: 'Escribano', kind: 'Sena', expiresAt: null })] }));
    await userEvent.click(await first('Recibir'));
    await screen.findByRole('dialog');
    expect(dialog().queryByLabelText(/^Medio/)).not.toBeInTheDocument();
  });

  it('devuelve lo recibido y retiene con motivo; solo la administración ve esos botones', async () => {
    const received = deposit({ status: 'Recibida', receivedAt: '2026-11-01T00:00:00.000Z', unresolvedMoney: true });
    setup(operation({ status: 'Reservada', deposits: [received] }));
    await userEvent.click(await first('Devolver'));
    await screen.findByRole('dialog');
    expect(dialog().getByText(/No se calcula ninguna devolución en doble/)).toBeInTheDocument();
    await userEvent.type(dialog().getByLabelText(/^Importe/), '1500');
    await userEvent.click(dialog().getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(lastWrite()).toMatchObject({ path: `/sales-operations/${OP_ID}/deposits/dep-1/refund`, body: { amount: '1500', method: 'Efectivo' } }));

    await userEvent.click(await first('Retener'));
    await screen.findByRole('dialog');
    await userEvent.click(dialog().getByRole('button', { name: 'Confirmar' }));
    expect(await dialog().findByText('Este dato es obligatorio.')).toBeInTheDocument();
    await userEvent.type(dialog().getByLabelText(/Motivo y fundamento/), 'cláusula de pérdida');
    await userEvent.click(dialog().getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(lastWrite()).toMatchObject({ path: `/sales-operations/${OP_ID}/deposits/dep-1/forfeit`, body: { note: 'cláusula de pérdida' } }));
  });

  it('Ventas carga y recibe, pero no devuelve ni retiene; Lectura no ve acciones', async () => {
    const received = deposit({ status: 'Recibida', receivedAt: '2026-11-01T00:00:00.000Z', unresolvedMoney: true });
    setup(operation({ status: 'Reservada', deposits: [received, deposit({ id: 'dep-2' })] }), 'Ventas');
    await screen.findByRole('heading', { level: 1 });
    expect(await first('Recibir')).toBeInTheDocument();
    none('Devolver');
    none('Retener');
  });

  it('Lectura mira sin poder cambiar nada', async () => {
    setup(operation({ status: 'Reservada', deposits: [deposit()] }), 'Lectura');
    await screen.findByRole('heading', { level: 1 });
    for (const name of ['Recibir', 'Agregar reserva o seña', 'Editar partes', 'Reservar']) {
      none(name);
    }
    expect(screen.getByRole('checkbox', { name: /Informe de dominio/ })).toBeDisabled();
  });
});

describe('Ventas: honorario', () => {
  it('propone el porcentaje por defecto y crea el honorario', async () => {
    setup(operation({ status: 'SenaRecibida', docs: [doc('informe_dominio')], validTransitions: ['Boleto'] }));
    await userEvent.click(await screen.findByRole('button', { name: 'Pactar honorario' }));
    expect(await screen.findByText(/Por defecto: 3 % \(inmueble construido\)/)).toBeInTheDocument();
    await userEvent.click(dialog().getByRole('button', { name: 'Crear honorario' }));
    await waitFor(() =>
      expect(lastWrite()).toMatchObject({
        path: `/sales-operations/${OP_ID}/fee`,
        method: 'POST',
        body: { pct: '3', baseAmount: '115000', installments: 1, firstDueDate: '2026-11-10' },
      }),
    );
  });

  it('con el honorario pactado lista a quien paga y no ofrece pactar otro', async () => {
    setup(
      operation({
        status: 'Boleto',
        fees: [
          { id: 'f1', status: 'Pendiente', payerRole: 'Comprador', total: '3450.00', currency: 'USD', pct: '3.0000' },
          { id: 'f2', status: 'Anulado', payerRole: 'Vendedor', total: '3450.00', currency: 'USD', pct: '3.0000' },
        ],
      }),
    );
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByText('3 %')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pactar honorario' })).not.toBeInTheDocument();
  });

  it('la gerencia pacta el honorario; Ventas no', async () => {
    setup(operation({ status: 'Reservada', validTransitions: ['SenaRecibida'] }), 'Ventas');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('button', { name: 'Pactar honorario' })).not.toBeInTheDocument();
  });
});

describe('Ventas: estados de la pantalla', () => {
  it('un error de carga se muestra con su aviso', async () => {
    auth.role = 'Admin';
    apiClient.mockReset();
    apiClient.mockRejectedValue(new ApiRequestError(500, 'X', 'caído'));
    renderEsWithQuery(<SalesDetail id={OP_ID} />);
    expect(await screen.findByText(/caído|No se pudo cargar la operación/)).toBeInTheDocument();
  });

  it('sin permiso no pide nada', () => {
    auth.role = 'Liquidaciones';
    apiClient.mockReset();
    renderEsWithQuery(<SalesDetail id={OP_ID} />);
    expect(screen.getByText('No tenés permiso para ver las ventas.')).toBeInTheDocument();
    expect(apiClient).not.toHaveBeenCalled();
  });
});
