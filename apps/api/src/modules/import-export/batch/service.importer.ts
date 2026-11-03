import { ChargeSplitMode, ImportChargeRuleSchema, ImportEntity, ImportServiceSchema } from '@realfy/shared';
import type { ImportChargeRuleRow, ImportServiceRow } from '@realfy/shared';
import { resolveProviderFields } from '../../bills-intake/providers/provider-account';
import {
  dayOnly,
  dayStart,
  insertRuleVersion,
  serviceAppliesToContract,
} from '../../services/charge-rule-dates';
import {
  changedKeys,
  dec,
  Db,
  EntityImporter,
  ImportContext,
  ImportRowError,
  rawExternalRef,
  resolveRef,
  RowOutcome,
} from './import-types';

// ─── Servicios e impuestos de una propiedad ─────────

type ServiceCurrent = { providerKey: string | null; accountNumber: string | null; serviceType: string };

/** Campos del servicio que informa la fila; los ausentes (`undefined`) no se tocan al actualizar. */
export function serviceFields(row: ImportServiceRow) {
  return {
    serviceType: row.serviceType,
    providerName: row.providerName,
    accountNumber: row.accountNumber,
    providerKey: row.providerKey,
    amount: dec(row.amount),
    currency: row.currency,
    dueDay: row.dueDay,
    billingFrequency: row.billingFrequency,
    hasAnnualOption: row.hasAnnualOption,
    isActive: row.isActive,
    notes: row.notes,
  };
}

/** La cuenta normalizada según el proveedor del catálogo; clave desconocida o cuenta inválida son error de fila. */
function providerAccount(row: ImportServiceRow, existing: ServiceCurrent | null): { accountNumber?: string | null } {
  const result = resolveProviderFields(row, existing ?? undefined);
  if (!result.ok) throw new ImportRowError(result.code, result.message, result.field);
  return result.accountNumber === undefined ? {} : { accountNumber: result.accountNumber };
}

async function upsertService(db: Db, ctx: ImportContext, row: ImportServiceRow): Promise<RowOutcome> {
  const propertyId = await resolveRef(db, 'property', ctx, row.propertyRef, 'propertyRef');
  const existing = await db.service.findFirst({ where: { tenantId: ctx.tenantId, externalRef: row.externalRef } });
  const fields = { ...serviceFields(row), ...providerAccount(row, existing) };

  if (!existing) {
    const data = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    const created = await db.service.create({
      data: { ...data, tenantId: ctx.tenantId, externalRef: row.externalRef, propertyId },
    });
    return { action: 'Creado', entityId: created.id };
  }

  // Un servicio con reglas y boletas no cambia de propiedad: sería otro servicio.
  if (existing.propertyId !== propertyId) {
    throw new ImportRowError(
      'PROPERTY_STATE_CONFLICT',
      `Service "${row.externalRef}" already belongs to another property`,
      'propertyRef',
    );
  }
  const diff = changedKeys({ ...existing, amount: dec(existing.amount) }, fields);
  if (diff.length === 0) return { action: 'SinCambios', entityId: existing.id };
  await db.service.update({
    where: { id: existing.id },
    data: Object.fromEntries(diff.map((k) => [k, (fields as Record<string, unknown>)[k]])),
  });
  return { action: 'Actualizado', entityId: existing.id };
}

export const serviceImporter: EntityImporter<typeof ImportServiceSchema> = {
  entity: ImportEntity.Servicio,
  schema: ImportServiceSchema,
  upsert: upsertService,
};

// ─── Reglas de traslado por contrato ────────────────

/** Campos de la regla que informa la fila, en la forma en que se comparan y se guardan. */
export function chargeRuleFields(row: ImportChargeRuleRow) {
  return {
    payer: row.payer,
    splitMode: row.splitMode,
    tenantSharePct: dec(row.tenantSharePct),
    fixedAmount: row.splitMode === ChargeSplitMode.Fijo ? dec(row.fixedAmount) : null,
    paymentPlan: row.paymentPlan,
    annualRecovery: row.annualRecovery,
    annualInstallments: row.annualInstallments,
    annualDiscountBeneficiary: row.annualDiscountBeneficiary,
    remainingInstallmentsOnEnd: row.remainingInstallmentsOnEnd,
    notes: row.notes,
  };
}

