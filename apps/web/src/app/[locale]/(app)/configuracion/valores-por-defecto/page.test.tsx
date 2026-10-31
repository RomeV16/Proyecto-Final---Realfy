// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/components/settings/operational-defaults-form', () => ({
  OperationalDefaultsManager: () => <div>valores-por-defecto-mock</div>,
}));

import ValoresPorDefectoPage from './page';

describe('/configuracion/valores-por-defecto', () => {
  it('muestra la pantalla de valores por defecto', () => {
    render(<ValoresPorDefectoPage />);
    expect(screen.getByText('valores-por-defecto-mock')).toBeInTheDocument();
  });
});
