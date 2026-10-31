// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '../index-data/test-utils';

const { apiClient } = vi.hoisted(() => ({ apiClient: vi.fn() }));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));

import { ApiRequestError } from '@/lib/api-client';
import { PersonForm, type PersonFormData } from './person-form';

const existing: PersonFormData = {
  id: 'pe-1',
  firstName: 'Luis',
  lastName: 'Inventado',
  email: 'luis@prueba.test',
  phone: '',
  phone2: '',
  cuit: '',
  fiscalCondition: '',
  bankName: '',
  cbu: '',
  bankAlias: '',
  notes: '',
};

describe('PersonForm', () => {
  beforeEach(() => {
    apiClient.mockReset();
  });

  it('cada campo tiene su etiqueta asociada y los obligatorios lo declaran', () => {
    renderEs(<PersonForm mode="create" />);
    expect(screen.getByLabelText(/^Nombre/)).toHaveAttribute('aria-required', 'true');
    expect(screen.getByLabelText(/^Apellido/)).toHaveAttribute('aria-required', 'true');
    expect(screen.getByLabelText(/^Correo electrónico/)).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText(/^CBU/)).toHaveAttribute('maxlength', '22');
  });

  it('no envía y muestra los errores de los campos obligatorios, con el foco en el primero', async () => {
    const user = userEvent.setup();
    renderEs(<PersonForm mode="create" />);
    await user.click(screen.getByRole('button', { name: 'Guardar persona' }));
    expect(apiClient).not.toHaveBeenCalled();
    const first = screen.getByLabelText(/^Nombre/);
    expect(first).toHaveAttribute('aria-invalid', 'true');
    expect(first).toHaveAccessibleDescription('Este campo es obligatorio');
    await waitFor(() => expect(first).toHaveFocus());
  });

  it('valida el formato del email y del CBU antes de enviar', async () => {
    const user = userEvent.setup();
    renderEs(<PersonForm mode="create" />);
    await user.type(screen.getByLabelText(/^Nombre/), 'Ana');
    await user.type(screen.getByLabelText(/^Apellido/), 'Prueba');
    await user.type(screen.getByLabelText(/^Correo electrónico/), 'no-es-correo');
    await user.type(screen.getByLabelText(/^CBU/), '123');
    await user.click(screen.getByRole('button', { name: 'Guardar persona' }));
    expect(apiClient).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^Correo electrónico/)).toHaveAccessibleDescription('Ingresá un correo electrónico válido');
    expect(screen.getByLabelText(/^CBU/)).toHaveAccessibleDescription('El CBU debe tener exactamente 22 dígitos');
  });

  it('crea la persona y avisa el id; el CUIT se formatea y el CBU solo admite dígitos', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    apiClient.mockResolvedValue({ id: 'pe-9' });
    renderEs(<PersonForm mode="create" onSuccess={onSuccess} />);
    await user.type(screen.getByLabelText(/^Nombre/), 'Ana');
    await user.type(screen.getByLabelText(/^Apellido/), 'Prueba');
    await user.type(screen.getByLabelText(/^CUIT/), '20123456786');
    await user.type(screen.getByLabelText(/^CBU/), '12ab3456789012345678901234');
    await user.selectOptions(screen.getByLabelText(/Condición fiscal/), 'Monotributista');
    await user.type(screen.getByLabelText(/^Notas/), 'Nota de prueba');
    await user.click(screen.getByRole('button', { name: 'Guardar persona' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('pe-9'));
    const [path, options] = apiClient.mock.calls[0];
    expect(path).toBe('/persons');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({
      firstName: 'Ana',
      lastName: 'Prueba',
      cuit: '20-12345678-6',
      cbu: "1234567890123456789012",
      fiscalCondition: 'Monotributista',
      notes: 'Nota de prueba',
    });
  });

  it('en edición hace PATCH sobre la persona y cancela con el botón', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    const onCancel = vi.fn();
    apiClient.mockResolvedValue({});
    renderEs(<PersonForm mode="edit" personId="pe-1" initialData={existing} onSuccess={onSuccess} onCancel={onCancel} />);
    expect(screen.getByLabelText(/^Nombre/)).toHaveValue('Luis');
    await user.clear(screen.getByLabelText(/^Apellido/));
    await user.type(screen.getByLabelText(/^Apellido/), 'Cambiado');
    await user.click(screen.getByRole('button', { name: 'Guardar persona' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('pe-1'));
    expect(apiClient.mock.calls[0][0]).toBe('/persons/pe-1');
    expect(apiClient.mock.calls[0][1].method).toBe('PATCH');
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('muestra el mensaje de la API y lo asigna al campo si el error trae campos', async () => {
    const user = userEvent.setup();
    apiClient.mockRejectedValue(
      new ApiRequestError(409, 'EMAIL_EXISTS', 'Ya existe una persona con ese email', {
        message: 'Ya existe una persona con ese email',
        fieldErrors: { email: 'Email repetido' },
      }),
    );
    renderEs(<PersonForm mode="edit" personId="pe-1" initialData={existing} />);
    await user.click(screen.getByRole('button', { name: 'Guardar persona' }));
    expect(await screen.findByText('Ya existe una persona con ese email')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Correo electrónico/)).toHaveAccessibleDescription('Email repetido');
  });

  it('un error que no es de la API muestra el mensaje genérico del formulario', async () => {
    const user = userEvent.setup();
    apiClient.mockRejectedValue(new Error('red caída'));
    renderEs(<PersonForm mode="edit" personId="pe-1" initialData={existing} />);
    await user.click(screen.getByRole('button', { name: 'Guardar persona' }));
    expect(await screen.findByRole('alert')).not.toHaveTextContent('red caída');
  });

  it('carga los datos de la parte (tipo, documento, domicilio, estado civil, nacionalidad, forma de cobro)', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    apiClient.mockResolvedValue({ id: 'pe-9' });
    renderEs(<PersonForm mode="create" onSuccess={onSuccess} />);
    await user.type(screen.getByLabelText(/^Nombre/), 'Ana');
    await user.type(screen.getByLabelText(/^Apellido/), 'Prueba');
    await user.selectOptions(screen.getByLabelText('Tipo de persona'), 'Juridica');
    await user.type(screen.getByLabelText('Documento (DNI)'), '12345678');
    await user.type(screen.getByLabelText('Domicilio'), 'Calle Falsa 123');
    await user.type(screen.getByLabelText('Estado civil'), 'Casada');
    await user.type(screen.getByLabelText('Nacionalidad'), 'Argentina');
    await user.selectOptions(screen.getByLabelText('Forma de cobro'), 'Custodia');
    await user.click(screen.getByRole('button', { name: 'Guardar persona' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('pe-9'));
    expect(JSON.parse(apiClient.mock.calls[0][1].body)).toEqual({
      firstName: 'Ana',
      lastName: 'Prueba',
      personType: 'Juridica',
      dni: '12345678',
      address: 'Calle Falsa 123',
      maritalStatus: 'Casada',
      nationality: 'Argentina',
      payoutMethod: 'Custodia',
    });
  });

  it('al editar, vaciar un dato de la parte lo limpia con null y se mantiene lo cargado', async () => {
    const user = userEvent.setup();
    apiClient.mockResolvedValue({});
    renderEs(
      <PersonForm
        mode="edit"
        personId="pe-1"
        initialData={{ ...existing, personType: 'Fisica', dni: '111', address: 'Calle 1', nationality: 'Argentina', payoutMethod: 'Efectivo' }}
        onSuccess={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Documento (DNI)')).toHaveValue('111');
    expect(screen.getByLabelText('Forma de cobro')).toHaveValue('Efectivo');
    await user.clear(screen.getByLabelText('Domicilio'));
    await user.click(screen.getByRole('button', { name: 'Guardar persona' }));
    await waitFor(() => expect(apiClient).toHaveBeenCalled());
    const body = JSON.parse(apiClient.mock.calls[0][1].body);
    expect(body).toMatchObject({ personType: 'Fisica', dni: '111', address: null, maritalStatus: null, nationality: 'Argentina', payoutMethod: 'Efectivo' });
  });
});
