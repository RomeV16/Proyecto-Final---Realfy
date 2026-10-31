// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '../index-data/test-utils';
import { PrintButton, PrintSheet } from './print-sheet';

const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');
const printCss = css.slice(css.indexOf('@media print'));
const layout = readFileSync(join(process.cwd(), 'src/components/layout/app-layout.tsx'), 'utf8');

/** Recibo de ejemplo con datos sintéticos: la forma en que lo usarán los recibos y resúmenes de dueño. */
function ReceiptExample() {
  return (
    <PrintSheet
      label="Recibo de ejemplo"
      header={
        <div>
          <h1>Administración de Prueba</h1>
          <p>Recibo N.º 0001-00000001</p>
        </div>
      }
      footer={<p>Documento sin valor fiscal</p>}
    >
      <table>
        <thead>
          <tr>
            <th>Concepto</th>
            <th>Importe</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Alquiler</td>
            <td>100.000</td>
          </tr>
        </tbody>
      </table>
      <PrintButton />
    </PrintSheet>
  );
}

describe('PrintSheet', () => {
  it('es un documento con nombre, encabezado, cuerpo y pie', () => {
    renderEs(<ReceiptExample />);
    const sheet = screen.getByRole('article', { name: 'Recibo de ejemplo' });
    expect(within(sheet).getByRole('banner')).toHaveTextContent('Recibo N.º 0001-00000001');
    expect(within(sheet).getByRole('table')).toBeInTheDocument();
    expect(within(sheet).getByRole('contentinfo')).toHaveTextContent('Documento sin valor fiscal');
  });

  it('se aplana al imprimir: sin borde, sombra ni relleno y sin ancho máximo', () => {
    renderEs(<ReceiptExample />);
    const sheet = screen.getByRole('article');
    for (const cls of ['print:border-0', 'print:p-0', 'print:shadow-none', 'print:max-w-none']) {
      expect(sheet).toHaveClass(cls);
    }
    expect(sheet).toHaveClass('max-w-[210mm]');
  });

  it('el encabezado y el pie no se cortan entre páginas', () => {
    renderEs(<ReceiptExample />);
    expect(screen.getByRole('banner')).toHaveClass('print-avoid-break');
    expect(screen.getByRole('contentinfo')).toHaveClass('print-avoid-break');
  });

  it('sin encabezado ni pie solo queda el cuerpo; acepta clases extra', () => {
    renderEs(
      <PrintSheet label="Mínimo" className="mi-hoja">
        <p>Solo cuerpo</p>
      </PrintSheet>,
    );
    const sheet = screen.getByRole('article', { name: 'Mínimo' });
    expect(sheet).toHaveClass('mi-hoja');
    expect(within(sheet).queryByRole('banner')).not.toBeInTheDocument();
    expect(within(sheet).queryByRole('contentinfo')).not.toBeInTheDocument();
  });
});

describe('PrintButton', () => {
  it('abre el diálogo de impresión y no sale en la hoja', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    renderEs(<ReceiptExample />);
    const button = screen.getByRole('button', { name: 'Imprimir' });
    expect(button).toHaveClass('print:hidden');
    await userEvent.click(button);
    expect(print).toHaveBeenCalledOnce();
    print.mockRestore();
  });
});

describe('estilos de impresión', () => {
  it('definen margen de página, negro sobre blanco y ocultan lo que no es documento', () => {
    expect(printCss).toContain('@page { margin: 15mm; }');
    expect(printCss).toMatch(/background: #fff !important/);
    expect(printCss).toMatch(/color: #000 !important/);
    expect(printCss).toMatch(/\.print-hide[\s\S]*display: none !important/);
    expect(printCss).toContain('break-inside: avoid');
  });

  it('fuerzan la paleta clara aunque la pantalla esté en modo oscuro', () => {
    expect(printCss).toMatch(/:root,\s*\.dark \{[\s\S]*--color-surface: #fff;[\s\S]*--color-text: #000;/);
  });

  it('la navegación y el encabezado de la app se ocultan al imprimir', () => {
    expect(layout.match(/contents print:hidden/g)).toHaveLength(3);
  });
});
