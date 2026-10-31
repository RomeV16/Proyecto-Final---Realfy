// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderEs } from '@/components/index-data/test-utils';

vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import LoginPage from './page';

describe('ingreso', () => {
  it('ofrece recuperar la contraseña', () => {
    renderEs(<LoginPage />);
    expect(screen.getByRole('link', { name: '¿Olvidaste tu contraseña?' })).toHaveAttribute(
      'href',
      '/auth/password-reset',
    );
  });
});
