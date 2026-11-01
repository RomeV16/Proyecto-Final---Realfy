/** Primer día del mes de una fecha, a medianoche UTC. */
export function monthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/**
 * La regla vigente a una fecha: la de `validFrom` más reciente que ya empezó y
 * no terminó (`validTo` vacío o no anterior a la fecha). Null si ninguna rige.
 */
export function pickRuleAt<T extends { validFrom: Date; validTo: Date | null }>(
  rules: T[],
  date: Date,
): T | null {
  let best: T | null = null;
  for (const rule of rules) {
    if (rule.validFrom.getTime() > date.getTime()) continue;
    if (rule.validTo && rule.validTo.getTime() < date.getTime()) continue;
    if (!best || rule.validFrom.getTime() > best.validFrom.getTime()) best = rule;
  }
  return best;
}
