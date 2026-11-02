// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '../index-data/test-utils';

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
import { ContractFees } from './contract-fees';

const CONTRACT_ID = '11111111-1111-4111-8111-111111111111';

const fee = {
  id: 'f1',
  kind: 'AltaAlquiler',
  status: 'Parcial',
  contractId: CONTRACT_ID,
  payerRole: 'Inquilino',
  payerName: 'Ana Inquilina',
  total: '60000',
  currency: 'ARS',
  installments: 2,
  contract: { id: CONTRACT_ID, property: { title: 'Depto Sintético' } },
  property: null,
  installmentRows: [{ id: 'i1', n: 1, status: 'Pagada' }, { id: 'i2', n: 2, status: 'Pendiente' }],
  shares: [],
  staffCommissions: [],
};

function setup(role: string, fail = false) {
  auth.role = role;
  apiClient.mockImplementation(async (path: string) => {
    if (path.startsWith('/fees?')) {
      if (fail) throw new ApiRequestError(500, 'INTERNAL_ERROR', 'boom');
      return { items: [fee], total: 1, page: 1, limit: 50, totalPages: 1 };
    }
    if (path.startsWith('/fees/preview?')) throw new ApiRequestError(404, 'CONTRACT_NOT_FOUND', 'No está');
    if (path.startsWith('/contracts/') && path.endsWith('/periods')) return [];
    if (path === '/users') return [];
    return { items: [] };
  });
  return renderEs(<ContractFees contractId={CONTRACT_ID} />);
}

beforeEach(() => {
  apiClient.mockReset();
});

describe('Honorarios del contrato', () => {
  it('lista los honorarios del contrato y abre el alta con el contrato elegido', async () => {
    const user = userEvent.setup();
    setup('Gerente');
    expect((await screen.findAllByText('Ana Inquilina')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('1 de 2 cobradas').length).toBeGreaterThan(0);
    expect(apiClient).toHaveBeenCalledWith(`/fees?contractId=${CONTRACT_ID}&limit=50`);
    expect(screen.getByRole('link', { name: 'Ver todos' })).toHaveAttribute('href', '/honorarios');

    await user.click(screen.getByRole('button', { name: 'Cargar honorario de alta' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByLabelText('Operación')).toHaveValue('AltaAlquiler');
    expect(dialog.getByLabelText('Contrato')).toHaveValue(CONTRACT_ID);
    await waitFor(() => expect(apiClient).toHaveBeenCalledWith(`/fees/preview?kind=AltaAlquiler&contractId=${CONTRACT_ID}`));
    expect(await dialog.findByRole('alert')).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cargar honorario de renovación' }));
    expect(within(screen.getByRole('dialog')).getByLabelText('Operación')).toHaveValue('Renovacion');
    await waitFor(() => expect(apiClient).toHaveBeenCalledWith(`/contracts/${CONTRACT_ID}/periods`));
  });

  it('Lectura ve los honorarios sin poder cargar; un error de carga se muestra', async () => {
    setup('Lectura', true);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cargar honorario de alta' })).not.toBeInTheDocument();
  });

  it('un rol sin acceso no ve la sección', () => {
    const { container } = setup('Marketing');
    expect(container).toBeEmptyDOMElement();
    expect(apiClient).not.toHaveBeenCalled();
  });
});
