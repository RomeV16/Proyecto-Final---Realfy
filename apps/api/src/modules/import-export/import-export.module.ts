import { Module } from '@nestjs/common';
import { ImportExportController } from './import-export.controller';
import { ImportExportService } from './import-export.service';
import { ExportService } from './export.service';
import { CsvParserService } from './csv-parser.service';
import { ImportBatchController } from './batch/import-batch.controller';
import { ImportBatchService } from './batch/import-batch.service';
import { TenantsModule } from '../tenants/tenants.module';

@Module({
  imports: [TenantsModule],
  controllers: [ImportExportController, ImportBatchController],
  providers: [ImportExportService, ExportService, CsvParserService, ImportBatchService],
  exports: [ImportExportService, ExportService],
})
export class ImportExportModule {}
