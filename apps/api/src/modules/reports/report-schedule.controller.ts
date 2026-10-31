import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { Roles } from '../../common/auth/roles.decorator';
import { CreateReportScheduleSchema, UpdateReportScheduleSchema } from '@realfy/shared';
import { computeNextRunAt } from './compute-next-run-at';
import { MANAGEMENT_ROLES } from '../../common/auth/role-groups';

@Controller('report-schedules')
export class ReportScheduleController {
  private readonly logger = new Logger(ReportScheduleController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * GET /report-schedules — list all schedules for the current tenant.
   */
  @Roles(...MANAGEMENT_ROLES)
  @Get()
  async findAll() {
    const tenantId = this.tenantContext.getTenantId()!;
    return this.prisma.client.reportSchedule.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * POST /report-schedules — create a new schedule.
   */
  @Roles(...MANAGEMENT_ROLES)
  @Post()
  async create(@Body() body: unknown) {
    let data: any;
    try {
      data = CreateReportScheduleSchema.parse(body);
    } catch (err: any) {
      throw new BadRequestException({
        error: 'VALIDATION_ERROR',
        message: 'Invalid report schedule payload',
        details: err.errors ?? err.message,
      });
    }

    const tenantId = this.tenantContext.getTenantId()!;
    const nextRunAt = computeNextRunAt(data.frequency);

    const schedule = await this.prisma.client.reportSchedule.create({
      data: {
        tenantId,
        reportType: data.reportType,
        frequency: data.frequency,
        recipients: data.recipients,
        filters: data.filters ?? {},
        format: data.format,
        nextRunAt,
      },
    });

    this.logger.log('Report schedule created', {
      tenantId,
      scheduleId: schedule.id,
      reportType: schedule.reportType,
      frequency: schedule.frequency,
    });

    return schedule;
  }

  /**
   * PATCH /report-schedules/:id — update a schedule.
   */
  @Roles(...MANAGEMENT_ROLES)
  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown) {
    let data: any;
    try {
      data = UpdateReportScheduleSchema.parse(body);
    } catch (err: any) {
      throw new BadRequestException({
        error: 'VALIDATION_ERROR',
        message: 'Invalid report schedule update',
        details: err.errors ?? err.message,
      });
    }

    const tenantId = this.tenantContext.getTenantId()!;

    // Verify ownership
    const existing = await this.prisma.client.reportSchedule.findFirst({
      where: { id, tenantId },
    });
    if (!existing) {
      throw new NotFoundException('Report schedule not found');
    }

    const updateData: any = { ...data };

    // Recompute nextRunAt if frequency changed
    if (data.frequency && data.frequency !== existing.frequency) {
      updateData.nextRunAt = computeNextRunAt(data.frequency);
    }

    const schedule = await this.prisma.client.reportSchedule.update({
      where: { id },
      data: updateData,
    });

    this.logger.log('Report schedule updated', {
      tenantId,
      scheduleId: id,
    });

    return schedule;
  }

  /**
   * DELETE /report-schedules/:id — hard delete a schedule.
   */
  @Roles(...MANAGEMENT_ROLES)
  @Delete(':id')
  async remove(@Param('id') id: string) {
    const tenantId = this.tenantContext.getTenantId()!;

    const existing = await this.prisma.client.reportSchedule.findFirst({
      where: { id, tenantId },
    });
    if (!existing) {
      throw new NotFoundException('Report schedule not found');
    }

    await this.prisma.client.reportSchedule.delete({ where: { id } });

    this.logger.log('Report schedule deleted', {
      tenantId,
      scheduleId: id,
    });

    return { deleted: true };
  }
}
