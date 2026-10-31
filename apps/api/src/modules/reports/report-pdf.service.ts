import { Injectable, Logger } from '@nestjs/common';
import type { ReportResult } from './reports.service';
import { formatDateAR, formatMoneyAR, todayInAR } from '@realfy/shared';
import { findReport } from './report-registry';
import { PdfRendererService, moneyCell, pageFooter } from '../../common/pdf/pdf-renderer.service';

@Injectable()
export class ReportPdfService {
  private readonly logger = new Logger(ReportPdfService.name);

  constructor(private readonly renderer: PdfRendererService) {}

  /**
   * Generate a PDF buffer for the given report data.
   */
  async generatePdf(report: ReportResult<any>): Promise<Buffer> {
    const columns = report.columns;
    const dataKeys = findReport(report.type)?.pdf.keys ?? [];

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
          text: isNumeric ? formatMoneyAR(value) : value,
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
        const style = { symbol: false, bold: true, fontSize: 9, fillColor: '#E2EFDA' };
        return value ? moneyCell(value, style) : { ...moneyCell(0, style), text: '' };
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
          text: `Generado: ${formatDateAR(todayInAR())}`,
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
      footer: pageFooter(report.title, { fontSize: 7, color: '#999999' }),
      styles: {
        header: { fontSize: 16, bold: true },
      },
      defaultStyle: {
        fontSize: 9,
      },
    };

    try {
      return await this.renderer.render(docDefinition);
    } catch (error) {
      this.logger.error('Report PDF generation failed', {
        reportType: report.type,
        error: (error as Error).message,
      });
      throw error;
    }
  }
}
