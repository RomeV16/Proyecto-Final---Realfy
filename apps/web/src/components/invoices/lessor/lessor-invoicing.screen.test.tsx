// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '../../index-data/test-utils';

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
vi.mock('@/lib/toast', () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a), info: vi.fn() },
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/es/locadores/p-1',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

import { ApiRequestError } from '@/lib/api-client';
import { LessorInvoicingTab } from './lessor-invoicing-tab';
import { SourceInvoicesPanel } from './source-invoices-panel';
import { PendingLessorInvoices } from './pending-lessor-invoices';

const AGENCY = { scope: 'Alquiler', when: 'Manual', vatPct: 0 };
const ISSUER = {
  id: 'i-1',
  cuit: '20123456786',
  businessName: 'Ana Locadora',
  fiscalCondition: 'Monotributista',
  delegationStatus: 'Pending',
  delegationVerifiedAt: null,
  delegationLastError: null,
  isActive: true,
  puntosDeVenta: [{ id: 'pv1', number: 3, nombre: null, bloqueado: false }],
};
const state = (o: Record<string, unknown> = {}) => ({
  person: { id: 'p-1', name: 'Ana Locadora', cuit: '20123456786', fiscalCondition: 'Monotributista' },
  issuer: ISSUER,
  override: null,
  autoSince: null,
  agencyDefaults: AGENCY,
  effective: AGENCY,
  ...o,
});

