import ExcelJS from 'exceljs';

/** Columna de una planilla o CSV. */
export interface TabularColumn {
  header: string;
  key: string;
  width?: number;
  /** Se muestra como número con miles y dos decimales, alineado a la derecha. */
  numeric?: boolean;
}

export type TabularRow = Record<string, unknown>;

export interface XlsxSheet {
  name: string;
  columns: TabularColumn[];
  rows: TabularRow[];
  /** Convierte a número (o 0) el valor de las columnas numéricas antes de escribirlas. */
  coerceNumeric?: boolean;
  /** Fila de totales al final, resaltada. `formatNumeric` le da formato a las columnas numéricas. */
  total?: { values: TabularRow; formatNumeric?: boolean };
}

const HEADER_FILL = 'FF4472C4';
const TOTAL_FILL = 'FFE2EFDA';
const NUMBER_FORMAT = '#,##0.00';

function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * CSV con BOM UTF-8 (para que Excel lo abra bien), encabezado y filas
 * separadas por CRLF. Los campos con coma, comilla o salto de línea se citan.
 */
export function buildCsv(rows: TabularRow[], columns: TabularColumn[]): string {
  const BOM = '﻿';
  const header = columns.map((c) => escapeCsvField(c.header)).join(',');
  const body = rows.map((row) =>
    columns.map((c) => escapeCsvField(String(row[c.key] ?? ''))).join(','),
  );
  return BOM + [header, ...body].join('\r\n');
}

function formatNumericCells(row: ExcelJS.Row, columns: TabularColumn[]): void {
  columns.forEach((col, index) => {
    if (!col.numeric) return;
    const cell = row.getCell(index + 1);
    cell.numFmt = NUMBER_FORMAT;
    cell.alignment = { horizontal: 'right' };
  });
}

/**
 * Libro de Excel con una hoja por entrada: encabezado azul, filtro en el
 * encabezado y primera fila congelada.
 */
export async function buildXlsx(sheets: XlsxSheet[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Realfy';
  workbook.created = new Date();

  for (const spec of sheets) {
    const sheet = workbook.addWorksheet(spec.name);
    sheet.columns = spec.columns.map((c) => ({ header: c.header, key: c.key, width: c.width }));

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

    for (const row of spec.rows) {
      const excelRow = sheet.addRow(row);
      spec.columns.forEach((col, index) => {
        if (col.numeric && spec.coerceNumeric) {
          excelRow.getCell(index + 1).value = parseFloat(String(row[col.key])) || 0;
        }
      });
      formatNumericCells(excelRow, spec.columns);
    }

    if (spec.total) {
      const totalRow = sheet.addRow(spec.total.values);
      totalRow.font = { bold: true, size: 11 };
      totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_FILL } };
      if (spec.total.formatNumeric) formatNumericCells(totalRow, spec.columns);
    }

    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: spec.columns.length } };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
