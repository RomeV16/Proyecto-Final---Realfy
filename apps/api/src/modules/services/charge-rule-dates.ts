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

const DAY_MS = 24 * 60 * 60 * 1000;

/** Medianoche UTC de una fecha `YYYY-MM-DD` (o el instante ISO tal cual). */
export const dayStart = (value: string): Date =>
  new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value);

/** La fecha sin la hora, a medianoche UTC. */
export const dayOnly = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

/** Un servicio aplica a un contrato si es de su propiedad o del edificio que la contiene. */
export function serviceAppliesToContract(
  service: { propertyId: string },
  contract: { propertyId: string; property?: { parentPropertyId: string | null } | null },
): boolean {
  return service.propertyId === contract.propertyId || contract.property?.parentPropertyId === service.propertyId;
}

export interface RuleVersionInput {
  tenantId: string;
  contractId: string;
  serviceId: string;
  validFrom: Date;
  validTo: Date | null;
  /** Campos de la regla (quién paga, reparto, plan, acuerdo, notas...). */
  fields: Record<string, unknown>;
}

/**
 * Crea una versión de la regla de un servicio en un contrato sin pisar las
 * demás: termina donde empieza la siguiente (si hay) y cierra la anterior el
 * día previo. Devuelve el id de la regla, o `null` si ya había una con esa
 * fecha de inicio (quien llama decide si es un conflicto o una corrección).
 */
export async function insertRuleVersion(tx: any, input: RuleVersionInput): Promise<string | null> {
  const { contractId, serviceId, validFrom } = input;
  const siblings = await tx.contractChargeRule.findMany({
    where: { contractId, serviceId },
    orderBy: { validFrom: 'asc' },
  });
  if (siblings.some((r: any) => r.validFrom.getTime() === validFrom.getTime())) return null;
  const previous = [...siblings].reverse().find((r: any) => r.validFrom.getTime() < validFrom.getTime());
  const next = siblings.find((r: any) => r.validFrom.getTime() > validFrom.getTime());

  // La regla nueva termina donde empieza la siguiente (si hay) y cierra a la anterior.
  const dayBeforeNext = next ? new Date(next.validFrom.getTime() - DAY_MS) : null;
  let validTo = input.validTo;
  if (dayBeforeNext && (!validTo || validTo.getTime() > dayBeforeNext.getTime())) validTo = dayBeforeNext;

  const dayBefore = new Date(validFrom.getTime() - DAY_MS);
  if (previous && (!previous.validTo || previous.validTo.getTime() > dayBefore.getTime())) {
    await tx.contractChargeRule.update({ where: { id: previous.id }, data: { validTo: dayBefore } });
  }

  const rule = await tx.contractChargeRule.create({
    data: {
      ...input.fields,
      tenantId: input.tenantId,
      contractId,
      serviceId,
      validFrom,
      validTo,
    },
  });
  return rule.id as string;
}
