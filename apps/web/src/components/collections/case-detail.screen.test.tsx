// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '../index-data/test-utils';

const { apiClient, auth, toastSuccess, toastError, downloadFile } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  auth: { role: 'Liquidaciones' },
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
  usePathname: () => '/es/cobranza/c1',
  useParams: () => ({ id: 'c1' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

import { ApiRequestError } from '@/lib/api-client';
import CollectionCasePage from '@/app/[locale]/(app)/cobranza/[id]/page';

const LETTER = {
  recipientName: 'Ana Prueba',
  recipientAddress: 'Calle Falsa 123',
  propertyAddress: 'Calle Demo 742',
  periods: '03/2026 y 04/2026',
  amount: 'ARS 203.000,00',
  issuedOn: '11/04/2026',
  termDays: 10,
  extraText: '',
};

function action(id: string, o: Record<string, unknown> = {}) {
  return {
    id,
    kind: 'Nota',
    status: 'Realizada',
    level: null,
    channel: null,
    outboxMessageId: null,
    messageStatus: null,
    messageStatusReason: null,
    amount: null,
    onDate: null,
    note: null,
    letter: null,
    createdByName: null,
    at: '2026-03-15T13:00:00.000Z',
    ...o,
  };
}

function detail(o: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    contractId: 'k1',
    propertyLabel: 'Calle Demo 742',
    tenantNames: 'Ana Prueba',
    stage: 'Prejudicial',
    currency: 'ARS',
    overdueSince: '2026-03-10T00:00:00.000Z',
    daysOverdue: 32,
    balance: '200000.00',
    payoffToday: '203000.00',
    nextAction: 'CartaDocumento',
    nextActionAt: null,
    planStatus: 'AwaitingLetterConfirmation',
    pausedUntil: null,
    assigneeId: null,
    assigneeName: null,
    openedAt: '2026-03-15T13:00:00.000Z',
    closedAt: null,
    nextActionManual: true,
    closeReason: null,
    debt: [
      { liquidacionId: 'l1', period: '2026-03-01T00:00:00.000Z', dueDate: '2026-03-10T00:00:00.000Z', daysOverdue: 32, balance: '100000.00', penalty: '3000.00', total: '103000.00' },
      { liquidacionId: 'l2', period: '2026-04-01T00:00:00.000Z', dueDate: '2026-04-10T00:00:00.000Z', daysOverdue: 1, balance: '100000.00', penalty: '0.00', total: '100000.00' },
    ],
    actions: [
      action('a4', { kind: 'CartaDocumento', status: 'Preparada', letter: LETTER, amount: '203000.00', at: '2026-04-11T13:00:00.000Z' }),
      action('a3', { kind: 'Nota', note: 'Habló por teléfono', createdByName: 'Rosa Demo', at: '2026-03-27T13:00:00.000Z' }),
      action('a2', { kind: 'RecordatorioFirme', level: 2, channel: 'WhatsApp', messageStatus: 'Delivered', amount: '102000.00', onDate: '2026-03-20T00:00:00.000Z', at: '2026-03-20T13:00:00.000Z' }),
      action('a1', { kind: 'Recordatorio', level: 1, note: 'Sin medio de contacto', at: '2026-03-15T13:00:00.000Z' }),
    ],
    ...o,
  };
}

function mockApi(data: Record<string, unknown> = detail(), write?: (path: string, init: { method: string; body: string }) => unknown) {
  apiClient.mockImplementation(async (path: string, init?: { method?: string; body?: string }) => {
    if (init?.method) {
      if (write) return write(path, init as { method: string; body: string });
      return data;
    }
    if (path === '/collection-cases/c1') return data;
    throw new Error(`unexpected ${path}`);
  });
}

const lastDialog = () => screen.getAllByRole('dialog').at(-1)!;
const writes = () => apiClient.mock.calls.filter(([, init]) => init?.method) as [string, { method: string; body: string }][];

beforeEach(() => {
  apiClient.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  downloadFile.mockReset();
  auth.role = 'Liquidaciones';
});

describe('Cobranza: detalle del caso', () => {
  it('muestra lo que se debe hoy, la deuda por liquidación y la línea de tiempo con el estado de cada aviso', async () => {
    mockApi();
    renderEs(<CollectionCasePage />);
    expect(await screen.findByRole('heading', { name: 'Calle Demo 742' })).toBeInTheDocument();
    expect(screen.getByText('Prejudicial')).toBeInTheDocument();
    expect(screen.getByText('32 días')).toBeInTheDocument();
    expect(screen.getAllByText(/203\.000,00/).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Ver el contrato' })).toHaveAttribute('href', '/es/contracts/k1');
    expect(screen.getByText('Lo decide y lo hace una persona: el sistema no lo hace solo.')).toBeInTheDocument();
    // Deuda: saldo, punitorios y total por liquidación.
    const debt = screen.getByRole('region', { name: 'Deuda vencida' });
    expect(within(debt).getAllByText(/3\.000,00/).length).toBeGreaterThan(0);
    // Línea de tiempo.
    const timeline = screen.getByRole('region', { name: 'Línea de tiempo' });
    expect(within(timeline).getByText('Recordatorio firme · tono 2')).toBeInTheDocument();
    expect(within(timeline).getByText('Entregado')).toBeInTheDocument();
    expect(within(timeline).getByText('Habló por teléfono')).toBeInTheDocument();
    expect(within(timeline).getByText('Por Rosa Demo')).toBeInTheDocument();
    expect(within(timeline).getByText('No se pudo avisar: la persona no tiene un mail o un WhatsApp con alta registrada.')).toBeInTheDocument();
    expect(within(timeline).getByText('Borrador preparado')).toBeInTheDocument();
  });

  it('el borrador de la carta se avisa como borrador, se ve en PDF y no se envía solo', async () => {
    mockApi();
    const user = userEvent.setup();
    renderEs(<CollectionCasePage />);
    const letter = await screen.findByRole('region', { name: 'Carta documento (borrador)' });
    expect(within(letter).getByText(/no se envía solo/)).toBeInTheDocument();
    expect(within(letter).getByText('03/2026 y 04/2026')).toBeInTheDocument();
    await user.click(within(letter).getByRole('button', { name: 'Ver el PDF' }));
    expect(downloadFile).toHaveBeenCalledWith('/collection-cases/c1/actions/a4/letter.pdf', 'carta-documento-a4.pdf');
    expect(writes()).toHaveLength(0);
  });

  it('un error al bajar el PDF se avisa', async () => {
    mockApi();
    downloadFile.mockRejectedValue(new Error('x'));
    const user = userEvent.setup();
    renderEs(<CollectionCasePage />);
    await user.click(await screen.findByRole('button', { name: 'Ver el PDF' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('No se pudo generar el PDF'));
  });

  it('edita el borrador de la carta y manda los campos corregidos', async () => {
    mockApi();
    const user = userEvent.setup();
    renderEs(<CollectionCasePage />);
    await user.click(await screen.findByRole('button', { name: 'Editar el borrador' }));
    const dialog = lastDialog();
    const address = within(dialog).getByLabelText(/Domicilio/);
    expect(address).toHaveValue('Calle Falsa 123');
    await user.clear(address);
    await user.type(address, 'Av. Demo 55');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar el borrador' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Borrador actualizado'));
    const [path, init] = writes()[0];
    expect(path).toBe('/collection-cases/c1/actions/a4');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ ...LETTER, recipientAddress: 'Av. Demo 55', periods: '03/2026 y 04/2026', termDays: 10, issuedOn: undefined });
  });

  it('confirma el envío de la carta con su fecha y la pieza de correo', async () => {
    mockApi();
    const user = userEvent.setup();
    renderEs(<CollectionCasePage />);
    await user.click(await screen.findByRole('button', { name: 'Confirmar que se envió' }));
    const dialog = lastDialog();
    await user.clear(within(dialog).getByLabelText(/Fecha de envío/));
    await user.type(within(dialog).getByLabelText(/Fecha de envío/), '2026-04-13');
    await user.type(within(dialog).getByLabelText(/Pieza de correo/), 'CD 123');
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar el envío' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Envío confirmado'));
    const [path, init] = writes()[0];
    expect(path).toBe('/collection-cases/c1/actions/a4/sent');
    expect(JSON.parse(init.body)).toEqual({ sentOn: '2026-04-13', note: 'CD 123' });
  });

  it('agrega una nota y exige el texto', async () => {
    mockApi();
    const user = userEvent.setup();
    renderEs(<CollectionCasePage />);
    await user.click(await screen.findByRole('button', { name: 'Agregar una nota' }));
    await user.click(within(lastDialog()).getByRole('button', { name: 'Guardar la nota' }));
    expect(writes()).toHaveLength(0);
    expect(within(lastDialog()).getByText('Este campo es obligatorio')).toBeInTheDocument();
    await user.type(within(lastDialog()).getByLabelText(/Nota/), '  Prometió pagar  ');
    await user.click(within(lastDialog()).getByRole('button', { name: 'Guardar la nota' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Nota agregada'));
    expect(writes()[0][0]).toBe('/collection-cases/c1/notes');
    expect(JSON.parse(writes()[0][1].body)).toEqual({ note: 'Prometió pagar' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('registra un acuerdo de pago con fecha, importe y nota', async () => {
    mockApi();
    const user = userEvent.setup();
    renderEs(<CollectionCasePage />);
    await user.click(await screen.findByRole('button', { name: 'Registrar un acuerdo de pago' }));
    const dialog = lastDialog();
    await user.clear(within(dialog).getByLabelText(/Fecha prometida/));
    await user.type(within(dialog).getByLabelText(/Fecha prometida/), '2026-04-30');
    await user.type(within(dialog).getByLabelText(/Importe prometido/), '50000,50');
    await user.type(within(dialog).getByLabelText(/Nota/), 'Paga la mitad');
    await user.click(within(dialog).getByRole('button', { name: 'Registrar el acuerdo' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Acuerdo registrado'));
    expect(JSON.parse(writes()[0][1].body)).toEqual({ payOn: '2026-04-30', amount: '50000.50', note: 'Paga la mitad' });
  });

  it('un error de la API al guardar se muestra dentro del diálogo y no lo cierra', async () => {
    mockApi(detail(), () => {
      throw new ApiRequestError(409, 'CASE_CLOSED', 'closed');
    });
    const user = userEvent.setup();
    renderEs(<CollectionCasePage />);
    await user.click(await screen.findByRole('button', { name: 'Agregar una nota' }));
    await user.type(within(lastDialog()).getByLabelText(/Nota/), 'x');
    await user.click(within(lastDialog()).getByRole('button', { name: 'Guardar la nota' }));
    expect(await within(lastDialog()).findByRole('alert')).toHaveTextContent('El caso de cobranza está cerrado.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('la gerencia deriva a un abogado, y la derivación solo se ofrece a quien puede', async () => {
    auth.role = 'Gerente';
    mockApi();
    const user = userEvent.setup();
    renderEs(<CollectionCasePage />);
    await user.click(await screen.findByRole('button', { name: 'Derivar a un abogado' }));
    expect(within(lastDialog()).getByText(/el sistema no deriva solo/)).toBeInTheDocument();
    await user.type(within(lastDialog()).getByLabelText(/Abogado o estudio/), 'Estudio Demo');
    await user.click(within(lastDialog()).getByRole('button', { name: 'Derivar' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Caso derivado'));
    expect(writes()[0][0]).toBe('/collection-cases/c1/derive');
    expect(JSON.parse(writes()[0][1].body)).toEqual({ lawyer: 'Estudio Demo' });
  });

  it('Liquidaciones no ve derivar ni pasar a judicial', async () => {
    mockApi();
    renderEs(<CollectionCasePage />);
    await screen.findByRole('button', { name: 'Agregar una nota' });
    expect(screen.queryByRole('button', { name: 'Derivar a un abogado' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pasar a la vía judicial' })).not.toBeInTheDocument();
  });

  it('con el caso en manos del abogado la gerencia lo pasa a judicial', async () => {
    auth.role = 'Admin';
    mockApi(detail({ stage: 'Abogado', planStatus: 'Manual', nextAction: null, actions: [] }));
    const user = userEvent.setup();
    renderEs(<CollectionCasePage />);
    expect(await screen.findByText('Todavía no pasó nada en este caso.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Derivar a un abogado' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Pasar a la vía judicial' }));
    await user.type(within(lastDialog()).getByLabelText(/Nota/), 'Expediente 1234/26');
    await user.click(within(lastDialog()).getByRole('button', { name: 'Pasar a judicial' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('El caso pasó a judicial'));
    expect(writes()[0][0]).toBe('/collection-cases/c1/judicial');
    expect(JSON.parse(writes()[0][1].body)).toEqual({ note: 'Expediente 1234/26' });
  });

  it('cierra el caso con un motivo obligatorio', async () => {
    mockApi();
    const user = userEvent.setup();
    renderEs(<CollectionCasePage />);
    await user.click(await screen.findByRole('button', { name: 'Cerrar el caso' }));
    await user.type(within(lastDialog()).getByLabelText(/Motivo del cierre/), 'Pagó en la oficina');
    await user.click(within(lastDialog()).getByRole('button', { name: 'Cerrar el caso' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Caso cerrado'));
    expect(writes()[0][0]).toBe('/collection-cases/c1/close');
    expect(JSON.parse(writes()[0][1].body)).toEqual({ note: 'Pagó en la oficina' });
  });

  it('se asigna el caso y se quita el responsable', async () => {
    mockApi(detail({ assigneeId: null }));
    const user = userEvent.setup();
    const { unmount } = renderEs(<CollectionCasePage />);
    await user.click(await screen.findByRole('button', { name: 'Asignarme' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Responsable actualizado'));
    expect(writes()[0][0]).toBe('/collection-cases/c1');
    expect(writes()[0][1].method).toBe('PATCH');
    expect(JSON.parse(writes()[0][1].body)).toEqual({ assigneeId: 'u1' });
    unmount();

    apiClient.mockReset();
    mockApi(detail({ assigneeId: 'u1', assigneeName: 'Rosa Demo' }));
    renderEs(<CollectionCasePage />);
    expect(await screen.findByText(/a cargo de Rosa Demo/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Asignarme' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Quitar responsable' }));
    await waitFor(() => expect(JSON.parse(writes()[0][1].body)).toEqual({ assigneeId: null }));
  });

  it('un error al asignar se avisa con el texto del código', async () => {
    mockApi(detail(), () => {
      throw new ApiRequestError(400, 'ASSIGNEE_NOT_FOUND', 'x');
    });
    const user = userEvent.setup();
    renderEs(<CollectionCasePage />);
    await user.click(await screen.findByRole('button', { name: 'Asignarme' }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });

  it('un caso cerrado no ofrece acciones y dice cómo se cerró', async () => {
    mockApi(detail({ stage: 'Cerrado', closeReason: 'Pagado', closedAt: '2026-04-20T00:00:00.000Z', planStatus: 'Close', nextAction: null, actions: [action('a1', { kind: 'Pago', amount: '203000.00' })] }));
    renderEs(<CollectionCasePage />);
    expect(await screen.findByText('Caso cerrado')).toBeInTheDocument();
    expect(screen.getByText('Cerrado por pago')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Agregar una nota' })).not.toBeInTheDocument();
  });

  it('Lectura ve el caso sin acciones', async () => {
    auth.role = 'Lectura';
    mockApi();
    renderEs(<CollectionCasePage />);
    expect(await screen.findByRole('heading', { name: 'Calle Demo 742' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Agregar una nota' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar el borrador' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver el PDF' })).toBeInTheDocument();
  });

  it('un rol sin acceso ve el aviso y no consulta la API', () => {
    auth.role = 'Ventas';
    mockApi();
    renderEs(<CollectionCasePage />);
    expect(screen.getByText('Tu rol no tiene acceso a la cobranza.')).toBeInTheDocument();
    expect(apiClient).not.toHaveBeenCalled();
  });

  it('un error al cargar se muestra', async () => {
    apiClient.mockRejectedValue(new ApiRequestError(404, 'COLLECTION_CASE_NOT_FOUND', 'no'));
    renderEs(<CollectionCasePage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('El caso de cobranza no existe.');
  });

  it('con un acuerdo vigente muestra hasta cuándo rige', async () => {
    mockApi(detail({ planStatus: 'Paused', pausedUntil: '2026-04-30T00:00:00.000Z', nextAction: null, nextActionManual: false, actions: [], debt: [] }));
    renderEs(<CollectionCasePage />);
    expect(await screen.findByText(/Acuerdo de pago hasta el/)).toBeInTheDocument();
    expect(screen.getByText('No hay deuda vencida: el caso se cierra en la próxima pasada diaria.')).toBeInTheDocument();
  });
});
