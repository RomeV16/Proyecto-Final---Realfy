import { Injectable, Logger } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { ReportResult } from './reports.service';

/** Column definition for formatting */
interface ReportColumnDef {
  header: string;
  key: string;
  width: number;
  isNumeric?: boolean;
}

/** Column layouts per report type */
const COLUMN_DEFS: Record<string, ReportColumnDef[]> = {
  ownerStatement: [
    { header: 'Período', key: 'periodo', width: 14 },
    { header: 'Propiedad', key: 'propiedad', width: 30 },
    { header: 'Cobrado', key: 'cobrado', width: 16, isNumeric: true },
    { header: 'Comisión', key: 'comision', width: 16, isNumeric: true },
    { header: 'Honorarios', key: 'honorarios', width: 16, isNumeric: true },
    { header: 'Deducciones', key: 'deducciones', width: 16, isNumeric: true },
    { header: 'Depósito Neto', key: 'depositoNeto', width: 18, isNumeric: true },
  ],
  propertyProfitability: [
    { header: 'Propiedad', key: 'propiedad', width: 30 },
    { header: 'Cobrado', key: 'cobrado', width: 16, isNumeric: true },
    { header: 'Facturado', key: 'facturado', width: 16, isNumeric: true },
    { header: 'Comisiones', key: 'comisiones', width: 16, isNumeric: true },
    { header: 'Ingreso Neto', key: 'ingresoNeto', width: 18, isNumeric: true },
  ],
  cashFlow: [
    { header: 'Mes', key: 'mes', width: 22 },
    { header: 'Ingresos', key: 'ingresos', width: 16, isNumeric: true },
    { header: 'Egresos', key: 'egresos', width: 16, isNumeric: true },
    { header: 'Facturado', key: 'facturado', width: 16, isNumeric: true },
    { header: 'Saldo Neto', key: 'saldoNeto', width: 18, isNumeric: true },
  ],
  commissionSummary: [
    { header: 'Propiedad', key: 'propiedad', width: 30 },
    { header: 'Propietario', key: 'propietario', width: 25 },
    { header: 'Período', key: 'periodo', width: 14 },
    { header: 'Tipo Comisión', key: 'tipoComision', width: 16 },
    { header: 'Comisión', key: 'comision', width: 16, isNumeric: true },
    { header: 'Honorarios', key: 'honorarios', width: 16, isNumeric: true },
    { header: 'Total', key: 'total', width: 16, isNumeric: true },
  ],
  pipelineAnalytics: [
    { header: 'Etapa', key: 'etapa', width: 25 },
    { header: 'Leads Actuales', key: 'leadsActuales', width: 16, isNumeric: true },
    { header: 'Convertidos', key: 'convertidos', width: 16, isNumeric: true },
    { header: 'Perdidos', key: 'perdidos', width: 16, isNumeric: true },
    { header: 'Tasa Conversión', key: 'tasaConversion', width: 18 },
    { header: 'Promedio Conversión (días)', key: 'promedioConversionDias', width: 22, isNumeric: true },
  ],
  morosidad: [
    { header: 'Propiedad', key: 'propiedad', width: 30 },
    { header: 'Inquilino', key: 'inquilino', width: 25 },
    { header: 'Período', key: 'periodo', width: 14 },
    { header: 'Vencimiento', key: 'vencimiento', width: 14 },
    { header: 'Días Vencidos', key: 'diasVencidos', width: 16, isNumeric: true },
    { header: 'Monto', key: 'monto', width: 16, isNumeric: true },
    { header: 'Moneda', key: 'moneda', width: 10 },
  ],
};

@Injectable()
export class ReportExcelService {
  private readonly logger = new Logger(ReportExcelService.name);

  /**
   * Generate an Excel workbook buffer for the given report data.
   */
  async generateExcel(report: ReportResult<any>): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Realfy';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet(report.title);

    const columnDefs = COLUMN_DEFS[report.type];
    if (!columnDefs) {
      throw new Error(`Unknown report type for Excel export: ${report.type}`);
    }

    // Set columns
    sheet.columns = columnDefs.map((col) => ({
      header: col.header,
      key: col.key,
      width: col.width,
    }));

    // Style header row
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, size: 11 };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' },
    };
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

    // Add data rows
    for (const row of report.rows) {
      const excelRow = sheet.addRow(row);

      // Format numeric columns as numbers
      for (const col of columnDefs) {
        if (col.isNumeric) {
          const cellIndex = columnDefs.indexOf(col) + 1;
          const cell = excelRow.getCell(cellIndex);
          cell.value = parseFloat(row[col.key]) || 0;
          cell.numFmt = '#,##0.00';
          cell.alignment = { horizontal: 'right' };
        }
      }
    }

    // Add summary row if present
    if (report.summary) {
      const summaryData: Record<string, any> = {};
      for (const col of columnDefs) {
        if (col.isNumeric && report.summary[col.key] !== undefined) {
          summaryData[col.key] = col.key; // placeholder
        }
      }
      // Build the summary row
      const summaryRowValues: any = {};
      const firstCol = columnDefs[0];
      summaryRowValues[firstCol.key] = 'TOTAL';
      for (const col of columnDefs) {
        if (col.isNumeric && report.summary[col.key] !== undefined) {
          summaryRowValues[col.key] = parseFloat(report.summary[col.key]) || 0;
        }
      }

      const summaryRow = sheet.addRow(summaryRowValues);
      summaryRow.font = { bold: true, size: 11 };
      summaryRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE2EFDA' },
      };

      // Format numeric cells in summary
      for (const col of columnDefs) {
        if (col.isNumeric) {
          const cellIndex = columnDefs.indexOf(col) + 1;
          const cell = summaryRow.getCell(cellIndex);
          cell.numFmt = '#,##0.00';
          cell.alignment = { horizontal: 'right' };
        }
      }
    }

    // Auto-filter on header
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: columnDefs.length },
    };

    // Freeze header row
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    const buffer = await workbook.xlsx.writeBuffer();

    this.logger.log('Excel report generated', {
      reportType: report.type,
      rowCount: report.rows.length,
      bufferSize: buffer.byteLength,
    });

    return Buffer.from(buffer);
  }
}
