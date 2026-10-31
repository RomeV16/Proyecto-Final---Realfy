// @vitest-environment jsdom
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import es from '@/i18n/messages/es.json';
import { StepItems, type StepItemsData } from './step-items';

const nb = (s: string | null) => (s ?? '').replaceAll(' ', ' ');

function data(overrides: Partial<StepItemsData> = {}): StepItemsData {
  return {
    items: [{ descripcion: 'Honorarios de prueba', cantidad: 2, precioUnitario: 1000, alicuotaIvaId: 5 }],
    amounts: {
      impNeto: 2000,
      impIva: 420,
      impTotal: 2420,
      impTotConc: 0,
      impOpEx: 0,
      impTrib: 0,
      monId: 'PES',
      monCotiz: 1,
    },
    ...overrides,
  };
}

function Harness({
  initial,
  onNext = () => {},
  onBack = () => {},
  options = [],
  spy,
}: {
  initial: StepItemsData;
  onNext?: () => void;
  onBack?: () => void;
  options?: { id: number; desc: string }[];
  spy?: (v: StepItemsData) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <NextIntlClientProvider locale="es" messages={es}>
      <StepItems
        value={value}
        onChange={(v) => {
          spy?.(v);
          setValue(v);
        }}
        onNext={onNext}
        onBack={onBack}
        alicuotaOptions={options}
      />
    </NextIntlClientProvider>
  );
}

describe('StepItems', () => {
  it('muestra subtotal, IVA y total con formato de moneda', () => {
    render(<Harness initial={data()} />);
    const text = nb(document.body.textContent);
    expect(text).toContain('Subtotal: $ 2.000,00');
    expect(text).toContain('IVA: $ 420,00');
    expect(text).toContain('Total: $ 2.420,00');
    expect(text).toContain('Importe neto$ 2.000,00');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('usa las alícuotas estáticas si no hay opciones y las recibidas si las hay', () => {
    const { unmount } = render(<Harness initial={data()} />);
    expect(screen.getByRole('option', { name: '10.5%' })).toBeInTheDocument();
    unmount();
    render(<Harness initial={data()} options={[{ id: 5, desc: 'Veintiuno de prueba' }]} />);
    expect(screen.getByRole('option', { name: 'Veintiuno de prueba' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '10.5%' })).not.toBeInTheDocument();
  });

  it('recalcula al editar cantidad, precio y alícuota', async () => {
    const spy = vi.fn();
    const user = userEvent.setup();
    render(<Harness initial={data()} spy={spy} />);
    const qty = screen.getByLabelText(/Cantidad/);
    await user.clear(qty);
    await user.type(qty, '3');
    expect(nb(document.body.textContent)).toContain('Subtotal: $ 3.000,00');
    const price = screen.getByLabelText('Precio unitario');
    await user.clear(price);
    await user.type(price, '100');
    expect(nb(document.body.textContent)).toContain('Subtotal: $ 300,00');
    await user.selectOptions(screen.getByLabelText('Alícuota IVA'), '4');
    expect(nb(document.body.textContent)).toContain('IVA: $ 31,50');
    const last = spy.mock.calls.at(-1)![0] as StepItemsData;
    expect(last.amounts.impTotal).toBeCloseTo(331.5);
  });

  it('edita la descripción', async () => {
    const user = userEvent.setup();
    render(<Harness initial={data()} />);
    const desc = screen.getByLabelText(/Descripción/);
    await user.clear(desc);
    await user.type(desc, 'Otro');
    expect(desc).toHaveValue('Otro');
  });

  it('agrega y quita ítems; con uno solo no ofrece quitar', async () => {
    const user = userEvent.setup();
    render(<Harness initial={data()} />);
    expect(screen.queryByRole('button', { name: 'Quitar' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '+ Agregar ítem' }));
    expect(screen.getByText('Ítem 2')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Quitar' })[1]!);
    expect(screen.queryByText('Ítem 2')).not.toBeInTheDocument();
    expect(nb(document.body.textContent)).toContain('Total: $ 2.420,00');
  });

  it('quitar un ítem recalcula los importes', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(
      <Harness
        spy={spy}
        initial={data({
          items: [
            { descripcion: 'A', cantidad: 1, precioUnitario: 1000, alicuotaIvaId: 5 },
            { descripcion: 'B', cantidad: 1, precioUnitario: 500, alicuotaIvaId: 3 },
          ],
        })}
      />,
    );
    await user.click(screen.getAllByRole('button', { name: 'Quitar' })[0]!);
    const last = spy.mock.calls.at(-1)![0] as StepItemsData;
    expect(last.items).toHaveLength(1);
    expect(last.amounts.impNeto).toBe(500);
    expect(last.amounts.impIva).toBe(0);
  });

  it('los valores manuales se despliegan y suman al total', async () => {
    const user = userEvent.setup();
    render(<Harness initial={data()} />);
    expect(screen.queryByLabelText('No gravado')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Valores manuales/ }));
    const tot = screen.getByLabelText('No gravado');
    await user.clear(tot);
    await user.type(tot, '100');
    const text = nb(document.body.textContent);
    expect(text).toContain('$ 2.520,00');
    await user.type(screen.getByLabelText('Operaciones exentas'), '50');
    await user.type(screen.getByLabelText('Tributos'), '10');
    expect(screen.queryByLabelText('Cotización')).not.toBeInTheDocument();
  });

  it('en dólares pide cotización y permite editarla', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness initial={data()} spy={spy} />);
    await user.click(screen.getByRole('button', { name: /Valores manuales/ }));
    await user.selectOptions(screen.getByLabelText('Moneda'), 'DOL');
    const cotiz = screen.getByLabelText('Cotización');
    await user.clear(cotiz);
    await user.type(cotiz, '1200');
    const last = spy.mock.calls.at(-1)![0] as StepItemsData;
    expect(last.amounts.monId).toBe('DOL');
    // al vaciar el campo vuelve a 1, y lo tipeado se agrega a ese valor
    expect(last.amounts.monCotiz).toBe(11200);
  });

  it('avisa cuando el total recibido no coincide con el calculado', () => {
    render(<Harness initial={data({ amounts: { ...data().amounts, impTotal: 9999 } })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Advertencia: el total no coincide');
  });

  it('Siguiente se deshabilita sin ítems o con descripción vacía', () => {
    const { unmount } = render(<Harness initial={data({ items: [] })} />);
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
    unmount();
    render(
      <Harness
        initial={data({ items: [{ descripcion: '', cantidad: 1, precioUnitario: 1, alicuotaIvaId: 5 }] })}
      />,
    );
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
  });

  it('Atrás y Siguiente llaman a sus callbacks', async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    const onBack = vi.fn();
    render(<Harness initial={data()} onNext={onNext} onBack={onBack} />);
    await user.click(screen.getByRole('button', { name: 'Atrás' }));
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});
