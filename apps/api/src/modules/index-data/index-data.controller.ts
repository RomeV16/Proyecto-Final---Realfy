import {
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
import { UserRole } from '@realfy/shared';

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
  @Roles(UserRole.Admin)
  @Post()
  async create(@Body() body: Record<string, any>) {
    return this.indexDataService.create(body);
  }

  /**
   * POST /index-data/bulk — Batch import index data points.
   * Admin only.
   */
  @Roles(UserRole.Admin)
  @Post('bulk')
  async createBulk(@Body() body: any) {
    return this.indexDataService.createBulk(body);
  }

  /**
   * DELETE /index-data/:id — Delete an index data point.
   * Admin only.
   */
  @Roles(UserRole.Admin)
  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.indexDataService.delete(id);
  }

  /**
   * GET /index-data/latest — Returns the most-recent value per IndexType.
   * Admin and Gerente.
   */
  @Roles(UserRole.Admin, UserRole.Gerente)
  @Get('latest')
  async getLatest() {
    return this.indexDataService.findLatest();
  }

  /**
   * POST /index-data/refresh — Triggers an on-demand scrape of all index sources.
   * Admin only.  Returns per-source upserted row counts.
   */
  @Roles(UserRole.Admin)
  @Post('refresh')
  async refresh() {
    const counts = await this.indexScraperService.upsertAll();
    return { counts, total: counts.icl + counts.uva + counts.ipc };
  }
}
