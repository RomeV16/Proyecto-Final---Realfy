// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderEs } from '@/components/index-data/test-utils';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: vi.fn(),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    user: { id: 'u', role: 'Ventas', firstName: 'Ana', lastName: 'Prueba', email: 'ana@example.test' },
    updateUser: vi.fn(),
  }),
  useOptionalAuth: () => ({ user: { id: 'u', role: 'Ventas' } }),
}));

import PerfilPage from './page';

describe('/perfil', () => {
  it('incluye el cambio de contraseña debajo de los datos personales', () => {
    renderEs(<PerfilPage />);
    expect(screen.getByRole('heading', { name: 'Mi perfil' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Contraseña' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Contraseña actual/)).toBeInTheDocument();
  });
});
