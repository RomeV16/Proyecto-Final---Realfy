import { formatMoneyAR, formatPeriodAR, formatPeriodShortAR, type MoneyLike } from '@realfy/shared';
import type { MessageVars } from '../../common/messaging/message-templates';

/**
 * Variables del mail de una liquidación (plantilla `liquidacion`). El mes sale
 * del período en UTC: el 1 de marzo a medianoche UTC es marzo aunque el
 * proceso corra en hora de Buenos Aires (CP-131, DEF-11).
 */
export function liquidacionMessageVars(
  liquidacion: { period: Date | string; total: MoneyLike },
  agency: string,
): MessageVars {
  return {
    period: formatPeriodAR(liquidacion.period),
    periodShort: formatPeriodShortAR(liquidacion.period),
    total: formatMoneyAR(liquidacion.total),
    agency,
  };
}
