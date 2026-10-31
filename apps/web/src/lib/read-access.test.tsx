// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { READ_RESOURCES } from '@realfy/shared';

const { apiClient, auth } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  auth: { user: null as { id: string; role: string } | null },
}));

vi.mock('@/lib/api-client', () => ({ apiClient: (...a: unknown[]) => apiClient(...a) }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: auth.user }),
  useOptionalAuth: () => ({ user: auth.user }),
}));

import { invalidateReadAccess, useReadAccess } from './read-access';
import { useCanRead } from './permissions';
import { navItems, useVisibleNavItems, visibleNavItems } from '@/components/layout/nav-items';

const allowAll = Object.fromEntries(READ_RESOURCES.map((r) => [r, true]));
const response = (over: Record<string, boolean> = {}) => ({
  role: 'Ventas',
  resources: { ...allowAll, ...over },
});

function Probe() {
  const access = useReadAccess();
  return <p>{access === null ? 'cargando' : `bancos:${access['persons.bankAccounts']}`}</p>;
}

function CanProbe() {
  return <p>{useCanRead('persons.bankAccounts') ? 've' : 'oculto'}</p>;
}

function NavProbe() {
  return <p>{useVisibleNavItems().map((i) => i.key).join(',')}</p>;
}

describe('useReadAccess / useCanRead', () => {
  beforeEach(() => {
    apiClient.mockReset();
    invalidateReadAccess();
    auth.user = { id: 'u1', role: 'Ventas' };
  });

  it('consulta una sola vez para varios componentes y devuelve lo que el rol puede leer', async () => {
    apiClient.mockResolvedValue(response({ 'persons.bankAccounts': false }));
    render(
      <>
        <Probe />
        <Probe />
      </>,
    );
    expect(screen.getAllByText('cargando')).toHaveLength(2);
    await waitFor(() => expect(screen.getAllByText('bancos:false')).toHaveLength(2));
    expect(apiClient).toHaveBeenCalledTimes(1);
    expect(apiClient).toHaveBeenCalledWith('/tenants/me/read-access');
  });

  it('un componente que se monta después lee lo ya consultado sin esperar', async () => {
    apiClient.mockResolvedValue(response({ 'persons.bankAccounts': false }));
    const first = render(<Probe />);
    await screen.findByText('bancos:false');
    first.unmount();
    render(<Probe />);
    expect(screen.getByText('bancos:false')).toBeInTheDocument();
    expect(apiClient).toHaveBeenCalledTimes(1);
  });

  it('useCanRead asume que sí mientras consulta y oculta si el rol no puede leer', async () => {
    apiClient.mockResolvedValue(response({ 'persons.bankAccounts': false }));
    render(<CanProbe />);
    expect(screen.getByText('ve')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('oculto')).toBeInTheDocument());
  });

  it('con la política por defecto todo se ve', async () => {
    apiClient.mockResolvedValue(response());
    render(<CanProbe />);
    await waitFor(() => expect(apiClient).toHaveBeenCalled());
    await screen.findByText('ve');
  });

  it('si no se puede consultar, oculta y vuelve a intentar en el próximo montaje', async () => {
    apiClient.mockRejectedValueOnce(new Error('caído'));
    const first = render(<CanProbe />);
    await waitFor(() => expect(screen.getByText('oculto')).toBeInTheDocument());
    first.unmount();

    apiClient.mockResolvedValue(response());
    render(<CanProbe />);
    await waitFor(() => expect(apiClient).toHaveBeenCalledTimes(2));
    await screen.findByText('ve');
  });

  it('sin sesión no se puede leer nada y no se consulta', () => {
    auth.user = null;
    render(<CanProbe />);
    expect(screen.getByText('oculto')).toBeInTheDocument();
    expect(apiClient).not.toHaveBeenCalled();
  });

  it('invalidar vuelve a consultar a quienes están montados', async () => {
    apiClient.mockResolvedValueOnce(response());
    render(<Probe />);
    await screen.findByText('bancos:true');

    apiClient.mockResolvedValueOnce(response({ 'persons.bankAccounts': false }));
    act(() => invalidateReadAccess());
    await screen.findByText('bancos:false');
    expect(apiClient).toHaveBeenCalledTimes(2);
  });

  it('el menú oculta los ítems de recursos que el rol no puede leer', async () => {
    apiClient.mockResolvedValue(response({ renditions: false, invoices: false }));
    auth.user = { id: 'u2', role: 'Admin' };
    render(<NavProbe />);
    await waitFor(() => expect(screen.getByText(/dashboard/)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/dashboard/).textContent).not.toContain('renditions'));
    expect(screen.getByText(/dashboard/).textContent).not.toContain('invoices');
    expect(screen.getByText(/dashboard/).textContent).toContain('liquidaciones');
  });
});

describe('visibleNavItems con política de lectura', () => {
  const access = Object.fromEntries(READ_RESOURCES.map((r) => [r, true])) as Record<(typeof READ_RESOURCES)[number], boolean>;

  it('sin consulta todavía no oculta nada por recurso', () => {
    expect(visibleNavItems('Admin', navItems, null).map((i) => i.key)).toContain('invoices');
  });

  it('oculta rendiciones, facturas y reportes sin acceso de lectura', () => {
    const keys = visibleNavItems(
      'Admin',
      navItems,
      { ...access, renditions: false, invoices: false, 'reports.financial': false },
    ).map((i) => i.key);
    expect(keys).not.toContain('renditions');
    expect(keys).not.toContain('invoices');
    expect(keys).not.toContain('reports');
    expect(keys).toContain('delinquency');
  });

  it('Permisos solo lo ve el Admin', () => {
    for (const role of ['Admin', 'Gerente', 'Ventas', 'Liquidaciones', 'Marketing', 'Soporte', 'Lectura']) {
      expect(visibleNavItems(role, navItems, access).some((i) => i.key === 'permissions')).toBe(role === 'Admin');
    }
  });
});
