// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiRequestError } from '@/lib/api-client';
import { renderEs } from '../index-data/test-utils';
import { ErrorNotice } from './error-notice';

const apiError = new ApiRequestError(
  409,
  'CONTRACT_OVERLAP',
  'Ya hay un contrato vigente en esa propiedad',
  { message: 'Ya hay un contrato vigente en esa propiedad', correlationId: 'corr-abc-123' },
);

describe('ErrorNotice', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('muestra mensaje, código y referencia de un error de la API con role=alert', () => {
    renderEs(<ErrorNotice error={apiError} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Ya hay un contrato vigente en esa propiedad');
    expect(alert).toHaveTextContent('Código: CONTRACT_OVERLAP');
    expect(alert).toHaveTextContent('Referencia: corr-abc-123');
  });

  it('copia la referencia al portapapeles y lo avisa un momento', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderEs(<ErrorNotice error={apiError} />);
    await user.click(screen.getByRole('button', { name: 'Copiar referencia' }));
    expect(writeText).toHaveBeenCalledWith('corr-abc-123');
    expect(await screen.findByRole('button', { name: 'Copiada' })).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(2100);
    });
    expect(screen.getByRole('button', { name: 'Copiar referencia' })).toBeInTheDocument();
  });

  it('si el portapapeles falla no rompe ni dice copiada', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denegado')) },
      configurable: true,
    });
    renderEs(<ErrorNotice error={apiError} />);
    await user.click(screen.getByRole('button', { name: 'Copiar referencia' }));
    expect(screen.getByRole('button', { name: 'Copiar referencia' })).toBeInTheDocument();
  });

  it('un código genérico usa su texto localizado en lugar del de la API', () => {
    const err = new ApiRequestError(500, 'INTERNAL_ERROR', 'Internal server error', {});
    renderEs(<ErrorNotice error={err} />);
    expect(screen.getByRole('alert')).toHaveTextContent('El servidor tuvo un problema');
    expect(screen.queryByText('Internal server error')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('un error sin código ni referencia muestra solo el mensaje', () => {
    renderEs(<ErrorNotice error={new ApiRequestError(0, '', 'Sin conexión')} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Sin conexión');
    expect(screen.queryByText(/Código/)).not.toBeInTheDocument();
  });

  it('un Error común usa el texto de reemplazo si se da, y si no su mensaje', () => {
    const { unmount } = renderEs(<ErrorNotice error={new Error('boom')} fallback="No se pudo guardar" />);
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo guardar');
    unmount();
    renderEs(<ErrorNotice error={new Error('boom')} />);
    expect(screen.getByRole('alert')).toHaveTextContent('boom');
  });

  it('un texto se muestra tal cual y cualquier otra cosa cae al genérico', () => {
    const { unmount } = renderEs(<ErrorNotice error="Falló la carga" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Falló la carga');
    unmount();
    renderEs(<ErrorNotice error={undefined} className="mi-clase" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Ocurrió un error inesperado.');
    expect(screen.getByRole('alert')).toHaveClass('mi-clase');
  });
});
