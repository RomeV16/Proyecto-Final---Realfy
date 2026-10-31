// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('./sidebar', () => ({
  Sidebar: ({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) => (
    <button onClick={onToggle}>sidebar {collapsed ? 'colapsada' : 'abierta'}</button>
  ),
}));
vi.mock('./mobile-nav', () => ({
  MobileNav: ({ open, onClose }: { open: boolean; onClose: () => void }) => (
    <button onClick={onClose}>nav {open ? 'abierta' : 'cerrada'}</button>
  ),
}));
vi.mock('./header', () => ({
  Header: ({ onMenuToggle }: { onMenuToggle: () => void }) => <button onClick={onMenuToggle}>encabezado</button>,
}));

import { AppLayout } from './app-layout';

describe('AppLayout', () => {
  it('muestra el contenido y oculta la navegación y el encabezado al imprimir', () => {
    render(
      <AppLayout>
        <p>Contenido</p>
      </AppLayout>,
    );
    expect(screen.getByRole('main')).toHaveTextContent('Contenido');
    for (const name of [/sidebar/, /nav /, /encabezado/]) {
      expect(screen.getByRole('button', { name }).parentElement).toHaveClass('print:hidden');
    }
  });

  it('el menú del encabezado abre y cierra la navegación móvil, y la barra lateral se colapsa', async () => {
    const user = userEvent.setup();
    render(
      <AppLayout>
        <p>Contenido</p>
      </AppLayout>,
    );
    await user.click(screen.getByRole('button', { name: 'encabezado' }));
    expect(screen.getByRole('button', { name: 'nav abierta' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'nav abierta' }));
    expect(screen.getByRole('button', { name: 'nav cerrada' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'sidebar abierta' }));
    expect(screen.getByRole('button', { name: 'sidebar colapsada' })).toBeInTheDocument();
  });
});
