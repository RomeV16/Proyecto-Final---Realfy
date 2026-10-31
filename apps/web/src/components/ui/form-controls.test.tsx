// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormField } from './form-field';
import { Input, inputStyles } from './input';
import { Select } from './select';
import { Textarea } from './textarea';

describe('inputStyles', () => {
  it('usa el borde de error cuando es inválido y el foco de marca cuando no', () => {
    expect(inputStyles({ invalid: true })).toContain('border-[var(--color-danger)]');
    expect(inputStyles()).toContain('focus:border-brand-500');
  });

  it('el multilínea no fija la altura y admite clases extra', () => {
    const classes = inputStyles({ multiline: true, className: 'mi-clase' });
    expect(classes).toContain('min-h-[5.5rem]');
    expect(classes).not.toContain('h-11');
    expect(classes).toContain('mi-clase');
  });
});

describe('FormField', () => {
  it('enlaza la etiqueta con el control', async () => {
    render(<FormField label="Nombre">{(c) => <Input {...c} />}</FormField>);
    await userEvent.type(screen.getByLabelText('Nombre'), 'Ana');
    expect(screen.getByLabelText('Nombre')).toHaveValue('Ana');
  });

  it('con error marca aria-invalid, enlaza el mensaje y lo anuncia', () => {
    render(
      <FormField label="Email" error="Correo inválido" hint="Ayuda">
        {(c) => <Input {...c} />}
      </FormField>,
    );
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Correo inválido');
    expect(screen.getByRole('alert')).toHaveTextContent('Correo inválido');
    expect(screen.queryByText('Ayuda')).not.toBeInTheDocument();
    expect(input.className).toContain('border-[var(--color-danger)]');
  });

  it('sin error muestra la ayuda como descripción', () => {
    render(
      <FormField label="Teléfono" hint="Con característica">
        {(c) => <Input {...c} />}
      </FormField>,
    );
    const input = screen.getByLabelText('Teléfono');
    expect(input).toHaveAttribute('aria-invalid', 'false');
    expect(input).toHaveAccessibleDescription('Con característica');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('sin ayuda ni error no agrega descripción', () => {
    render(<FormField label="Libre">{(c) => <Input {...c} />}</FormField>);
    expect(screen.getByLabelText('Libre')).not.toHaveAttribute('aria-describedby');
  });

  it('obligatorio: asterisco oculto a lectores y aria-required en el control', () => {
    render(
      <FormField label="CUIT" required>
        {(c) => <Input {...c} />}
      </FormField>,
    );
    expect(screen.getByLabelText(/CUIT/)).toHaveAttribute('aria-required', 'true');
    expect(screen.getByText('*')).toHaveAttribute('aria-hidden', 'true');
  });

  it('funciona con Select y Textarea', () => {
    render(
      <>
        <FormField label="Tipo" error="Falta">
          {(c) => (
            <Select {...c} defaultValue="">
              <option value="">-</option>
              <option value="a">A</option>
            </Select>
          )}
        </FormField>
        <FormField label="Notas">{(c) => <Textarea {...c} />}</FormField>
      </>,
    );
    expect(screen.getByLabelText('Tipo')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Tipo').className).toContain('border-[var(--color-danger)]');
    const notes = screen.getByLabelText('Notas');
    expect(notes.tagName).toBe('TEXTAREA');
    expect(notes).toHaveAttribute('rows', '3');
    expect(notes.className).toContain('resize-none');
  });
});

describe('Input', () => {
  it('con label y error propios sigue enlazando y marcando el campo', () => {
    render(<Input label="Calle" error="Obligatoria" />);
    const input = screen.getByLabelText('Calle');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Obligatoria');
  });

  it('toma aria-invalid del control cuando lo manda el campo', () => {
    render(<Input aria-label="x" aria-invalid />);
    expect(screen.getByLabelText('x').className).toContain('border-[var(--color-danger)]');
  });

  it('muestra la ayuda sin error', () => {
    render(<Input label="Ciudad" hint="Sin abreviar" />);
    expect(screen.getByLabelText('Ciudad')).toHaveAccessibleDescription('Sin abreviar');
  });
});