describe('LessorInvoicingTab', () => {
  beforeEach(() => {
    apiClient.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    auth.role = 'Admin';
  });

  it('sin emisor ofrece crearlo y lo refresca', async () => {
    const user = userEvent.setup();
    let created = false;
    apiClient.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        created = true;
        return {};
      }
      return created ? state() : state({ issuer: null });
    });
    renderEs(<LessorInvoicingTab personId="p-1" />);
    expect(await screen.findByText('Este locador todavía no tiene emisor delegado.')).toBeInTheDocument();
    expect(screen.queryByText('Qué y cuándo se factura')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Crear emisor delegado' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(apiClient).toHaveBeenCalledWith('/persons/p-1/invoicing-issuer', { method: 'POST' });
    expect(await screen.findByText('20123456786')).toBeInTheDocument();
  });

  it('muestra el emisor y su delegación, y la verifica y sincroniza los puntos de venta', async () => {
    const user = userEvent.setup();
    apiClient.mockImplementation(async () => state({ issuer: { ...ISSUER, delegationStatus: 'Active', delegationVerifiedAt: '2026-11-01T12:00:00.000Z', delegationLastError: 'Aviso previo' } }));
    renderEs(<LessorInvoicingTab personId="p-1" />);
    expect(await screen.findByText('Ana Locadora')).toBeInTheDocument();
    expect(screen.getByText('Delegación activa')).toBeInTheDocument();
    expect(screen.getByText('Monotributista')).toBeInTheDocument();
    expect(screen.getByText('0003')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Aviso previo');

    await user.click(screen.getByRole('button', { name: 'Verificar delegación' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Delegación verificada.'));
    expect(apiClient).toHaveBeenCalledWith('/invoices/issuers/i-1/verify-delegation', { method: 'POST' });
    await user.click(screen.getByRole('button', { name: 'Traer puntos de venta' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Puntos de venta actualizados.'));
  });

  it('un emisor sin puntos de venta lo avisa y un fallo de la acción se muestra', async () => {
    const user = userEvent.setup();
    apiClient.mockImplementation(async (_p: string, init?: RequestInit) => {
      if (init?.method === 'POST') throw new ApiRequestError(409, 'LESSOR_ISSUER_EXISTS', 'x');
      return state({ issuer: { ...ISSUER, puntosDeVenta: [{ id: 'pv', number: 1, nombre: null, bloqueado: true }] } });
    });
    renderEs(<LessorInvoicingTab personId="p-1" />);
    expect(await screen.findByText(/0001 · bloqueado/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Verificar delegación' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Este locador ya tiene un emisor delegado.'));
    apiClient.mockImplementation(async () => state({ issuer: { ...ISSUER, puntosDeVenta: [] } }));
  });

  it('guarda lo que define el locador y manda null en lo que hereda', async () => {
    const user = userEvent.setup();
    apiClient.mockImplementation(async () => state({ override: { when: 'AlPagar', vatPct: 21 }, effective: { scope: 'Alquiler', when: 'AlPagar', vatPct: 21 }, autoSince: '2026-10-01T00:00:00.000Z' }));
    renderEs(<LessorInvoicingTab personId="p-1" />);
    expect(await screen.findByLabelText('Cuándo se factura')).toHaveValue('AlPagar');
    expect(screen.getByLabelText('Qué se factura')).toHaveValue('');
    expect(screen.getByLabelText('IVA incluido en el importe')).toHaveValue('21');
    expect(screen.getByText(/Rige: Solo el alquiler · Al registrar cada cobro · 21 %/)).toBeInTheDocument();
    expect(screen.getByText(/Factura sola desde el/)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Qué se factura'), 'AlquilerPunitorios');
    await user.selectOptions(screen.getByLabelText('Cuándo se factura'), '');
    await user.selectOptions(screen.getByLabelText('IVA incluido en el importe'), '0');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Configuración guardada.'));
    const put = apiClient.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(put[0]).toBe('/persons/p-1/invoicing-settings');
    expect(JSON.parse(put[1].body)).toEqual({ scope: 'AlquilerPunitorios', when: null, vatPct: 0 });
  });

  it('un rol de solo lectura ve la configuración sin poder cambiarla; sin permiso, nada', async () => {
    auth.role = 'Lectura';
    apiClient.mockImplementation(async () => state());
    const { unmount } = renderEs(<LessorInvoicingTab personId="p-1" />);
    expect(await screen.findByLabelText('Qué se factura')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Guardar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Verificar delegación' })).not.toBeInTheDocument();
    unmount();
    auth.role = 'Ventas';
    renderEs(<LessorInvoicingTab personId="p-1" />);
    expect(screen.getByText(/No tenés permiso/)).toBeInTheDocument();
  });

  it('un error de carga se informa', async () => {
    apiClient.mockRejectedValue(new ApiRequestError(500, 'INTERNAL', 'Falla'));
    renderEs(<LessorInvoicingTab personId="p-1" />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

const comprobante = (o: Record<string, unknown> = {}) => ({
  id: 'cmp-1',
  type: 'FacturaC',
  puntoDeVenta: 3,
  numero: 12,
  impTotal: '50000.00',
  currency: 'ARS',
  cae: '12345678901234',
  emittedAt: '2026-11-02T12:00:00.000Z',
  issuer: { id: 'i-1', cuit: '20123456786', businessName: 'Ana Locadora', personId: 'p-1' },
  creditNotes: [],
  ...o,
});
const job = (o: Record<string, unknown> = {}) => ({
  id: 'j-1',
  personId: 'p-1',
  person: { id: 'p-1', firstName: 'Ana', lastName: 'Locadora' },
  sourceType: 'Payment',
  sourceId: 'pay-1',
  kind: 'Factura',
  status: 'Emitido',
  attempts: 1,
  lastError: null,
  lastAttemptAt: null,
  createdAt: '2026-11-02T12:00:00.000Z',
  ...o,
});

describe('SourceInvoicesPanel', () => {
  beforeEach(() => {
    apiClient.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    auth.role = 'Admin';
  });

  it('lista comprobantes y estado de la emisión de un cobro', async () => {
    apiClient.mockResolvedValue({ comprobantes: [comprobante({ creditNotes: [{ id: 'nc', numero: 1 }] })], jobs: [job(), job({ id: 'j-2', kind: 'NotaCredito', status: 'Fallido', lastError: 'ARCA: caído' })] });
    renderEs(<SourceInvoicesPanel sourceType="Payment" sourceId="pay-1" />);
    expect(await screen.findByText(/Factura C 0003-00000012/)).toBeInTheDocument();
    expect(screen.getByText(/Ana Locadora · /)).toBeInTheDocument();
    expect(screen.getByText('con nota de crédito')).toBeInTheDocument();
    const jobs = screen.getByRole('list', { name: 'Estado de la emisión' });
    expect(within(jobs).getByText('ARCA: caído')).toBeInTheDocument();
    expect(apiClient).toHaveBeenCalledWith('/payments/pay-1/invoices');
    expect(screen.getByRole('button', { name: 'Facturar / reintentar' })).toBeInTheDocument();
  });

  it('factura y recarga; con un fallo del servidor informa que el cobro no cambió', async () => {
    const user = userEvent.setup();
    apiClient.mockImplementation(async (_p: string, init?: RequestInit) => {
      if (init?.method === 'POST') return { results: [{ status: 'Emitido' }] };
      return { comprobantes: [], jobs: [] };
    });
    renderEs(<SourceInvoicesPanel sourceType="OwnerStatement" sourceId="st-1" />);
    expect(await screen.findByText(/Todavía no se emitió ningún comprobante/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Facturar por cuenta del locador' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Facturado.'));
    expect(apiClient).toHaveBeenCalledWith('/owner-statements/st-1/invoices', { method: 'POST' });

    apiClient.mockImplementation(async (_p: string, init?: RequestInit) => {
      if (init?.method === 'POST') throw new ApiRequestError(422, 'LESSOR_INVOICE_FAILED', 'Rechazado por ARCA');
      return { comprobantes: [], jobs: [] };
    });
    await user.click(screen.getByRole('button', { name: 'Facturar por cuenta del locador' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Rechazado por ARCA'));
  });

  it('ningún locador con emisor: lo avisa; un estado sin emitir no ofrece facturar', async () => {
    const user = userEvent.setup();
    apiClient.mockImplementation(async (_p: string, init?: RequestInit) =>
      init?.method === 'POST' ? { results: [] } : { comprobantes: [], jobs: [] },
    );
    const { unmount } = renderEs(<SourceInvoicesPanel sourceType="Payment" sourceId="pay-1" />);
    await user.click(await screen.findByRole('button', { name: 'Facturar por cuenta del locador' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Ningún locador de este origen tiene emisor delegado.'));
    unmount();
    renderEs(<SourceInvoicesPanel sourceType="OwnerStatement" sourceId="st-1" canInvoice={false} />);
    await screen.findByText(/Un estado anulado no se factura/);
    expect(screen.queryByRole('button', { name: 'Facturar por cuenta del locador' })).not.toBeInTheDocument();
  });

  it('Lectura ve los comprobantes pero no factura; Ventas no ve nada', async () => {
    auth.role = 'Lectura';
    apiClient.mockResolvedValue({ comprobantes: [comprobante()], jobs: [] });
    const { unmount, container } = renderEs(<SourceInvoicesPanel sourceType="Payment" sourceId="pay-1" />);
    await screen.findByText(/Factura C/);
    expect(screen.queryByRole('button', { name: /Facturar/ })).not.toBeInTheDocument();
    unmount();
    auth.role = 'Ventas';
    const second = renderEs(<SourceInvoicesPanel sourceType="Payment" sourceId="pay-1" />);
    expect(second.container).toBeEmptyDOMElement();
    expect(container).toBeDefined();
  });

  it('un error de carga se informa', async () => {
    apiClient.mockRejectedValue(new ApiRequestError(500, 'INTERNAL', 'Falla'));
    renderEs(<SourceInvoicesPanel sourceType="Payment" sourceId="pay-1" />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('PendingLessorInvoices', () => {
  const page = (items: unknown[], o: Record<string, unknown> = {}) => ({ items, total: items.length, page: 1, limit: 20, totalPages: 1, ...o });

  beforeEach(() => {
    apiClient.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    auth.role = 'Admin';
  });

  it('lista lo pendiente y fallido con su motivo y emite todo con "Emitir pendientes"', async () => {
    const user = userEvent.setup();
    apiClient.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === 'POST') return { enqueued: 1, processed: 2, emitted: 1, skipped: 0, failed: 1 };
      return page([
        job({ id: 'a', status: 'Fallido', attempts: 3, lastError: 'NO_PUNTO_DE_VENTA: sin punto' }),
        job({ id: 'b', status: 'Pendiente', sourceType: 'OwnerStatement', sourceId: 'st-9', person: undefined, personId: 'p-77' }),
      ]);
    });
    renderEs(<PendingLessorInvoices />);
    expect((await screen.findAllByText('NO_PUNTO_DE_VENTA: sin punto')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ana Locadora').length).toBeGreaterThan(0);
    expect(screen.getAllByText('p-77').length).toBeGreaterThan(0);
    expect(apiClient.mock.calls[0][0]).toBe('/invoices/pending?page=1&limit=20');

    await user.click(screen.getByRole('button', { name: 'Emitir pendientes' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Emitidas: 1. Con error: 1.'));
    const post = apiClient.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(post[0]).toBe('/invoices/pending/run');
    expect(JSON.parse(post[1].body)).toEqual({ retryAll: true });
  });

  it('filtra por estado y vuelve a la primera página', async () => {
    const user = userEvent.setup();
    apiClient.mockImplementation(async () => page([]));
    renderEs(<PendingLessorInvoices />);
    expect(await screen.findByText('No hay facturas pendientes')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Estado'), 'Emitido');
    await waitFor(() => expect(apiClient).toHaveBeenCalledWith('/invoices/pending?page=1&limit=20&status=Emitido'));
  });

  it('un fallo al emitir se informa; Lectura no emite; Ventas no ve la cola', async () => {
    const user = userEvent.setup();
    apiClient.mockImplementation(async (_p: string, init?: RequestInit) => {
      if (init?.method === 'POST') throw new ApiRequestError(500, 'ARCA_DOWN', 'ARCA caído');
      return page([]);
    });
    const first = renderEs(<PendingLessorInvoices />);
    await user.click(await screen.findByRole('button', { name: 'Emitir pendientes' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('ARCA caído'));
    first.unmount();

    auth.role = 'Lectura';
    const second = renderEs(<PendingLessorInvoices />);
    await screen.findByText('No hay facturas pendientes');
    expect(screen.queryByRole('button', { name: 'Emitir pendientes' })).not.toBeInTheDocument();
    second.unmount();

    auth.role = 'Ventas';
    renderEs(<PendingLessorInvoices />);
    expect(screen.getByText(/No tenés permiso/)).toBeInTheDocument();
  });

  it('un error de carga se informa', async () => {
    apiClient.mockRejectedValue(new ApiRequestError(500, 'INTERNAL', 'Falla'));
    renderEs(<PendingLessorInvoices />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
