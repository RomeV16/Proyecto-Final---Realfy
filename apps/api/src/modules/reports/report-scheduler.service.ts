import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ReportsService } from './reports.service';
import { ReportExcelService } from './report-excel.service';
import { ReportPdfService } from './report-pdf.service';
import { CommonEmailService } from '../../common/email/common-email.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';

/** File extensions and MIME types for report formats */
const FORMAT_META: Record<string, { ext: string; mime: string }> = {
  excel: { ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  pdf: { ext: 'pdf', mime: 'application/pdf' },
};

/** Report type → service method name mapping */
const REPORT_METHODS: Record<string, string> = {
  ownerStatement: 'getOwnerStatement',
  propertyProfitability: 'getPropertyProfitability',
  cashFlow: 'getCashFlow',
  commissionSummary: 'getCommissionSummary',
  pipelineAnalytics: 'getPipelineAnalytics',
  morosidad: 'getMorosidad',
};

/** Report type → human-readable filename prefix */
const FILE_NAMES: Record<string, string> = {
  ownerStatement: 'estado-propietario',
  propertyProfitability: 'rentabilidad-propiedad',
  cashFlow: 'flujo-caja',
  commissionSummary: 'resumen-comisiones',
  pipelineAnalytics: 'analitica-pipeline',
  morosidad: 'morosidad',
};

/**
 * Compute the next run timestamp based on frequency.
 * daily  → tomorrow 12:00 UTC
 * weekly → next Monday 12:00 UTC
 * monthly → 1st of next month 12:00 UTC
 */
function computeNextRunAt(frequency: string): Date {
  const now = new Date();
  switch (frequency) {
    case 'daily':
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 12));
    case 'weekly': {
      const dayOfWeek = now.getUTCDay();
      const daysUntilMon = dayOfWeek === 0 ? 1 : dayOfWeek === 1 ? 7 : 8 - dayOfWeek;
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilMon, 12));
    }
    case 'monthly':
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 12));
    default:
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 12));
  }
}

@Injectable()
export class ReportSchedulerService {
  private readonly logger = new Logger(ReportSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reportsService: ReportsService,
    private readonly excelService: ReportExcelService,
    private readonly pdfService: ReportPdfService,
    private readonly emailService: CommonEmailService,
    private readonly tenantContext: TenantContextService,
    private readonly cls: ClsService,
  ) {}

  /**
   * Runs daily at 12:00 UTC (≈ 09:00 Argentina).
   * Finds all active schedules whose nextRunAt ≤ now, generates the report
   * in the requested format, and emails it to all recipients as an attachment.
   */
  @Cron('0 12 * * *', { name: 'scheduled-reports' })
  async handleScheduledReports() {
    const start = Date.now();
    this.logger.log('Cron job started: scheduled-reports');

    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    try {
      const dueSchedules = await this.prisma.baseClient.reportSchedule.findMany({
        where: {
          isActive: true,
          nextRunAt: { lte: new Date() },
        },
        include: { tenant: true },
      });

      this.logger.log(`Found ${dueSchedules.length} due report schedule(s)`);

      for (const schedule of dueSchedules) {
        const scheduleStart = Date.now();
        processed++;

        try {
          // Run inside CLS context so ReportsService can read tenantId
          await this.cls.run(async () => {
            this.tenantContext.setTenantId(schedule.tenantId);

            // Generate report data
            const methodName = REPORT_METHODS[schedule.reportType];
            if (!methodName) {
              this.logger.warn(`Unknown report type: ${schedule.reportType}`, {
                scheduleId: schedule.id,
              });
              return;
            }

            const reportData = await (this.reportsService as any)[methodName](
              schedule.filters ?? {},
            );

            // Generate file buffer
            const format = schedule.format || 'excel';
            const buffer =
              format === 'pdf'
                ? await this.pdfService.generatePdf(reportData)
                : await this.excelService.generateExcel(reportData);

            const meta = FORMAT_META[format] ?? FORMAT_META.excel;
            const dateStr = new Date().toISOString().slice(0, 10);
            const filename = `${FILE_NAMES[schedule.reportType] ?? 'reporte'}-${dateStr}.${meta.ext}`;

            // Email to each recipient
            const htmlBody = `
              <h2>Reporte Programado: ${reportData.title}</h2>
              <p>Se adjunta el reporte <strong>${reportData.title}</strong> generado el ${dateStr}.</p>
              <p>Organización: ${schedule.tenant?.name ?? 'N/A'}</p>
              <p>Frecuencia: ${schedule.frequency}</p>
              <p style="color:#888;font-size:12px;">Este email fue generado automáticamente por el sistema de reportes programados.</p>
            `;

            let emailsSent = 0;
            for (const recipient of schedule.recipients) {
              const result = await this.emailService.sendEmail({
                to: recipient,
                subject: `Reporte: ${reportData.title} — ${dateStr}`,
                html: htmlBody,
                attachments: [{ filename, content: buffer }],
              });
              if (result) emailsSent++;
            }

            // Update schedule timestamps
            await this.prisma.baseClient.reportSchedule.update({
              where: { id: schedule.id },
              data: {
                lastRunAt: new Date(),
                nextRunAt: computeNextRunAt(schedule.frequency),
              },
            });

            succeeded++;
            this.logger.log('Report schedule processed', {
              scheduleId: schedule.id,
              reportType: schedule.reportType,
              format,
              recipientCount: schedule.recipients.length,
              emailsSent,
              durationMs: Date.now() - scheduleStart,
            });
          });
        } catch (err) {
          failed++;
          this.logger.error(
            `Report schedule failed: ${schedule.id}`,
            {
              scheduleId: schedule.id,
              reportType: schedule.reportType,
              tenantId: schedule.tenantId,
              error: (err as Error).message,
              stack: (err as Error).stack,
            },
          );
        }
      }
    } catch (err) {
      this.logger.error('Scheduled reports cron failed globally', {
        error: (err as Error).message,
        stack: (err as Error).stack,
      });
    }

    this.logger.log(
      `Cron job completed: scheduled-reports in ${Date.now() - start}ms — processed=${processed}, succeeded=${succeeded}, failed=${failed}`,
    );
  }
}
