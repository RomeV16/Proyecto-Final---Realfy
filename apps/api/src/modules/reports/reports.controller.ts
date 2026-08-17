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
import { UserRole } from '@realfy/shared';

const VALID_TYPES = ['ownerStatement', 'propertyProfitability', 'cashFlow', 'commissionSummary', 'pipelineAnalytics', 'morosidad'] as const;
type ValidReportType = (typeof VALID_TYPES)[number];

const REPORT_FILE_NAMES: Record<ValidReportType, string> = {
  ownerStatement: 'estado-propietario',
  propertyProfitability: 'rentabilidad-propiedad',
  cashFlow: 'flujo-caja',
  commissionSummary: 'resumen-comisiones',
  pipelineAnalytics: 'analitica-pipeline',
  morosidad: 'morosidad',
};

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
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Liquidaciones)
  @Get(':type/excel')
  async getExcel(
    @Param('type') type: string,
    @Query() query: Record<string, any>,
    @Res() res: Response,
  ) {
    const report = await this.getReportData(type, query);
    const buffer = await this.excelService.generateExcel(report);
    const filename = `${REPORT_FILE_NAMES[type as ValidReportType] ?? 'reporte'}-${new Date().toISOString().slice(0, 10)}.xlsx`;

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
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Liquidaciones)
  @Get(':type/pdf')
  async getPdf(
    @Param('type') type: string,
    @Query() query: Record<string, any>,
    @Res() res: Response,
  ) {
    const report = await this.getReportData(type, query);
    const buffer = await this.pdfService.generatePdf(report);
    const filename = `${REPORT_FILE_NAMES[type as ValidReportType] ?? 'reporte'}-${new Date().toISOString().slice(0, 10)}.pdf`;

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
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Liquidaciones)
  @Get(':type')
  async getReport(
    @Param('type') type: string,
    @Query() query: Record<string, any>,
  ) {
    return this.getReportData(type, query);
  }

  // ─── Private ──────────────────────────────────────────

  private async getReportData(type: string, query: Record<string, any>) {
    if (!VALID_TYPES.includes(type as ValidReportType)) {
      throw new BadRequestException({
        error: 'INVALID_REPORT_TYPE',
        message: `Invalid report type: ${type}. Valid types: ${VALID_TYPES.join(', ')}`,
      });
    }

    switch (type as ValidReportType) {
      case 'ownerStatement':
        return this.reportsService.getOwnerStatement(query);
      case 'propertyProfitability':
        return this.reportsService.getPropertyProfitability(query);
      case 'cashFlow':
        return this.reportsService.getCashFlow(query);
      case 'commissionSummary':
        return this.reportsService.getCommissionSummary(query);
      case 'pipelineAnalytics':
        return this.reportsService.getPipelineAnalytics(query);
      case 'morosidad':
        return this.reportsService.getMorosidad(query);
    }
  }
}
