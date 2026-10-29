import { LiquidacionStatus } from '@realfy/shared';

/**
 * Estados de una liquidación impaga cuyo vencimiento ya pasó: `Enviada` con la
 * fecha vencida, o `Vencida` cuando alguien la marcó así. Los dos cuentan para
 * la morosidad y acumulan punitorio, igual que en el panel y en los reportes.
 */
export const OVERDUE_LIQUIDACION_STATUSES = [LiquidacionStatus.Enviada, LiquidacionStatus.Vencida];
