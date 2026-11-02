import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { DATA_QUALITY_CHECK_IDS, type DataQualityCheckId } from '@realfy/shared';
import { Roles } from '../../common/auth/roles.decorator';
import { ADMIN_ONLY, MANAGEMENT_ROLES } from '../../common/auth/role-groups';
import { AuditOperation } from '../../common/audit/audit-operation.decorator';
import { DataQualityService } from './data-quality.service';
import { PersonMergeService } from './person-merge.service';

/**
 * Panel de calidad de datos: hallazgos que la oficina corrige después de una
 * migración o de una carga manual. Expone datos personales agregados, así que
 * lo leen sólo Admin y Gerente; unir personas lo hace sólo Admin.
 */
@Controller('data-quality')
export class DataQualityController {
  constructor(
    private readonly quality: DataQualityService,
    private readonly merges: PersonMergeService,
  ) {}

  /** GET /data-quality — cantidad de hallazgos por control. */
  @Roles(...MANAGEMENT_ROLES)
  @Get()
  summary() {
    return this.quality.summary();
  }

  /** POST /data-quality/persons/merge/preview — qué se movería al unir, sin cambiar nada. */
  @Roles(...MANAGEMENT_ROLES)
  @Post('persons/merge/preview')
  previewMerge(@Body() body: unknown) {
    return this.merges.preview(body);
  }

  /** POST /data-quality/persons/merge — une personas repetidas en una. */
  @Roles(...ADMIN_ONLY)
  @AuditOperation('persons.merge')
  @Post('persons/merge')
  merge(@Body() body: unknown) {
    return this.merges.merge(body);
  }

  /** GET /data-quality/:check?page=&limit= — hallazgos de un control. */
  @Roles(...MANAGEMENT_ROLES)
  @Get(':check')
  findings(@Param('check') check: string, @Query() query: Record<string, string>) {
    if (!DATA_QUALITY_CHECK_IDS.includes(check as DataQualityCheckId)) {
      throw new BadRequestException({ error: 'UNKNOWN_CHECK', message: `Unknown check: ${check}` });
    }
    return this.quality.findings(check as DataQualityCheckId, query);
  }
}
