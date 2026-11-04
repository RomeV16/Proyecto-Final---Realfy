// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEsWithQuery } from '../index-data/test-utils';

const { apiClient, auth, toast } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  auth: { role: 'Liquidaciones' },
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u1', role: auth.role } }),
  useOptionalAuth: () => ({ user: { id: 'u1', role: auth.role } }),
}));
vi.mock('@/lib/toast', () => ({ toast }));

import { ApiRequestError } from '@/lib/api-client';
import { BillDocumentDetailScreen } from './bill-document-detail';
import { BillDocumentsScreen } from './bill-documents-screen';
import { BillReviewNotice } from './bill-review-notice';
import { acceptBody } from './review-actions';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'd1',
  channel: 'Archivo',
  origin: 'boleta-luz.pdf',
  fileName: 'boleta-luz.pdf',
  sizeBytes: 1000,
  providerKey: 'epec',
  accountNumber: '123456',
  confidence: '0.55',
  status: 'RequiereRevision',
  reason: 'LOW_CONFIDENCE',
  serviceId: 's1',
  createdAt: '2026-11-03T12:00:00.000Z',
  reviewedAt: null,
  service: { id: 's1', serviceType: 'Electricidad', providerName: 'EPEC', propertyId: 'p1' },
  _count: { bills: 0 },
  ...over,
});

const page = (items: unknown[]) => ({ items, total: items.length, page: 1, limit: 30, totalPages: 1 });

const SERVICES = [
  { id: 's1', serviceType: 'Electricidad', providerName: 'EPEC', accountNumber: '123456', property: { id: 'p1', title: 'Depto Demo 1' } },
  { id: 's2', serviceType: 'Agua', providerName: 'Aguas Cordobesas', accountNumber: '000777', property: { id: 'p2', title: 'Casa Demo 2' } },
];

const detail = (over: Record<string, unknown> = {}) => ({
  ...row(),
  _count: undefined,
  hasFile: true,
  bills: [],
  data: {
    lines: [{ period: '2026-10-01', installmentLabel: '10/2026', amount: '18500.50', dueDate: '2026-11-10', secondDueDate: null, secondAmount: null, nominalAmount: null, paymentCode: null, consumption: null }],
    warnings: ['Falta el vencimiento'],
  },
  ...over,
});

function route(handlers: Record<string, (path: string, options?: RequestInit) => unknown>) {
  apiClient.mockImplementation(async (path: string, options?: RequestInit) => {
    const key = Object.keys(handlers).find((k) => path.startsWith(k));
    if (!key) throw new Error(`unexpected ${path}`);
    return handlers[key](path, options);
  });
}

beforeEach(() => {
  apiClient.mockReset();
  toast.success.mockReset();
  auth.role = 'Liquidaciones';
});

