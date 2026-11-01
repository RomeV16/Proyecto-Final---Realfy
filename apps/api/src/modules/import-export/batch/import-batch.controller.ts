import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../../../common/auth/roles.decorator';
import { ADMIN_ONLY } from '../../../common/auth/role-groups';
import { ImportBatchService } from './import-batch.service';

/** Importación por lotes desde el sistema anterior (JSON, la llaman scripts de migración). Sólo Admin. */
@Controller('import/batches')
export class ImportBatchController {
  constructor(private readonly batches: ImportBatchService) {}

  /** POST /import/batches — valida (`dryRun`) o ejecuta un lote de personas, propiedades y contratos. */
  @Roles(...ADMIN_ONLY)
  @Post()
  run(@Body() body: unknown) {
    return this.batches.run(body);
  }

  @Roles(...ADMIN_ONLY)
  @Get()
  list(@Query('limit') limit?: string) {
    return this.batches.list(limit ? Number(limit) : undefined);
  }

  @Roles(...ADMIN_ONLY)
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.batches.findOne(id);
  }

  /** GET /import/batches/:id/rows?action=Error&entity=Contrato&limit=&offset= */
  @Roles(...ADMIN_ONLY)
  @Get(':id/rows')
  rows(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: Record<string, string>,
  ) {
    const { limit, offset, ...filters } = query;
    return this.batches.rows(id, filters, {
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  /** GET /import/batches/:id/rows/csv?action=Error — las filas (o sus errores) para descargar. */
  @Roles(...ADMIN_ONLY)
  @Get(':id/rows/csv')
  async rowsCsv(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: Record<string, string>,
    @Res() res: Response,
  ) {
    const { buffer, fileName } = await this.batches.rowsCsv(id, query);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }
}
