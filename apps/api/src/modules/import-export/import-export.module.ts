import { Module } from '@nestjs/common';
import { ImportExportController } from './import-export.controller';
import { ImportExportService } from './import-export.service';
import { ExportService } from './export.service';
import { CsvParserService } from './csv-parser.service';

@Module({
  controllers: [ImportExportController],
  providers: [ImportExportService, ExportService, CsvParserService],
  exports: [ImportExportService, ExportService],
})
export class ImportExportModule {}
