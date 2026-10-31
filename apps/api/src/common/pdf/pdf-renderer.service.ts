import { Injectable } from '@nestjs/common';
import { formatMoneyAR, formatDateAR, type MoneyLike } from '@realfy/shared';

// pdfmake en Node: módulo CommonJS, se carga con require.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PdfPrinter = require('pdfmake/src/printer');

/** Fuentes del PDF: las estándar de PDF, sin archivos que empaquetar. */
const FONTS = {
  Roboto: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
};

/** Estilos base de todos los documentos; cada PDF puede pisar los que necesite. */
export const PDF_BASE_STYLES = {
  header: { fontSize: 18, bold: true },
  title: { fontSize: 14, bold: true },
  subheader: { fontSize: 12, bold: true },
};

const PDF_DEFAULT_STYLE = { fontSize: 10 };

/** Definición de documento de pdfmake; los servicios la arman sin tipar cada nodo. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PdfDocDefinition = Record<string, any>;

/**
 * Celda de importe alineada a la derecha, con "$ " delante salvo que se pida lo
 * contrario. `prefix` va antes del símbolo (por ejemplo "- " en los descuentos).
 */
export function moneyCell(
  amount: MoneyLike,
  options: { symbol?: boolean; prefix?: string } & Record<string, unknown> = {},
): Record<string, unknown> {
  const { symbol = true, prefix = '', ...style } = options;
  return { text: `${prefix}${symbol ? '$ ' : ''}${formatMoneyAR(amount)}`, alignment: 'right', ...style };
}

/** Celda con una fecha sin hora como dd/mm/aaaa. */
export function dateCell(date: Date | string, style: Record<string, unknown> = {}): Record<string, unknown> {
  return { text: formatDateAR(date), ...style };
}

/** Celda de encabezado de tabla en negrita. */
export function headerCell(text: string, style: Record<string, unknown> = {}): Record<string, unknown> {
  return { text, bold: true, ...style };
}

/**
 * Pie de página: texto a la izquierda (vacío si no hay) y "Pág. n/total" a la
 * derecha. `style` se aplica a ambas celdas (tamaño, color).
 */
export function pageFooter(left: string | null | undefined, style: Record<string, unknown> = { fontSize: 8 }) {
  return (currentPage: number, pageCount: number) => ({
    columns: [
      left ? { text: left, ...style, margin: [40, 0, 0, 0] } : { text: '' },
      { text: `Pág. ${currentPage}/${pageCount}`, ...style, alignment: 'right', margin: [0, 0, 40, 0] },
    ],
  });
}

/** Genera el PDF de un documento de pdfmake y lo devuelve como Buffer. */
@Injectable()
export class PdfRendererService {
  render(docDefinition: PdfDocDefinition): Promise<Buffer> {
    const definition = {
      ...docDefinition,
      styles: { ...PDF_BASE_STYLES, ...docDefinition.styles },
      defaultStyle: { ...PDF_DEFAULT_STYLE, ...docDefinition.defaultStyle },
    };

    return new Promise<Buffer>((resolve, reject) => {
      try {
        const printer = new PdfPrinter(FONTS);
        const pdfDoc = printer.createPdfKitDocument(definition);
        const chunks: Buffer[] = [];
        pdfDoc.on('data', (chunk: Buffer) => chunks.push(chunk));
        pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
        pdfDoc.on('error', (err: Error) => reject(err));
        pdfDoc.end();
      } catch (error) {
        reject(error);
      }
    });
  }
}