describe('BillDocumentsScreen', () => {
  it('lista por defecto lo que espera revisión, con motivo legible, proveedor y confianza', async () => {
    route({
      '/bills-intake/documents': () =>
        page([row(), row({ id: 'd2', status: 'Procesada', reason: null, fileName: null, origin: 'a@demo.com', channel: 'Mail', _count: { bills: 2 } })]),
    });
    renderEsWithQuery(<BillDocumentsScreen />);
    expect((await screen.findAllByText('La lectura no es lo bastante confiable para cargarla sola.')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('EPEC').length).toBeGreaterThan(0);
    expect(screen.getAllByText('55 %')[0]).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: '2 boletas' })[0]).toHaveAttribute('href', expect.stringContaining('/boletas/recibidas/d2'));
    expect(apiClient.mock.calls[0][0]).toContain('status=RequiereRevision');
  });

  it('cambiar el estado y el canal vuelve a pedir la lista con esos filtros', async () => {
    route({ '/bills-intake/documents': () => page([]) });
    renderEsWithQuery(<BillDocumentsScreen />);
    await screen.findByText('Sin boletas recibidas', {}, { timeout: 3000 }).catch(() => undefined);
    await userEvent.selectOptions(screen.getByLabelText('Estado'), 'Duplicada');
    await userEvent.selectOptions(screen.getByLabelText('Canal'), 'Mail');
    await waitFor(() => {
      const last = apiClient.mock.calls.at(-1)?.[0] as string;
      expect(last).toContain('status=Duplicada');
      expect(last).toContain('channel=Mail');
    });
    await userEvent.selectOptions(screen.getByLabelText('Estado'), '');
    await waitFor(() => expect(apiClient.mock.calls.at(-1)?.[0]).not.toContain('status='));
  });

  it('un rechazo muestra el texto que escribió quien lo rechazó', async () => {
    route({ '/bills-intake/documents': () => page([row({ status: 'Rechazada', reason: 'No es de esta inmobiliaria' })]) });
    renderEsWithQuery(<BillDocumentsScreen />);
    expect((await screen.findAllByText('No es de esta inmobiliaria')).length).toBeGreaterThan(0);
  });

  it('un rol de lectura ve la lista pero no la subida', async () => {
    auth.role = 'Lectura';
    route({ '/bills-intake/documents': () => page([row()]) });
    renderEsWithQuery(<BillDocumentsScreen />);
    await screen.findAllByText('boleta-luz.pdf');
    expect(screen.queryByText('Subir boletas')).not.toBeInTheDocument();
  });

  it('un rol sin permiso no ve nada', () => {
    auth.role = 'Soporte';
    renderEsWithQuery(<BillDocumentsScreen />);
    expect(screen.getByText('No tenés permiso para ver las boletas recibidas.')).toBeInTheDocument();
    expect(apiClient).not.toHaveBeenCalled();
  });

  describe('subida', () => {
    const pdf = (name: string) => new File(['%PDF-1.4'], name, { type: 'application/pdf' });

    it('sube cada PDF por separado y muestra el resultado de cada uno', async () => {
      route({
        '/bills-intake/documents?': () => page([]),
        '/bills-intake/documents': (_p, options) => {
          const name = ((options?.body as FormData).get('files') as File).name;
          if (name === 'falla.pdf') throw new ApiRequestError(500, 'INTERNAL_ERROR', 'boom');
          if (name === 'repetida.pdf') return { total: 1, results: [{ fileName: name, id: 'd9', status: 'Duplicada', duplicate: true, billIds: [] }] };
          return { total: 1, results: [{ fileName: name, id: 'd8', status: 'Procesada', billIds: ['b1', 'b2'] }] };
        },
      });
      renderEsWithQuery(<BillDocumentsScreen />);
      const input = screen.getByLabelText('Subir PDF de boletas');
      await userEvent.setup({ applyAccept: false }).upload(input, [pdf('ok.pdf'), pdf('repetida.pdf'), pdf('falla.pdf'), new File(['x'], 'foto.png', { type: 'image/png' })]);
      const list = await screen.findByRole('list', { name: 'Archivos' });
      await waitFor(() => expect(within(list).getByText('Se cargaron 2 boletas')).toBeInTheDocument());
      expect(within(list).getByText('Ya estaba cargado')).toBeInTheDocument();
      expect(within(list).getByText('No es un PDF')).toBeInTheDocument();
      expect(within(list).getAllByRole('link', { name: 'Ver documento' })).toHaveLength(2);
      expect(screen.getByText('4 de 4 archivos procesados')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Limpiar lista' }));
      expect(screen.queryByRole('list', { name: 'Archivos' })).not.toBeInTheDocument();
    });

    it('acepta los archivos soltados y marca un resultado NOT_A_PDF del servidor', async () => {
      route({
        '/bills-intake/documents?': () => page([]),
        '/bills-intake/documents': () => ({ total: 1, results: [{ fileName: 'x.pdf', error: { code: 'NOT_A_PDF', message: 'no' } }] }),
      });
      renderEsWithQuery(<BillDocumentsScreen />);
      const zone = screen.getByTestId('bill-dropzone');
      fireEvent.dragOver(zone);
      expect(screen.getByText('Soltá los archivos para subirlos')).toBeInTheDocument();
      fireEvent.dragLeave(zone);
      fireEvent.drop(zone, { dataTransfer: { files: [pdf('x.pdf')] } });
      expect(await screen.findByText('No es un PDF')).toBeInTheDocument();
    });

    it('un error con código conocido de la API se muestra traducido', async () => {
      route({
        '/bills-intake/documents?': () => page([]),
        '/bills-intake/documents': () => {
          throw new ApiRequestError(400, 'FILE_REQUIRED', 'x');
        },
      });
      renderEsWithQuery(<BillDocumentsScreen />);
      await userEvent.upload(screen.getByLabelText('Subir PDF de boletas'), pdf('a.pdf'));
      expect(await screen.findByText('No se pudo subir')).toBeInTheDocument();
    });
  });
});

