import {
  Controller,
  Get,
  Param,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { ReportsService } from './reports.service';
import { Roles } from '../../common/auth/roles.decorator';
import { UserRole } from '@realfy/shared';

const VALID_TYPES = ['propertyProfitability', 'pipelineAnalytics', 'morosidad'] as const;
type ValidReportType = (typeof VALID_TYPES)[number];

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  /**
   * GET /reports/:type — JSON data for a report type.
   * Filters passed as query params: from, to, propertyId, contractId, pipelineId.
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
      case 'propertyProfitability':
        return this.reportsService.getPropertyProfitability(query);
      case 'pipelineAnalytics':
        return this.reportsService.getPipelineAnalytics(query);
      case 'morosidad':
        return this.reportsService.getMorosidad(query);
    }
  }
}
