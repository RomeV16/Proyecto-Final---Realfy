import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AR_TIME_ZONE } from '@realfy/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ReportsService } from './reports.service';
import { ReportExcelService } from './report-excel.service';
import { ReportPdfService } from './report-pdf.service';
import { CommonEmailService } from '../../common/email/common-email.service';
import { CronBaseService } from '../../common/scheduler/cron.service';
import { TenantCron } from '../../common/scheduler/tenant-cron';
import { computeNextRunAt } from './compute-next-run-at';
import { findReport } from './report-registry';

/** File extensions and MIME types for report formats */
const FORMAT_META: Record<string, { ext: string; mime: string }> = {
  excel: { ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  pdf: { ext: 'pdf', mime: 'application/pdf' },
};

@Injectable()
export class ReportSchedulerService extends CronBaseService {
  protected readonly logger = new Logger(ReportSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reportsService: ReportsService,
    private readonly excelService: ReportExcelService,
    private readonly pdfService: ReportPdfService,
    private readonly emailService: CommonEmailService,
    private readonly tenantCron: TenantCron,
  ) {
    super();
  }

  /**
   * Daily at 09:00 Argentina time.
   * Finds all active schedules whose nextRunAt ≤ now, generates the report
   * in the requested format, and emails it to all recipients as an attachment.
   */
  @Cron('0 9 * * *', { name: 'scheduled-reports', timeZone: AR_TIME_ZONE })
  async handleScheduledReports(): Promise<void> {
    await this.runGuarded(() => this.sendDueReports(), 'scheduled-reports');
  }

  private async sendDueReports(): Promise<void> {
    const start = Date.now();
    this.logger.log('Cron job started: scheduled-reports');

    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    await this.tenantCron.forEachActiveTenant('scheduled-reports', async (tenantId, tenant) => {
      // El cliente con extensión filtra por la inmobiliaria del contexto.
      const dueSchedules = await this.prisma.client.reportSchedule.findMany({
        where: {
          isActive: true,
          nextRunAt: { lte: new Date() },
        },
      });

      this.logger.log(`Found ${dueSchedules.length} due report schedule(s) for tenantId=${tenantId}`);

      for (const schedule of dueSchedules) {
        const scheduleStart = Date.now();
        processed++;

        try {
          // Generate report data
          const definition = findReport(schedule.reportType);
          if (!definition) {
            this.logger.warn(`Unknown report type: ${schedule.reportType}`, {
              scheduleId: schedule.id,
            });
            continue;
          }

          const reportData = await this.reportsService[definition.method](
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
          const filename = `${definition.fileName}-${dateStr}.${meta.ext}`;

          // Email to each recipient
          const htmlBody = `
            <h2>Reporte Programado: ${reportData.title}</h2>
            <p>Se adjunta el reporte <strong>${reportData.title}</strong> generado el ${dateStr}.</p>
            <p>Organización: ${tenant.name ?? 'N/A'}</p>
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
          await this.prisma.client.reportSchedule.update({
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
        } catch (err) {
          failed++;
          this.logger.error(
            `Report schedule failed: ${schedule.id}`,
            {
              scheduleId: schedule.id,
              reportType: schedule.reportType,
              tenantId,
              error: (err as Error).message,
              stack: (err as Error).stack,
            },
          );
        }
      }
    });

    this.logger.log(
      `Cron job completed: scheduled-reports in ${Date.now() - start}ms — processed=${processed}, succeeded=${succeeded}, failed=${failed}`,
    );
  }
}
