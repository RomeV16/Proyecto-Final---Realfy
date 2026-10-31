// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormShell } from './form-shell';

describe('FormShell', () => {
  it('muestra título, subtítulo y secciones, y entrega el envío a la pantalla', async () => {
    const onSubmit = vi.fn((e) => e.preventDefault());
    render(
      <FormShell title="Persona" subtitle="Datos básicos" onSubmit={onSubmit} submitLabel="Guardar">
        <FormShell.Section title="Contacto" description="Cómo ubicarla">
          <input aria-label="Nombre" />
        </FormShell.Section>
      </FormShell>,
    );
    expect(screen.getByRole('heading', { name: 'Persona' })).toBeInTheDocument();
    expect(screen.getByText('Datos básicos')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Contacto' })).toBeInTheDocument();
    expect(screen.getByText('Cómo ubicarla')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('no hace validación nativa: los campos con errores los maneja la pantalla', async () => {
    const onSubmit = vi.fn((e) => e.preventDefault());
    render(
      <FormShell onSubmit={onSubmit} submitLabel="Guardar">
        <input aria-label="Email" type="email" defaultValue="no-es-correo" />
      </FormShell>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('ocupado deshabilita el botón y la acción secundaria cancela', async () => {
    const onCancel = vi.fn();
    render(
      <FormShell onSubmit={vi.fn()} submitLabel="Guardando…" submitBusy secondaryAction={{ label: 'Cancelar', onClick: onCancel }}>
        <span>campos</span>
      </FormShell>,
    );
    expect(screen.getByRole('button', { name: 'Guardando…' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
