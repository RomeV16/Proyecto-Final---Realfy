// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '../index-data/test-utils';

const { apiClient, auth, toast } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  auth: { role: 'Admin' },
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
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import { ApiRequestError } from '@/lib/api-client';
import { PropertyServices } from './property-services';
import { buildServicePayload } from './property-service-dialog';

const svc = (id: string, o: Record<string, unknown> = {}) => ({
  id,
  propertyId: 'p-1',
  serviceType: 'Electricidad',
  providerName: 'EPEC',
  providerKey: 'epec',
  accountNumber: '1234567',
  amount: '15000.00',
  currency: 'ARS',
  dueDay: 15,
  billingFrequency: 'Mensual',
  hasAnnualOption: false,
  isActive: true,
  notes: null,
  ...o,
});

function serve(items: unknown[], over: Record<string, (body?: any) => unknown> = {}, building: unknown[] = []) {
  apiClient.mockImplementation(async (path: string, options?: RequestInit) => {
    const body = options?.body ? JSON.parse(options.body as string) : undefined;
    const key = `${options?.method ?? 'GET'} ${path}`;
    if (over[key]) return over[key](body);
    if (path.startsWith('/services?propertyId=p-1')) return { items };
    if (path.startsWith('/services?propertyId=b-1')) return { items: building };
    throw new Error(`inesperado: ${key}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = 'Admin';
});

describe('PropertyServices: lista', () => {
  it('muestra proveedor, cuenta, importe, vencimiento y los dados de baja', async () => {
    serve([svc('s1'), svc('s2', { serviceType: 'Gas', providerName: null, providerKey: null, accountNumber: null, isActive: false, hasAnnualOption: true })]);
    renderEs(<PropertyServices propertyId="p-1" />);

    expect(await screen.findByText('Electricidad')).toBeInTheDocument();
    expect(screen.getByText('EPEC · Cuenta 1234567')).toBeInTheDocument();
    expect(screen.getAllByText(/vence el día 15 · Mensual/)).toHaveLength(2);
    expect(screen.getByText('Sin proveedor · Sin cuenta')).toBeInTheDocument();
    expect(screen.getByText('De baja')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reactivar' })).toBeInTheDocument();
  });

  it('sin servicios lo dice, y un error de carga se muestra', async () => {
    serve([]);
    const { unmount } = renderEs(<PropertyServices propertyId="p-1" />);
    expect(await screen.findByText('Todavía no hay servicios ni impuestos cargados.')).toBeInTheDocument();
    unmount();

    apiClient.mockRejectedValue(new ApiRequestError(500, 'INTERNAL_ERROR', 'caído'));
    renderEs(<PropertyServices propertyId="p-1" />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('quien no gestiona servicios los ve sin botones; Ventas edita pero no da de baja', async () => {
    auth.role = 'Lectura';
    serve([svc('s1')]);
    const { unmount } = renderEs(<PropertyServices propertyId="p-1" />);
    await screen.findByText('Electricidad');
    expect(screen.queryByRole('button', { name: 'Agregar servicio' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
    unmount();

    auth.role = 'Ventas';
    renderEs(<PropertyServices propertyId="p-1" />);
    expect(await screen.findByRole('button', { name: 'Editar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agregar servicio' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dar de baja' })).not.toBeInTheDocument();
  });

  it('una unidad ve aparte los servicios activos del edificio, sin editarlos', async () => {
    serve([svc('s1')], {}, [svc('b1', { propertyId: 'b-1', serviceType: 'Agua', providerName: 'Aguas Cordobesas' }), svc('b2', { propertyId: 'b-1', isActive: false })]);
    renderEs(<PropertyServices propertyId="p-1" parentPropertyId="b-1" />);

    expect(await screen.findByText('Del edificio')).toBeInTheDocument();
    expect(screen.getByText(/Aguas Cordobesas · Cuenta/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir el edificio' })).toHaveAttribute('href', '/properties/b-1');
    // Solo el propio tiene botones: Editar y Dar de baja una vez cada uno.
    expect(screen.getAllByRole('button', { name: 'Editar' })).toHaveLength(1);
  });
});

describe('PropertyServices: acciones', () => {
  it('da de baja con confirmación y reactiva con PATCH isActive', async () => {
    const calls: string[] = [];
    serve([svc('s1'), svc('s2', { serviceType: 'Gas', isActive: false })], {
      'DELETE /services/s1': () => calls.push('baja'),
      'PATCH /services/s2': (body) => {
        calls.push(`reactivar ${JSON.stringify(body)}`);
      },
    });
    renderEs(<PropertyServices propertyId="p-1" />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Dar de baja' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Dar de baja' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Servicio dado de baja'));

    await user.click(screen.getByRole('button', { name: 'Reactivar' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Servicio reactivado'));
    expect(calls).toEqual(['baja', 'reactivar {"isActive":true}']);
  });

  it('cancelar la confirmación no da de baja; un error de la API se avisa', async () => {
    serve([svc('s1')], { 'DELETE /services/s1': () => Promise.reject(new Error('x')) });
    renderEs(<PropertyServices propertyId="p-1" />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Dar de baja' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
    expect(apiClient).not.toHaveBeenCalledWith('/services/s1', expect.anything());

    await user.click(screen.getByRole('button', { name: 'Dar de baja' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Dar de baja' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('No se pudo completar la acción'));
  });

  it('el alta manda el servicio de la propiedad con el proveedor del catálogo y la cuenta tal cual', async () => {
    let sent: any;
    serve([], { 'POST /services': (body) => (sent = body) });
    renderEs(<PropertyServices propertyId="p-1" />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Agregar servicio' }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(/Proveedor$/), 'epec');
    // Con un proveedor del catálogo no se pide el nombre.
    expect(within(dialog).queryByLabelText(/Nombre del proveedor/)).not.toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/Número de cuenta o cliente/), '12-3456');
    await user.type(within(dialog).getByLabelText(/Importe vigente/), '15000,50');
    await user.selectOptions(within(dialog).getByLabelText(/Día de vencimiento/), '20');
    await user.click(within(dialog).getByRole('button', { name: 'Crear' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Servicio creado'));
    expect(sent).toEqual({
      propertyId: 'p-1',
      serviceType: 'Electricidad',
      providerKey: 'epec',
      providerName: 'EPEC',
      accountNumber: '12-3456',
      amount: 15000.5,
      currency: 'ARS',
      dueDay: 20,
      billingFrequency: 'Mensual',
      hasAnnualOption: false,
      notes: null,
    });
  });

  it('muestra el error de cuenta inválida que devuelve la API sin cerrar el diálogo', async () => {
    serve([], {
      'POST /services': () => Promise.reject(new ApiRequestError(400, 'INVALID_PROVIDER_ACCOUNT', 'cuenta mala')),
    });
    renderEs(<PropertyServices propertyId="p-1" />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Agregar servicio' }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(/Proveedor$/), 'epec');
    await user.type(within(dialog).getByLabelText(/Número de cuenta o cliente/), 'xx');
    await user.type(within(dialog).getByLabelText(/Importe vigente/), '100');
    await user.click(within(dialog).getByRole('button', { name: 'Crear' }));

    expect(await within(dialog).findByText(/no tiene el formato del proveedor elegido/)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('la edición precarga el servicio y manda PATCH; el proveedor genérico pide el nombre', async () => {
    let sent: any;
    serve([svc('s1', { providerKey: 'generico', providerName: 'Cooperativa', notes: 'Medidor al fondo', hasAnnualOption: true })], {
      'PATCH /services/s1': (body) => (sent = body),
    });
    renderEs(<PropertyServices propertyId="p-1" />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Editar' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/Nombre del proveedor/)).toHaveValue('Cooperativa');
    expect(within(dialog).getByLabelText(/Importe vigente/)).toHaveValue('15000,00');
    await user.clear(within(dialog).getByLabelText(/Importe vigente/));
    await user.type(within(dialog).getByLabelText(/Importe vigente/), '18000');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Servicio actualizado'));
    expect(sent).toMatchObject({ providerKey: 'generico', providerName: 'Cooperativa', amount: 18000, hasAnnualOption: true, notes: 'Medidor al fondo' });
    expect(sent.propertyId).toBeUndefined();
  });
});

describe('buildServicePayload', () => {
  const base = { serviceType: 'Agua', providerKey: '', providerName: 'Coop', accountNumber: '', amount: '10', currency: 'ARS', dueDay: '5', billingFrequency: 'Bimestral', hasAnnualOption: 'no', notes: '' };

  it('sin proveedor del catálogo usa el nombre escrito y manda null en lo vacío', () => {
    expect(buildServicePayload(base, () => 'X')).toMatchObject({ providerKey: null, providerName: 'Coop', accountNumber: null, notes: null, dueDay: 5 });
  });

  it('con proveedor del catálogo usa su nombre', () => {
    expect(buildServicePayload({ ...base, providerKey: 'ecogas', providerName: '' }, (k) => `L-${k}`)).toMatchObject({ providerKey: 'ecogas', providerName: 'L-ecogas' });
  });
});
