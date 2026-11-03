// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '../index-data/test-utils';

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock('@/lib/toast', () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn(), info: vi.fn() } }));

import { FieldsDialog, type FieldDef } from './fields-dialog';

const FIELDS: FieldDef[] = [
  { name: 'when', label: 'Fecha', kind: 'date', required: true },
  { name: 'amount', label: 'Importe', kind: 'amount' },
  { name: 'kind', label: 'Tipo', kind: 'select', required: true, options: [{ value: 'a', label: 'Tipo A' }, { value: 'b', label: 'Tipo B' }] },
  { name: 'extra', label: 'Extra', kind: 'select', options: [{ value: 'x', label: 'Equis' }] },
  { name: 'reason', label: 'Motivo', kind: 'textarea', required: true, visible: (v) => v.kind === 'b' },
  { name: 'qty', label: 'Cantidad', kind: 'number' },
  { name: 'note', label: 'Nota', kind: 'text' },
];

function setup(over: Partial<React.ComponentProps<typeof FieldsDialog>> = {}) {
  const request = vi.fn().mockResolvedValue({});
  const props = {
    title: 'Título',
    description: 'Descripción',
    fields: FIELDS,
    initial: { kind: 'a' },
    submitLabel: 'Confirmar acción',
    successMessage: 'Hecho.',
    errorFallback: 'Falló.',
    request,
    onClose: vi.fn(),
    onDone: vi.fn(),
    ...over,
  };
  renderEs(<FieldsDialog {...props} />);
  return { ...props, request: props.request as ReturnType<typeof vi.fn> };
}

describe('FieldsDialog', () => {
  it('valida lo obligatorio y el importe antes de enviar', async () => {
    const props = setup();
    await userEvent.type(screen.getByLabelText(/Importe/), '12,3,4');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar acción' }));
    expect(await screen.findByText('Este dato es obligatorio.')).toBeInTheDocument();
    expect(screen.getByText(/Ingresá un importe mayor a cero/)).toBeInTheDocument();
    expect(props.request).not.toHaveBeenCalled();
  });

  it('envía los valores limpios, avisa y cierra; los campos ocultos no viajan ni se validan', async () => {
    const props = setup();
    await userEvent.type(screen.getByLabelText(/Fecha/), '2026-11-10');
    await userEvent.type(screen.getByLabelText(/Importe/), '1500.50');
    await userEvent.type(screen.getByLabelText(/Cantidad/), '3');
    await userEvent.type(screen.getByLabelText('Nota'), '  una nota  ');
    await userEvent.selectOptions(screen.getByLabelText('Extra'), 'x');
    expect(screen.queryByLabelText(/Motivo/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar acción' }));
    await waitFor(() => expect(props.request).toHaveBeenCalledTimes(1));
    expect(props.request).toHaveBeenCalledWith({ when: '2026-11-10', amount: '1500.50', kind: 'a', extra: 'x', qty: '3', note: 'una nota' });
    expect(toastSuccess).toHaveBeenCalledWith('Hecho.');
    expect(props.onDone).toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalled();
  });

  it('un campo visible según otro se muestra y se exige', async () => {
    const props = setup();
    await userEvent.selectOptions(screen.getByLabelText(/Tipo/), 'b');
    await userEvent.type(screen.getByLabelText(/Fecha/), '2026-11-10');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar acción' }));
    expect(await screen.findByText('Este dato es obligatorio.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Motivo/), 'porque sí');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar acción' }));
    await waitFor(() => expect(props.request).toHaveBeenCalled());
    expect(props.request.mock.calls[0][0]).toMatchObject({ kind: 'b', reason: 'porque sí' });
  });

  it('si el pedido falla muestra el error y no cierra', async () => {
    const props = setup({ request: vi.fn().mockRejectedValue(new Error('boom')) });
    await userEvent.type(screen.getByLabelText(/Fecha/), '2026-11-10');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar acción' }));
    expect(await screen.findByText('Falló.')).toBeInTheDocument();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onDone).not.toHaveBeenCalled();
  });

  it('la validación propia frena el envío con su mensaje y el contenido extra se muestra', async () => {
    const props = setup({ precheck: () => 'Falta elegir algo.', extra: <p>Contenido propio</p>, fields: [] });
    expect(screen.getByText('Contenido propio')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar acción' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Falta elegir algo.');
    expect(props.request).not.toHaveBeenCalled();
  });

  it('cancelar cierra sin enviar', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(props.onClose).toHaveBeenCalled();
    expect(props.request).not.toHaveBeenCalled();
  });
});