/** La regla guardada, con los decimales como texto para compararla con la fila. */
const comparable = (rule: Record<string, unknown>) => ({
  ...rule,
  tenantSharePct: dec(rule.tenantSharePct),
  fixedAmount: dec(rule.fixedAmount),
});

const ruleKey = (row: { contractRef: string; serviceRef: string; validFrom: string }) =>
  `${row.contractRef}|${row.serviceRef}|${row.validFrom}`;

async function upsertChargeRule(db: Db, ctx: ImportContext, row: ImportChargeRuleRow): Promise<RowOutcome> {
  const contractId = await resolveRef(db, 'contract', ctx, row.contractRef, 'contractRef');
  const serviceId = await resolveRef(db, 'service', ctx, row.serviceRef, 'serviceRef');
  const [contract, service] = await Promise.all([
    db.contract.findFirst({
      where: { id: contractId },
      select: { propertyId: true, startDate: true, property: { select: { parentPropertyId: true } } },
    }),
    db.service.findFirst({ where: { id: serviceId }, select: { propertyId: true } }),
  ]);
  if (!serviceAppliesToContract(service, contract)) {
    throw new ImportRowError(
      'SERVICE_NOT_APPLICABLE',
      `Service "${row.serviceRef}" does not belong to the property of contract "${row.contractRef}"`,
      'serviceRef',
    );
  }
  const validFrom = dayStart(row.validFrom);
  if (validFrom.getTime() < dayOnly(contract.startDate).getTime()) {
    throw new ImportRowError('INVALID_DATES', 'validFrom must not be before the contract start date', 'validFrom');
  }

  const fields = chargeRuleFields(row);
  const siblings: any[] = await db.contractChargeRule.findMany({
    where: { contractId, serviceId },
    orderBy: { validFrom: 'asc' },
  });
  const exact = siblings.find((r) => r.validFrom.getTime() === validFrom.getTime());

  if (exact) {
    const diff = changedKeys(comparable(exact), fields);
    if (diff.length === 0) return { action: 'SinCambios', entityId: exact.id };
    // Una regla ya usada en una liquidación no se corrige: se reemplaza con una versión nueva.
    const billed = await db.serviceBillAllocation.count({ where: { ruleId: exact.id, billedAt: { not: null } } });
    if (billed > 0) {
      throw new ImportRowError(
        'CHARGE_RULE_IN_USE',
        'The rule was already used in a liquidación: send it with a new validFrom',
        'validFrom',
      );
    }
    await db.contractChargeRule.update({
      where: { id: exact.id },
      data: Object.fromEntries(diff.map((k) => [k, (fields as Record<string, unknown>)[k]])),
    });
    await ctx.reallocateService?.(db, serviceId, validFrom);
    return { action: 'Actualizado', entityId: exact.id };
  }

  // Si la que rige a esa fecha ya dice lo mismo, no hace falta una versión nueva.
  const previous = [...siblings].reverse().find((r) => r.validFrom.getTime() < validFrom.getTime());
  const covers = previous && (!previous.validTo || previous.validTo.getTime() >= validFrom.getTime());
  if (covers && changedKeys(comparable(previous), fields).length === 0) {
    return { action: 'SinCambios', entityId: previous.id };
  }

  const data = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  const id = await insertRuleVersion(db, {
    tenantId: ctx.tenantId,
    contractId,
    serviceId,
    validFrom,
    validTo: null,
    fields: { ...data, notes: fields.notes ?? null },
  });
  await ctx.reallocateService?.(db, serviceId, validFrom);
  return { action: 'Creado', entityId: id! };
}

export const chargeRuleImporter: EntityImporter<typeof ImportChargeRuleSchema> = {
  entity: ImportEntity.ReglaDeCargo,
  schema: ImportChargeRuleSchema,
  keyOf: ruleKey,
  // Una regla no tiene `externalRef`: en el registro se identifica por contrato, servicio y fecha.
  refOf: (raw) => {
    const r = raw as { contractRef?: unknown; serviceRef?: unknown; validFrom?: unknown } | null;
    const parts = [r?.contractRef, r?.serviceRef, r?.validFrom];
    return parts.every((p) => typeof p === 'string' && p.trim()) ? parts.join('|') : rawExternalRef(raw);
  },
  upsert: upsertChargeRule,
};
