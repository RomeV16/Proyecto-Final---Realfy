import {
  BadGatewayException,
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { IndexDataService } from './index-data.service';
import { IndexScraperService } from './index-scraper.service';
import { Roles } from '../../common/auth/roles.decorator';
import { ADMIN_ONLY, MANAGEMENT_ROLES } from '../../common/auth/role-groups';
import { parseOrThrow } from '../../common/validation/zod';
import { BackfillIndexDataSchema } from '@realfy/shared';

@Controller('index-data')
export class IndexDataController {
  constructor(
    private readonly indexDataService: IndexDataService,
    private readonly indexScraperService: IndexScraperService,
  ) {}

  /**
   * GET /index-data — List with filters + pagination.
   * Any authenticated user can read.
   */
  @Get()
  async findAll(@Query() query: Record<string, any>) {
    const coerced = { ...query };
    const numericFields = ['page', 'limit'];
    for (const field of numericFields) {
      if (coerced[field] !== undefined) {
        coerced[field] = Number(coerced[field]);
      }
    }
    return this.indexDataService.findAll(coerced);
  }

  /**
   * POST /index-data — Create or upsert a single index data point.
   * Admin only.
   */
  @Roles(...ADMIN_ONLY)
  @Post()
  async create(@Body() body: Record<string, any>) {
    return this.indexDataService.create(body);
  }

  /**
   * POST /index-data/bulk — Batch import index data points.
   * Admin only.
   */
  @Roles(...ADMIN_ONLY)
  @Post('bulk')
  async createBulk(@Body() body: any) {
    return this.indexDataService.createBulk(body);
  }

  /**
   * DELETE /index-data/:id — Delete an index data point.
   * Admin only.
   */
  @Roles(...ADMIN_ONLY)
  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.indexDataService.delete(id);
  }

  /**
   * GET /index-data/latest — Returns the most-recent value per IndexType.
   * Admin and Gerente.
   */
  @Roles(...MANAGEMENT_ROLES)
  @Get('latest')
  async getLatest() {
    return this.indexDataService.findLatest();
  }

  /**
   * GET /index-data/estimates-replaced?since= — Estimados que ya tienen valor
   * oficial y los contratos con ajustes provisionales a corregir.
   * Admin and Gerente.
   */
  @Roles(...MANAGEMENT_ROLES)
  @Get('estimates-replaced')
  async getEstimatesReplaced(@Query('since') since?: string) {
    return this.indexDataService.findEstimatesReplaced(since);
  }

  /**
   * POST /index-data/refresh — Triggers an on-demand scrape of all index sources.
   * Admin only.  Returns per-source upserted row counts.
   */
  @Roles(...ADMIN_ONLY)
  @Post('refresh')
  async refresh() {
    const counts = await this.indexScraperService.upsertAll();
    return { counts, total: counts.icl + counts.uva + counts.ipc };
  }

  /**
   * POST /index-data/backfill — Carga el histórico de ICL o UVA de la serie de
   * sistema para un rango de fechas (`{ indexType, from, to }`, YYYY-MM-DD,
   * inclusive, hasta diez años). Idempotente: solo agrega los días que faltan.
   * Admin only. Un fallo del BCRA responde 502 (lo ya insertado queda).
   */
  @Roles(...ADMIN_ONLY)
  @Post('backfill')
  async backfill(@Body() body: unknown) {
    const { indexType, from, to } = parseOrThrow(BackfillIndexDataSchema, body, 'Invalid backfill parameters');
    try {
      return await this.indexScraperService.backfillLevelSeries(indexType as 'ICL' | 'UVA', from, to);
    } catch (err: unknown) {
      throw new BadGatewayException({
        error: 'INDEX_SOURCE_UNAVAILABLE',
        message: `The BCRA request failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
}
