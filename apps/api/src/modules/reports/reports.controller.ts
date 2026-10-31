import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { ReportsService } from './reports.service';
import { ReportExcelService } from './report-excel.service';
import { ReportPdfService } from './report-pdf.service';
import { Roles } from '../../common/auth/roles.decorator';
import { BILLING_ROLES } from '../../common/auth/role-groups';
import { ReadResource } from '../../common/read-policy/read-resource.decorator';

import { REPORT_KEYS, findReport } from './report-registry';

/** Nombre del archivo descargado: prefijo del reporte y fecha del día. */
function reportFileName(type: string, ext: string): string {
  return `${findReport(type)?.fileName ?? 'reporte'}-${new Date().toISOString().slice(0, 10)}.${ext}`;
}

@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly excelService: ReportExcelService,
    private readonly pdfService: ReportPdfService,
  ) {}

  /**
   * GET /reports/:type/excel — Download Excel (.xlsx) for a report type.
   */
  @Roles(...BILLING_ROLES)
  @ReadResource('reports.financial')
  @Get(':type/excel')
  async getExcel(
    @Param('type') type: string,
    @Query() query: Record<string, any>,
    @Res() res: Response,
  ) {
    const report = await this.getReportData(type, query);
    const buffer = await this.excelService.generateExcel(report);
    const filename = reportFileName(type, 'xlsx');

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  /**
   * GET /reports/:type/pdf — Download PDF for a report type.
   */
  @Roles(...BILLING_ROLES)
  @ReadResource('reports.financial')
  @Get(':type/pdf')
  async getPdf(
    @Param('type') type: string,
    @Query() query: Record<string, any>,
    @Res() res: Response,
  ) {
    const report = await this.getReportData(type, query);
    const buffer = await this.pdfService.generatePdf(report);
    const filename = reportFileName(type, 'pdf');

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  /**
   * GET /reports/:type — JSON data for a report type.
   * Filters passed as query params: from, to, ownerId, propertyId, contractId, pipelineId.
   */
  @Roles(...BILLING_ROLES)
  @ReadResource('reports.financial')
  @Get(':type')
  async getReport(
    @Param('type') type: string,
    @Query() query: Record<string, any>,
  ) {
    return this.getReportData(type, query);
  }

  // ─── Private ──────────────────────────────────────────

  private async getReportData(type: string, query: Record<string, any>) {
    const definition = findReport(type);
    if (!definition) {
      throw new BadRequestException({
        error: 'INVALID_REPORT_TYPE',
        message: `Invalid report type: ${type}. Valid types: ${REPORT_KEYS.join(', ')}`,
      });
    }

    return this.reportsService[definition.method](query);
  }
}
