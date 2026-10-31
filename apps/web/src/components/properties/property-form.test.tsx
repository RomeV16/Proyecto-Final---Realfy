// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '../index-data/test-utils';

const { apiClient } = vi.hoisted(() => ({ apiClient: vi.fn() }));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));

import { ApiRequestError } from '@/lib/api-client';
import { PropertyForm, type PropertyData } from './property-form';

const existing: PropertyData = {
  id: 'pr-1',
  title: 'Departamento de prueba',
  description: '',
  type: 'Departamento',
  street: 'Calle Inventada',
  number: '123',
  floor: '',
  apartment: '',
  city: 'Ciudad Ficticia',
  province: '',
  postalCode: '',
  totalArea: '50',
  rooms: '',
  bedrooms: '',
  bathrooms: '',
  garages: '',
  age: '',
  orientation: '',
  price: '100000',
  currency: 'USD',
  amenities: ['Pileta'],
  operations: [{ id: 'op-1', operationType: 'Alquiler', state: 'Disponible' }],
  priceHistory: [{ id: 'ph-1', price: '90000', currency: 'USD', changedAt: '2026-03-10T12:00:00.000Z' }],
};

describe('PropertyForm', () => {
  beforeEach(() => {
    apiClient.mockReset();
  });

  it('las etiquetas se asocian a sus controles y título y tipo son obligatorios', () => {
    renderEs(<PropertyForm mode="create" />);
    expect(screen.getByLabelText(/^Título/)).toHaveAttribute('aria-required', 'true');
    expect(screen.getByLabelText(/^Tipo de propiedad/)).toHaveAttribute('aria-required', 'true');
    expect(screen.getByLabelText(/^Descripción/).tagName).toBe('TEXTAREA');
    expect(screen.getByLabelText(/^Superficie total/)).toHaveAttribute('type', 'number');
  });

  it('no envía sin título ni tipo y marca los campos inválidos', async () => {
    const user = userEvent.setup();
    renderEs(<PropertyForm mode="create" />);
    await user.click(screen.getByRole('button', { name: 'Guardar propiedad' }));
    expect(apiClient).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^Título/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/^Tipo de propiedad/)).toHaveAccessibleDescription('Este campo es obligatorio');
    await waitFor(() => expect(screen.getByLabelText(/^Título/)).toHaveFocus());
  });

  it('rechaza un precio negativo antes de enviar', async () => {
    const user = userEvent.setup();
    renderEs(<PropertyForm mode="create" />);
    await user.type(screen.getByLabelText(/^Título/), 'Casa');
    await user.selectOptions(screen.getByLabelText(/^Tipo de propiedad/), 'Casa');
    await user.type(screen.getByLabelText(/^Precio/), '-5');
    await user.click(screen.getByRole('button', { name: 'Guardar propiedad' }));
    expect(apiClient).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^Precio/)).toHaveAccessibleDescription('El valor debe ser positivo');
  });

  it('crea la propiedad con su operación inicial y los números convertidos', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    apiClient.mockResolvedValueOnce({ id: 'pr-9' }).mockResolvedValueOnce({});
    renderEs(<PropertyForm mode="create" onSuccess={onSuccess} />);
    await user.type(screen.getByLabelText(/^Título/), 'Casa de prueba');
    await user.selectOptions(screen.getByLabelText(/^Tipo de propiedad/), 'Casa');
    await user.type(screen.getByLabelText(/^Descripción/), 'Texto');
    await user.type(screen.getByLabelText(/^Calle/), 'Calle Inventada');
    await user.selectOptions(screen.getByLabelText(/^Provincia/), 'Córdoba');
    await user.type(screen.getByLabelText(/^Superficie total/), '80');
    await user.type(screen.getByLabelText(/^Ambientes/), '3');
    await user.type(screen.getByLabelText(/^Precio/), '1500');
    await user.selectOptions(screen.getByLabelText(/^Moneda/), 'ARS');
    await user.selectOptions(screen.getByLabelText(/^Tipo de operación/), 'Venta');
    await user.selectOptions(screen.getByLabelText(/^Estado de la operación/), 'Reservado');
    await user.click(screen.getByRole('button', { name: 'Terraza' }));
    expect(screen.getByRole('button', { name: 'Terraza' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Terraza' }));
    await user.click(screen.getByRole('button', { name: 'Jardín' }));
    await user.click(screen.getByRole('button', { name: 'Guardar propiedad' }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('pr-9'));
    const [path, options] = apiClient.mock.calls[0];
    expect(path).toBe('/properties');
    expect(JSON.parse(options.body)).toMatchObject({
      title: 'Casa de prueba',
      type: 'Casa',
      description: 'Texto',
      street: 'Calle Inventada',
      province: 'Córdoba',
      area: 80,
      rooms: 3,
      price: 1500,
      currency: 'ARS',
      amenities: ['Jardin'],
    });
    const [opPath, opOptions] = apiClient.mock.calls[1];
    expect(opPath).toBe('/properties/pr-9/operations');
    expect(JSON.parse(opOptions.body)).toEqual({ operationType: 'Venta', state: 'Reservado' });
  });

  it('en edición hace PATCH, muestra el historial de precios y las operaciones', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    apiClient.mockResolvedValue({});
    renderEs(<PropertyForm mode="edit" propertyId="pr-1" initialData={existing} onSuccess={onSuccess} />);
    expect(screen.getByLabelText(/^Título/)).toHaveValue('Departamento de prueba');
    expect(screen.getByText('Historial de precios')).toBeInTheDocument();
    expect(screen.getByText('Alquiler')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pileta' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Guardar propiedad' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('pr-1'));
    expect(apiClient.mock.calls[0][0]).toBe('/properties/pr-1');
    expect(apiClient.mock.calls[0][1].method).toBe('PATCH');
  });

  it('agrega una operación y cambia su estado sin salir del formulario', async () => {
    const user = userEvent.setup();
    apiClient
      .mockResolvedValueOnce({ id: 'op-2', operationType: 'Venta', state: 'Disponible' })
      .mockResolvedValueOnce({});
    renderEs(<PropertyForm mode="edit" propertyId="pr-1" initialData={existing} />);
    await user.selectOptions(screen.getByLabelText(/^Tipo de operación/), 'Venta');
    await user.click(screen.getByRole('button', { name: 'Agregar operación' }));
    await waitFor(() => expect(apiClient.mock.calls[0][0]).toBe('/properties/pr-1/operations'));
    expect(await screen.findByText('Venta')).toBeInTheDocument();
    // El tipo ya agregado deja de ofrecerse.
    expect(within(screen.getByLabelText(/^Tipo de operación/)).queryByRole('option', { name: 'Venta' })).not.toBeInTheDocument();

    const row = screen.getByText('Alquiler').closest('div[class*="flex-col"]') as HTMLElement;
    const transitions = within(row).getAllByRole('button');
    await user.click(transitions[0]);
    await waitFor(() => expect(apiClient.mock.calls[1][0]).toMatch(/\/operations\/op-1\/state$/));
  });

  it('un error de la API al guardar se muestra y no pisa los datos cargados', async () => {
    const user = userEvent.setup();
    apiClient.mockRejectedValue(new ApiRequestError(400, 'BAD', 'Dato inválido', { message: 'Dato inválido' }));
    renderEs(<PropertyForm mode="edit" propertyId="pr-1" initialData={existing} />);
    await user.click(screen.getByRole('button', { name: 'Guardar propiedad' }));
    expect(await screen.findByText('Dato inválido')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Título/)).toHaveValue('Departamento de prueba');
  });

  it('un error que no es de la API muestra el texto genérico y cancelar avisa', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    apiClient.mockRejectedValue(new Error('caída'));
    renderEs(<PropertyForm mode="edit" propertyId="pr-1" initialData={existing} onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: 'Guardar propiedad' }));
    expect(await screen.findByText(/No se pudo guardar la propiedad/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
