// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderEs } from '@/components/index-data/test-utils';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'a', role: 'Admin' } }),
  useOptionalAuth: () => ({ user: { id: 'a', role: 'Admin' } }),
}));

import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import UsuariosPage from './page';

describe('/configuracion/usuarios', () => {
  it('muestra la gestión del equipo al Admin', async () => {
    renderEs(
      <ConfirmProvider>
        <UsuariosPage />
      </ConfirmProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'Usuarios' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invitar usuario' })).toBeInTheDocument();
  });
});