describe('BillDocumentDetailScreen', () => {
  const fileRoute = { '/bills-intake/documents/d1/file': () => ({ url: 'https://storage.demo/d1.pdf', expiresInSeconds: 600 }) };

  it('muestra el PDF en un visor al lado de lo leído', async () => {
    route({ ...fileRoute, '/bills-intake/documents/d1': () => detail() });
    renderEsWithQuery(<BillDocumentDetailScreen id="d1" />);
    const frame = await screen.findByTitle('PDF de la boleta recibida');
    expect(frame).toHaveAttribute('src', 'https://storage.demo/d1.pdf');
    expect(screen.getByRole('link', { name: 'Abrir el PDF en otra pestaña' })).toHaveAttribute('href', 'https://storage.demo/d1.pdf');
    expect(screen.getByText('La lectura no es lo bastante confiable para cargarla sola.')).toBeInTheDocument();
    expect(screen.getByText('Falta el vencimiento')).toBeInTheDocument();
    expect(screen.getByText('2026-10')).toBeInTheDocument();
    expect(screen.getByText('10/2026')).toBeInTheDocument();
  });

  it('sin PDF guardado lo dice; si el enlace falla avisa', async () => {
    route({ '/bills-intake/documents/d1': () => detail({ hasFile: false }) });
    const first = renderEsWithQuery(<BillDocumentDetailScreen id="d1" />);
    expect(await screen.findByText('Este documento no tiene un PDF guardado.')).toBeInTheDocument();
    first.unmount();
    route({
      '/bills-intake/documents/d1/file': () => {
        throw new ApiRequestError(404, 'DOCUMENT_FILE_NOT_FOUND', 'x');
      },
      '/bills-intake/documents/d1': () => detail(),
    });
    renderEsWithQuery(<BillDocumentDetailScreen id="d1" />);
    expect(await screen.findByText('No se pudo abrir el PDF')).toBeInTheDocument();
  });

  it('un documento inexistente o con error de carga se informa', async () => {
    route({
      '/bills-intake/documents/d1': () => {
        throw new ApiRequestError(404, 'DOCUMENT_NOT_FOUND', 'x');
      },
    });
    const first = renderEsWithQuery(<BillDocumentDetailScreen id="d1" />);
    expect(await screen.findByText('Documento no encontrado')).toBeInTheDocument();
    first.unmount();
    route({
      '/bills-intake/documents/d1': () => {
        throw new ApiRequestError(500, 'INTERNAL_ERROR', 'x');
      },
    });
    renderEsWithQuery(<BillDocumentDetailScreen id="d1" />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('acepta con correcciones: manda el servicio elegido y sólo lo que cambió', async () => {
    const accept = vi.fn(() => detail({ status: 'Procesada', reason: null }));
    route({
      ...fileRoute,
      '/services': () => ({ items: SERVICES, totalPages: 1 }),
      '/bills-intake/documents/d1/accept': accept,
      '/bills-intake/documents/d1': () => detail({ serviceId: null }),
    });
    renderEsWithQuery(<BillDocumentDetailScreen id="d1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Aceptar…' }));
    const dialog = await screen.findByRole('dialog');
    // El selector busca por texto.
    await userEvent.type(within(dialog).getByRole('searchbox'), 'aguas');
    const list = await within(dialog).findByRole('listbox', { name: 'Servicios' });
    await waitFor(() => expect(within(list).getAllByRole('option')).toHaveLength(1));
    await userEvent.selectOptions(list, within(list).getByRole('option', { name: /Casa Demo 2/ }));
    const amount = within(dialog).getByLabelText(/Importe/);
    await userEvent.clear(amount);
    await userEvent.type(amount, '19000,5');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Aceptar y cargar' }));
    await waitFor(() => expect(accept).toHaveBeenCalled());
    const options = accept.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(options[1].body as string)).toEqual({ serviceId: 's2', amount: '19000.5' });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Boleta cargada'));
  });

  it('no deja aceptar sin servicio y avisa del período inválido', async () => {
    route({
      ...fileRoute,
      '/services': () => ({ items: SERVICES, totalPages: 1 }),
      '/bills-intake/documents/d1': () => detail({ serviceId: null, data: { lines: [], warnings: [] } }),
    });
    renderEsWithQuery(<BillDocumentDetailScreen id="d1" />);
    expect(await screen.findByText('No se leyó ninguna boleta.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Aceptar…' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Aceptar y cargar' }));
    expect(await within(dialog).findAllByText('Elegí el servicio al que pertenece la boleta.')).not.toHaveLength(0);
    expect(apiClient.mock.calls.some(([p]) => String(p).endsWith('/accept'))).toBe(false);
    const list = await within(dialog).findByRole('listbox', { name: 'Servicios' });
    await waitFor(() => expect(within(list).getAllByRole('option')).toHaveLength(2));
    await userEvent.selectOptions(list, 's1');
    await userEvent.type(within(dialog).getByLabelText(/Período/), '2026-13');
    await userEvent.type(within(dialog).getByLabelText(/Importe/), '100');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Aceptar y cargar' }));
    expect(await within(dialog).findByText('El período debe ser AAAA-MM, por ejemplo 2026-11.')).toBeInTheDocument();
  });

  it('muestra el error de la API al aceptar sin cerrar el diálogo', async () => {
    route({
      ...fileRoute,
      '/services': () => ({ items: SERVICES, totalPages: 1 }),
      '/bills-intake/documents/d1/accept': () => {
        throw new ApiRequestError(409, 'DOCUMENT_NOT_REVIEWABLE', 'x');
      },
      '/bills-intake/documents/d1': () => detail(),
    });
    renderEsWithQuery(<BillDocumentDetailScreen id="d1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Aceptar…' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Aceptar y cargar' }));
    expect(await within(dialog).findByText(/ya no está en revisión/)).toBeInTheDocument();
  });

  it('rechaza con motivo', async () => {
    const reject = vi.fn(() => detail({ status: 'Rechazada' }));
    route({ ...fileRoute, '/bills-intake/documents/d1/reject': reject, '/bills-intake/documents/d1': () => detail() });
    renderEsWithQuery(<BillDocumentDetailScreen id="d1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Rechazar…' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rechazar' }));
    expect(reject).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByLabelText(/Motivo/), 'No es de esta inmobiliaria');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rechazar' }));
    await waitFor(() => expect(reject).toHaveBeenCalled());
    const options = reject.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(options[1].body as string)).toEqual({ reason: 'No es de esta inmobiliaria' });
  });

  it('un motivo de más de 500 caracteres no se manda', async () => {
    const reject = vi.fn();
    route({ ...fileRoute, '/bills-intake/documents/d1/reject': reject, '/bills-intake/documents/d1': () => detail() });
    renderEsWithQuery(<BillDocumentDetailScreen id="d1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Rechazar…' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Motivo/), { target: { value: 'x'.repeat(501) } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rechazar' }));
    expect(await within(dialog).findByText('El motivo admite hasta 500 caracteres.')).toBeInTheDocument();
    expect(reject).not.toHaveBeenCalled();
  });

  it('un rol de lectura ve el documento sin poder revisarlo', async () => {
    auth.role = 'Lectura';
    route({ ...fileRoute, '/bills-intake/documents/d1': () => detail() });
    renderEsWithQuery(<BillDocumentDetailScreen id="d1" />);
    expect(await screen.findByText('Tenés acceso de lectura: no podés aceptar ni rechazar.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aceptar…' })).not.toBeInTheDocument();
  });

  it('un documento ya resuelto no ofrece revisión y enlaza a las boletas cargadas', async () => {
    route({
      ...fileRoute,
      '/bills-intake/documents/d1': () =>
        detail({
          status: 'Procesada',
          reason: null,
          bills: [{ id: 'b1', serviceId: 's1', period: '2026-10-01', installmentLabel: '10/2026', amount: '18500.5', dueDate: null, status: 'Pendiente' }],
        }),
    });
    renderEsWithQuery(<BillDocumentDetailScreen id="d1" />);
    expect(await screen.findByRole('link', { name: 'Ver las boletas del mes' })).toHaveAttribute('href', expect.stringContaining('/boletas'));
    expect(screen.queryByRole('button', { name: 'Aceptar…' })).not.toBeInTheDocument();
  });

  it('un documento con varias boletas se acepta sin correcciones', async () => {
    const accept = vi.fn(() => detail({ status: 'Procesada' }));
    const line = (period: string) => ({ period, installmentLabel: null, amount: '100', dueDate: null, secondDueDate: null, secondAmount: null, nominalAmount: null, paymentCode: null, consumption: null });
    route({
      ...fileRoute,
      '/bills-intake/documents/d1/accept': accept,
      '/bills-intake/documents/d1': () => detail({ data: { lines: [line('2026-09-01'), line('2026-10-01')], warnings: [] } }),
    });
    renderEsWithQuery(<BillDocumentDetailScreen id="d1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Aceptar…' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/varias boletas/)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Importe/)).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Aceptar y cargar' }));
    await waitFor(() => expect(accept).toHaveBeenCalled());
    const options = accept.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(options[1].body as string)).toEqual({ serviceId: 's1' });
  });
});

describe('acceptBody', () => {
  const line = { period: '2026-10-01', installmentLabel: '10/2026', amount: '100.00', dueDate: '2026-11-10', secondDueDate: null, secondAmount: null, nominalAmount: null, paymentCode: null, consumption: null };

  it('sin cambios sólo manda el servicio', () => {
    expect(acceptBody('s1', { period: '2026-10', installmentLabel: '10/2026', amount: '100', dueDate: '2026-11-10' }, [line])).toEqual({ serviceId: 's1' });
  });

  it('manda lo que se cambió, incluido sacar el vencimiento', () => {
    expect(acceptBody('s1', { period: '2026-09', installmentLabel: '09/2026', amount: '120,5', dueDate: '' }, [line])).toEqual({
      serviceId: 's1',
      period: '2026-09',
      installmentLabel: '09/2026',
      amount: '120.5',
      dueDate: null,
    });
  });

  it('sin boleta leída manda período e importe', () => {
    expect(acceptBody('s1', { period: '2026-10', amount: '50', installmentLabel: '', dueDate: '' }, [])).toEqual({
      serviceId: 's1',
      period: '2026-10',
      amount: '50',
    });
  });
});

describe('BillReviewNotice', () => {
  it('avisa cuántas esperan revisión y enlaza a la pantalla', async () => {
    route({ '/bills-intake/documents': () => ({ total: 3 }) });
    renderEsWithQuery(<BillReviewNotice />);
    expect(await screen.findByText('Hay 3 boletas recibidas esperando tu revisión.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Revisar' })).toHaveAttribute('href', expect.stringContaining('/boletas/recibidas'));
  });

  it('con una sola usa el singular y sin ninguna no aparece', async () => {
    route({ '/bills-intake/documents': () => ({ total: 1 }) });
    const first = renderEsWithQuery(<BillReviewNotice />);
    expect(await screen.findByText('Hay 1 boleta recibida esperando tu revisión.')).toBeInTheDocument();
    first.unmount();
    route({ '/bills-intake/documents': () => ({ total: 0 }) });
    renderEsWithQuery(<BillReviewNotice />);
    await waitFor(() => expect(apiClient).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
