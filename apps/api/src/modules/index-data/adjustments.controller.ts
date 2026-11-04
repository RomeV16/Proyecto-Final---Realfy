import { Body, Controller, ForbiddenException, Post } from '@nestjs/common';
import {
  ApplyAdjustmentBatchSchema,
  PreviewAdjustmentBatchSchema,
} from '@realfy/shared';
import type { ApplyAdjustmentBatchInput, PreviewAdjustmentBatchInput } from '@realfy/shared';
import { Roles } from '../../common/auth/roles.decorator';
import { ADMIN_ONLY, BILLING_ROLES } from '../../common/auth/role-groups';
import { ZodValidationPipe } from '../../common/validation/zod';
import { AdjustmentBatchService } from './adjustment-batch.service';
import { AdjustmentsScheduler } from './adjustments.scheduler';

@Controller('adjustments')
export class AdjustmentsController {
  constructor(
    private readonly batch: AdjustmentBatchService,
    private readonly scheduler: AdjustmentsScheduler,
  ) {}

  /**
   * POST /adjustments/preview-batch — Contratos con un ajuste que vence en el
   * mes (o venía atrasado): alquiler actual y nuevo, factor, meses de índice
   * usados, si es provisorio y qué datos faltan. No escribe nada.
   * Admin, Gerente y Liquidaciones.
   */
  @Roles(...BILLING_ROLES)
  @Post('preview-batch')
  async previewBatch(
    @Body(new ZodValidationPipe(PreviewAdjustmentBatchSchema, 'Invalid adjustment preview'))
    dto: PreviewAdjustmentBatchInput,
  ) {
    return this.batch.preview(dto.period);
  }

  /**
   * POST /adjustments/apply-batch — Aplica los ajustes elegidos del mes. Cada
   * contrato va en su transacción; la respuesta informa por contrato si se
   * aplicó o por qué se salteó. Un ajuste que baja el alquiler sólo se aplica si
   * su contrato figura en `confirmRentDecrease`; si no, se saltea con
   * `RENT_DECREASE_REQUIRES_REVIEW`. Admin, Gerente y Liquidaciones.
   */
  @Roles(...BILLING_ROLES)
  @Post('apply-batch')
  async applyBatch(
    @Body(new ZodValidationPipe(ApplyAdjustmentBatchSchema, 'Invalid adjustment batch'))
    dto: ApplyAdjustmentBatchInput,
  ) {
    return this.batch.apply(dto.period, dto.contractIds, dto.confirmRentDecrease ?? []);
  }

  /**
   * POST /adjustments/_run-now — Dispara de inmediato lo que corre el cron
   * diario (aplicar vencidos y corregir provisorios) en todas las inmobiliarias.
   * Solo Admin, y solo con NODE_ENV=test o E2E_TEST_MODE=1.
   */
  @Roles(...ADMIN_ONLY)
  @Post('_run-now')
  async runNow() {
    const isTestMode = process.env.NODE_ENV === 'test' || process.env.E2E_TEST_MODE === '1';
    if (!isTestMode) {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'This endpoint is only available in test mode',
      });
    }
    return this.scheduler.run();
  }
}
