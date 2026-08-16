import {
  Controller,
  Post,
  Get,
  Body,
  Res,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ImportExportService } from './import-export.service';
import { ExportService } from './export.service';
import { Roles } from '../../common/auth/roles.decorator';
import { UserRole, ImportValidateRequestSchema, ImportExecuteRequestSchema } from '@realfy/shared';

@Controller()
export class ImportExportController {
  constructor(
    private readonly importService: ImportExportService,
    private readonly exportService: ExportService,
  ) {}

  // ─── Import Endpoints ───────────────────────────────

  /**
   * POST /import/upload — Upload a CSV file, parse headers and sample rows.
   * Returns fileId for subsequent validate/execute calls.
   */
  @Roles(UserRole.Admin, UserRole.Gerente)
  @Post('import/upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException({
        error: 'NO_FILE',
        message: 'No file was uploaded',
      });
    }

    if (!file.originalname.toLowerCase().endsWith('.csv')) {
      throw new BadRequestException({
        error: 'INVALID_FILE_TYPE',
        message: 'Only CSV files are supported',
      });
    }

    return this.importService.upload(file.buffer, file.originalname);
  }

  /**
   * POST /import/validate — Validate CSV data against entity schema.
   * Returns per-row errors and preview of valid rows.
   */
  @Roles(UserRole.Admin, UserRole.Gerente)
  @Post('import/validate')
  async validate(@Body() body: any) {
    const parsed = ImportValidateRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: 'VALIDATION_ERROR',
        message: 'Invalid validate request',
        details: parsed.error.issues,
      });
    }

    return this.importService.validate(
      parsed.data.fileId,
      parsed.data.entityType as 'property' | 'person',
      parsed.data.columnMappings,
    );
  }

  /**
   * POST /import/execute — Execute the import, creating entities.
   * Skips invalid rows and returns error details.
   */
  @Roles(UserRole.Admin, UserRole.Gerente)
  @Post('import/execute')
  async execute(@Body() body: any) {
    const parsed = ImportExecuteRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: 'VALIDATION_ERROR',
        message: 'Invalid execute request',
        details: parsed.error.issues,
      });
    }

    return this.importService.execute(
      parsed.data.fileId,
      parsed.data.entityType as 'property' | 'person',
      parsed.data.columnMappings,
    );
  }

  // ─── Properties Export ──────────────────────────────

  /**
   * GET /properties/export/csv — Download all properties as CSV.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Ventas)
  @Get('properties/export/csv')
  async exportPropertiesCsv(@Res() res: Response) {
    const { buffer, fileName } = await this.exportService.exportPropertiesCsv();
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  /**
   * GET /properties/export/excel — Download all properties as Excel.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Ventas)
  @Get('properties/export/excel')
  async exportPropertiesExcel(@Res() res: Response) {
    const { buffer, fileName } = await this.exportService.exportPropertiesExcel();
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  // ─── Persons Export ─────────────────────────────────

  /**
   * GET /persons/export/csv — Download all persons as CSV.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Ventas)
  @Get('persons/export/csv')
  async exportPersonsCsv(@Res() res: Response) {
    const { buffer, fileName } = await this.exportService.exportPersonsCsv();
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  /**
   * GET /persons/export/excel — Download all persons as Excel.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Ventas)
  @Get('persons/export/excel')
  async exportPersonsExcel(@Res() res: Response) {
    const { buffer, fileName } = await this.exportService.exportPersonsExcel();
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }
}
