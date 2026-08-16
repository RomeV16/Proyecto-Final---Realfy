import { Injectable, Logger } from '@nestjs/common';
import type { ReportResult } from './reports.service';

// pdfmake Node.js usage: dynamic require for CommonJS module

const PdfPrinter = require('pdfmake/src/printer');

const FONTS = {
  Roboto: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
};

@Injectable()
export class ReportPdfService {
  private readonly logger = new Logger(ReportPdfService.name);

  /**
   * Generate a PDF buffer for the given report data.
   */
  async generatePdf(report: ReportResult<any>): Promise<Buffer> {
    const columns = report.columns;
    const dataKeys = this.getDataKeys(report.type);

    // Build table widths — first column auto, rest equal
    const widths = columns.map((_, i) => (i === 0 ? 'auto' : '*'));

    // Header row
    const headerRow = columns.map((col) => ({
      text: col,
      bold: true,
      fontSize: 9,
      fillColor: '#4472C4',
      color: '#FFFFFF',
      alignment: 'center' as const,
    }));

    // Data rows
    const dataRows = report.rows.map((row: Record<string, any>) =>
      dataKeys.map((key, i) => {
        const value = row[key] ?? '';
        const isNumeric = !isNaN(parseFloat(value)) && i > 0;
        return {
          text: isNumeric ? this.formatAmount(value) : value,
          fontSize: 8,
          alignment: (isNumeric ? 'right' : 'left') as 'right' | 'left',
        };
      }),
    );

    // Summary row
    const summaryRows: any[][] = [];
    if (report.summary) {
      const summaryRow = dataKeys.map((key, i) => {
        if (i === 0) {
          return { text: 'TOTAL', bold: true, fontSize: 9, fillColor: '#E2EFDA' };
        }
        const value = report.summary![key];
        return {
          text: value ? this.formatAmount(value) : '',
          bold: true,
          fontSize: 9,
          alignment: 'right' as const,
          fillColor: '#E2EFDA',
        };
      });
      summaryRows.push(summaryRow);
    }

    const docDefinition: any = {
      pageOrientation: columns.length > 5 ? 'landscape' : 'portrait',
      pageSize: 'A4',
      content: [
        // Title
        {
          text: report.title,
          style: 'header',
          alignment: 'center',
          margin: [0, 0, 0, 10],
        },
        // Date info
        {
          text: `Generado: ${new Date().toLocaleDateString('es-AR')}`,
          alignment: 'center',
          fontSize: 9,
          color: '#666666',
          margin: [0, 0, 0, 15],
        },
        // Data table
        {
          table: {
            headerRows: 1,
            widths,
            body: [headerRow, ...dataRows, ...summaryRows],
          },
          layout: {
            hLineWidth: () => 0.5,
            vLineWidth: () => 0.5,
            hLineColor: () => '#CCCCCC',
            vLineColor: () => '#CCCCCC',
          },
        },
        // Row count footer
        {
          text: `${report.rows.length} registro(s)`,
          fontSize: 8,
          color: '#999999',
          margin: [0, 10, 0, 0],
        },
      ],
      footer: (currentPage: number, pageCount: number) => ({
        columns: [
          {
            text: report.title,
            fontSize: 7,
            margin: [40, 0, 0, 0],
            color: '#999999',
          },
          {
            text: `Pág. ${currentPage}/${pageCount}`,
            fontSize: 7,
            alignment: 'right',
            margin: [0, 0, 40, 0],
            color: '#999999',
          },
        ],
      }),
      styles: {
        header: { fontSize: 16, bold: true },
      },
      defaultStyle: {
        fontSize: 9,
      },
    };

    try {
      const printer = new PdfPrinter(FONTS);
      const pdfDoc = printer.createPdfKitDocument(docDefinition);

      const chunks: Buffer[] = [];
      return new Promise<Buffer>((resolve, reject) => {
        pdfDoc.on('data', (chunk: Buffer) => chunks.push(chunk));
        pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
        pdfDoc.on('error', (err: Error) => reject(err));
        pdfDoc.end();
      });
    } catch (error) {
      this.logger.error('Report PDF generation failed', {
        reportType: report.type,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /** Get ordered data keys for each report type */
  private getDataKeys(type: string): string[] {
    switch (type) {
      case 'ownerStatement':
        return ['periodo', 'propiedad', 'cobrado', 'comision', 'honorarios', 'deducciones', 'depositoNeto'];
      case 'propertyProfitability':
        return ['propiedad', 'cobrado', 'facturado', 'comisiones', 'ingresoNeto'];
      case 'cashFlow':
        return ['mes', 'ingresos', 'egresos', 'facturado', 'saldoNeto'];
      case 'commissionSummary':
        return ['propiedad', 'propietario', 'periodo', 'tipoComision', 'comision', 'honorarios', 'total'];
      case 'pipelineAnalytics':
        return ['etapa', 'leadsActuales', 'convertidos', 'perdidos', 'tasaConversion', 'promedioConversionDias'];
      case 'morosidad':
        return ['propiedad', 'inquilino', 'periodo', 'vencimiento', 'diasVencidos', 'monto', 'moneda'];
      default:
        return [];
    }
  }

  private formatAmount(amount: string | number): string {
    return Number(amount).toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
}
