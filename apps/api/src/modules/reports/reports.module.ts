import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportScheduleController } from './report-schedule.controller';
import { ReportsService } from './reports.service';
import { ReportExcelService } from './report-excel.service';
import { ReportPdfService } from './report-pdf.service';
import { ReportSchedulerService } from './report-scheduler.service';

@Module({
  controllers: [ReportsController, ReportScheduleController],
  providers: [ReportsService, ReportExcelService, ReportPdfService, ReportSchedulerService],
  exports: [ReportsService],
})
export class ReportsModule {}
