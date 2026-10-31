import { Injectable, Logger } from '@nestjs/common';
import { buildXlsx } from '../../common/export/tabular';
import { findReport } from './report-registry';
import type { ReportResult } from './reports.service';

@Injectable()
export class ReportExcelService {
  private readonly logger = new Logger(ReportExcelService.name);

  /**
   * Generate an Excel workbook buffer for the given report data.
   */
  async generateExcel(report: ReportResult<any>): Promise<Buffer> {
    const definition = findReport(report.type);
    if (!definition) {
      throw new Error(`Unknown report type for Excel export: ${report.type}`);
    }
    const columns = definition.excel;
    const summary = report.summary;

    const total = summary
      ? {
          values: {
            [columns[0].key]: 'TOTAL',
            ...Object.fromEntries(
              columns
                .filter((col) => col.numeric && summary[col.key] !== undefined)
                .map((col) => [col.key, parseFloat(summary[col.key]) || 0]),
            ),
          },
          formatNumeric: true,
        }
      : undefined;

    const buffer = await buildXlsx([
      { name: report.title, columns, rows: report.rows, coerceNumeric: true, total },
    ]);

    this.logger.log('Excel report generated', {
      reportType: report.type,
      rowCount: report.rows.length,
      bufferSize: buffer.byteLength,
    });

    return buffer;
  }
}
