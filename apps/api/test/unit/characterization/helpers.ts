import ExcelJS from 'exceljs';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const PdfPrinter = require('pdfmake/src/printer');

/** Fecha fija para los textos "Generado: hoy". Solo se simula Date. */
export const FIXED_NOW = new Date('2025-06-15T12:00:00.000Z');

export function freezeDate(): void {
  jest.useFakeTimers({
    now: FIXED_NOW,
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
  });
}

/** Resuelve funciones (footer, layout) y abrevia imágenes para que el snapshot sea legible. */
function normalize(value: unknown, key = ''): unknown {
  if (typeof value === 'function') {
    try {
      return normalize(key === 'footer' ? value(1, 3) : value(0, {}, 0));
    } catch {
      return '[function]';
    }
  }
  if (typeof value === 'string' && value.startsWith('data:image')) {
    return `[imagen ${value.length} caracteres]`;
  }
  if (Array.isArray(value)) return value.map((v) => normalize(v));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, normalize(v, k)]),
    );
  }
  return value;
}

/** Ejecuta `run` y devuelve la definición de documento que se le pasó a pdfmake. */
export async function captureDocDefinition(run: () => Promise<unknown>): Promise<unknown> {
  const spy = jest.spyOn(PdfPrinter.prototype, 'createPdfKitDocument');
  try {
    await run();
    expect(spy).toHaveBeenCalledTimes(1);
    return normalize(spy.mock.calls[0][0]);
  } finally {
    spy.mockRestore();
  }
}

/** Contenido y formato observable de un libro de Excel. */
export async function dumpWorkbook(buffer: Buffer): Promise<unknown> {
  const workbook = new ExcelJS.Workbook();
  await (workbook.xlsx.load as unknown as (b: Buffer) => Promise<unknown>)(buffer);
  return workbook.worksheets.map((sheet) => ({
    name: sheet.name,
    columnWidths: sheet.columns.map((c) => c.width),
    autoFilter: sheet.autoFilter,
    views: sheet.views,
    rows: Array.from({ length: sheet.rowCount }, (_, i) => {
      const row = sheet.getRow(i + 1);
      return {
        cells: Array.from({ length: sheet.columnCount }, (_, j) => {
          const cell = row.getCell(j + 1);
          return {
            value: cell.value,
            numFmt: cell.numFmt,
            alignment: cell.alignment,
            font: cell.font,
            fill: cell.fill,
          };
        }),
      };
    }),
  }));
}
