import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ChargePayer,
  ContractStatus,
  InvalidChargeRuleError,
  ServiceBillFilterSchema,
  ServiceBillRowSchema,
  ServiceBillStatus,
  UpdateServiceBillSchema,
  chargeAllocationLine,
  splitBill,
} from '@realfy/shared';
import type { ChargeRuleInput, ChargeSplitResult, LiquidationExtraLine, ServiceBillRowInput } from '@realfy/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { parseOrThrow } from '../../common/validation/zod';
import { monthStart, pickRuleAt } from './charge-rule-dates';

export type BulkBillRowResult =
  | { index: number; status: 'created' | 'updated' | 'unchanged'; billId: string }
  | { index: number; status: 'error'; error: { code: string; message: string } };

type Db = any;

const MAX_BULK_ROWS = 500;

const notFound = (error: string, message: string) => new NotFoundException({ error, message });
const conflict = (error: string, message: string) => new ConflictException({ error, message });
const badRequest = (error: string, message: string) => new BadRequestException({ error, message });

const dayStart = (value: string): Date =>
  new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value);

/** "YYYY-MM" o una fecha del mes -> primer día del mes, a medianoche UTC. */
export function parsePeriod(value: string): Date {
  const date = /^\d{4}-\d{2}$/.test(value) ? new Date(`${value}-01T00:00:00.000Z`) : new Date(value);
  return monthStart(date);
}

/** "MM/YYYY": la etiqueta de cuota cuando la boleta no trae otra. */
export function defaultInstallmentLabel(period: Date): string {
  return `${String(period.getUTCMonth() + 1).padStart(2, '0')}/${period.getUTCFullYear()}`;
}

/**
 * Boletas de servicios e impuestos y el reparto de cada una entre los contratos
 * (partes que se cobran al inquilino en su liquidación). Ver ADR-0008.
 */
@Injectable()
export class ServiceBillsService {
  private readonly logger = new Logger(ServiceBillsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  // ─── Lecturas ───────────────────────────────────────

  async findAll(query: unknown) {
    const filters = parseOrThrow(ServiceBillFilterSchema, query, 'Invalid filter parameters');
    const where: Record<string, unknown> = {};
    if (filters.period) where.period = parsePeriod(filters.period);
    if (filters.serviceId) where.serviceId = filters.serviceId;
    if (filters.status) where.status = filters.status;
    if (filters.propertyId) where.service = { propertyId: filters.propertyId };

    const [items, total] = await Promise.all([
      this.prisma.client.serviceBill.findMany({
        where,
        include: {
          service: {
            select: { id: true, serviceType: true, providerName: true, propertyId: true, property: { select: { id: true, title: true } } },
          },
          _count: { select: { allocations: true } },
        },
        orderBy: [{ period: 'desc' }, { createdAt: 'asc' }],
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      this.prisma.client.serviceBill.count({ where }),
    ]);
    return { items, total, page: filters.page, limit: filters.limit, totalPages: Math.ceil(total / filters.limit) };
  }

  /**
   * Planilla del mes: una fila por servicio activo con su boleta del período (si
   * ya está cargada) y quién paga según las reglas vigentes de sus contratos.
   */
  async sheet(period: string, propertyId?: string) {
    if (!period) throw badRequest('VALIDATION_ERROR', 'period is required (YYYY-MM)');
    const month = parsePeriod(period);
    if (Number.isNaN(month.getTime())) throw badRequest('VALIDATION_ERROR', 'period must be YYYY-MM');

    const services = await this.prisma.client.service.findMany({
      where: { isActive: true, ...(propertyId && { propertyId }) },
      include: {
        property: { select: { id: true, title: true } },
        bills: { where: { period: month }, orderBy: { createdAt: 'asc' } },
        rules: { include: { contract: { select: { id: true, status: true, startDate: true, propertyId: true } } } },
      },
      orderBy: [{ propertyId: 'asc' }, { serviceType: 'asc' }],
      take: 1000,
    });

    const rows = services.map((service: any) => {
      const rules = pickRulesFor(service.rules, month).map((rule: any) => ({
        id: rule.id,
        contractId: rule.contractId,
        payer: rule.payer,
        splitMode: rule.splitMode,
        tenantSharePct: rule.tenantSharePct.toString(),
        fixedAmount: rule.fixedAmount?.toString() ?? null,
        paymentPlan: rule.paymentPlan,
      }));
      return {
        service: {
          id: service.id,
          serviceType: service.serviceType,
          providerName: service.providerName,
          amount: service.amount.toString(),
          currency: service.currency,
          dueDay: service.dueDay,
          billingFrequency: service.billingFrequency,
          hasAnnualOption: service.hasAnnualOption,
          property: service.property,
        },
        bills: service.bills,
        rules,
      };
    });
    return { period: month.toISOString().slice(0, 10), rows };
  }

  async findOne(id: string) {
    return this.requireBill(id, true);
  }

  /**
   * Reparto de la boleta con las reglas vigentes hoy en la base: las partes ya
   * guardadas (con su estado de facturación) y lo que daría el cálculo ahora.
   */
  async allocations(id: string) {
    const bill = await this.requireBill(id, false);
    const stored = await this.prisma.client.serviceBillAllocation.findMany({
      where: { billId: id },
      orderBy: [{ contractId: 'asc' }, { chargePeriod: 'asc' }],
    });
    const preview = await this.compute(this.prisma.client, bill);
    return {
      billId: id,
      stored: stored.map((a: any) => ({ ...a, amount: a.amount.toString() })),
      preview: {
        allocations: preview.allocations.map((a) => ({
          ...a,
          chargePeriod: a.chargePeriod.toISOString().slice(0, 10),
        })),
        skipped: preview.skipped,
        warnings: preview.warnings,
      },
    };
  }

  // ─── Carga masiva ───────────────────────────────────

  /**
   * Carga una planilla de boletas. Idempotente por (servicio, período, cuota): una
   * fila repetida con los mismos datos no cambia nada; con otro importe la
   * actualiza (si todavía no se facturó). Cada fila se guarda sola: un error no
   * frena las demás.
   */
  async bulk(data: unknown) {
    if (!Array.isArray(data)) {
      throw badRequest('VALIDATION_ERROR', 'Expected an array of bills');
    }
    if (data.length < 1 || data.length > MAX_BULK_ROWS) {
      throw badRequest('VALIDATION_ERROR', `Between 1 and ${MAX_BULK_ROWS} bills per request`);
    }
    // Las filas se validan una por una para informar cada error por separado.
    const results: BulkBillRowResult[] = [];
    for (let index = 0; index < data.length; index++) {
      try {
        const row = parseOrThrow(ServiceBillRowSchema, data[index], 'Invalid bill data');
        results.push({ index, ...(await this.upsertRow(row)) });
      } catch (error) {
        results.push({ index, status: 'error', error: toRowError(error) });
      }
    }
    const count = (status: string) => results.filter((r) => r.status === status).length;
    return {
      total: results.length,
      created: count('created'),
      updated: count('updated'),
      unchanged: count('unchanged'),
      failed: count('error'),
      results,
    };
  }

  private async upsertRow(
    row: ServiceBillRowInput,
  ): Promise<{ status: 'created' | 'updated' | 'unchanged'; billId: string }> {
    const tenantId = this.tenantContext.getTenantId()!;
    const service = await this.prisma.client.service.findFirst({ where: { id: row.serviceId } });
    if (!service) throw notFound('SERVICE_NOT_FOUND', 'Service not found');

    const period = parsePeriod(row.period);
    const installmentLabel = row.installmentLabel ?? defaultInstallmentLabel(period);
    const values = {
      amount: row.amount,
      nominalAmount: row.nominalAmount ?? null,
      dueDate: row.dueDate ? dayStart(row.dueDate) : null,
      consumption: row.consumption ?? null,
      unitConsumptions: row.unitConsumptions ?? null,
      notes: row.notes ?? null,
    };

    return this.prisma.client.$transaction(async (tx: Db) => {
      const existing = await tx.serviceBill.findFirst({
        where: { serviceId: row.serviceId, period, installmentLabel },
      });

      if (!existing) {
        const created = await tx.serviceBill.create({
          data: {
            tenantId,
            serviceId: row.serviceId,
            period,
            installmentLabel,
            currency: service.currency,
            createdById: this.tenantContext.getUserId() ?? null,
            ...values,
            unitConsumptions: values.unitConsumptions ?? undefined,
          },
        });
        await this.materialize(tx, created);
        return { status: 'created' as const, billId: created.id as string };
      }

      if (sameValues(existing, values)) return { status: 'unchanged' as const, billId: existing.id as string };

      await this.assertNotBilled(tx, existing.id);
      const updated = await tx.serviceBill.update({
        where: { id: existing.id },
        data: {
          ...values,
          unitConsumptions: values.unitConsumptions ?? Prisma.DbNull,
          // Una boleta anulada vuelve a regir si se la vuelve a cargar.
          status: existing.status === ServiceBillStatus.Anulada ? ServiceBillStatus.Pendiente : existing.status,
        },
      });
      await this.materialize(tx, updated);
      return { status: 'updated' as const, billId: existing.id as string };
    });
  }

  // ─── Cambio ─────────────────────────────────────────

  async update(id: string, data: unknown) {
    const input = parseOrThrow(UpdateServiceBillSchema, data, 'Invalid bill data');
    const bill = await this.requireBill(id, false);

    const changesAmounts =
      input.amount !== undefined ||
      input.nominalAmount !== undefined ||
      input.consumption !== undefined ||
      input.unitConsumptions !== undefined;

    // Estado y pago: pagar con quién y cuándo pagó; anular o volver a pendiente limpia el pago.
    let status = input.status as ServiceBillStatus | undefined;
    const paidBy = input.paidBy !== undefined ? input.paidBy : bill.paidBy;
    const paidAt = input.paidAt !== undefined ? (input.paidAt ? dayStart(input.paidAt) : null) : bill.paidAt;
    if (!status && (input.paidBy || input.paidAt) && paidBy && paidAt) status = ServiceBillStatus.Pagada;
    const finalStatus = status ?? (bill.status as ServiceBillStatus);
    if (finalStatus === ServiceBillStatus.Pagada && (!paidBy || !paidAt)) {
      throw badRequest('BILL_PAYMENT_DATA_REQUIRED', 'paidBy and paidAt are required to mark a bill as paid');
    }

    await this.prisma.client.$transaction(async (tx: Db) => {
      if (changesAmounts || finalStatus === ServiceBillStatus.Anulada) await this.assertNotBilled(tx, id);

      const clearPayment = finalStatus !== ServiceBillStatus.Pagada;
      const updated = await tx.serviceBill.update({
        where: { id },
        data: {
          ...(input.amount !== undefined && { amount: input.amount }),
          ...(input.nominalAmount !== undefined && { nominalAmount: input.nominalAmount }),
          ...(input.dueDate !== undefined && { dueDate: input.dueDate ? dayStart(input.dueDate) : null }),
          ...(input.consumption !== undefined && { consumption: input.consumption }),
          ...(input.unitConsumptions !== undefined && { unitConsumptions: input.unitConsumptions ?? Prisma.DbNull }),
          ...(input.receiptUrl !== undefined && { receiptUrl: input.receiptUrl }),
          ...(input.notes !== undefined && { notes: input.notes }),
          status: finalStatus,
          paidBy: clearPayment ? null : paidBy,
          paidAt: clearPayment ? null : paidAt,
        },
      });

      if (finalStatus === ServiceBillStatus.Anulada) {
        await tx.serviceBillAllocation.deleteMany({ where: { billId: id, billedAt: null } });
      } else if (changesAmounts) {
        await this.materialize(tx, updated);
      }
      await this.syncPayment(tx, updated);
    });

    return this.requireBill(id, true);
  }

  /** El pago de la boleta deja un `ServicePayment` ligado (alimenta el recordatorio de vencimientos). */
  private async syncPayment(tx: Db, bill: any) {
    const tenantId = this.tenantContext.getTenantId()!;
    const existing = await tx.servicePayment.findFirst({ where: { billId: bill.id } });
    if (bill.status !== ServiceBillStatus.Pagada) {
      if (existing) await tx.servicePayment.deleteMany({ where: { billId: bill.id } });
      return;
    }
    const data = {
      amount: bill.amount,
      paymentDate: bill.paidAt,
      period: bill.period,
      notes: `Boleta ${bill.installmentLabel}, pagó ${bill.paidBy}`,
    };
    if (existing) await tx.servicePayment.update({ where: { id: existing.id }, data });
    else await tx.servicePayment.create({ data: { tenantId, serviceId: bill.serviceId, billId: bill.id, ...data } });
  }

  // ─── Reparto ────────────────────────────────────────

  /** Calcula el reparto de la boleta con las reglas vigentes (no escribe). */
  async compute(db: Db, bill: any): Promise<ChargeSplitResult> {
    const period = monthStart(bill.period);
    const rules = await db.contractChargeRule.findMany({
      where: { serviceId: bill.serviceId },
      include: { contract: { select: { id: true, status: true, startDate: true, endDate: true, actualEndDate: true, propertyId: true } } },
    });

    const units = new Map<string, string>(
      (Array.isArray(bill.unitConsumptions)
        ? (bill.unitConsumptions as { propertyId: string; consumption: string }[])
        : []
      ).map((u) => [u.propertyId, String(u.consumption)]),
    );

    const inputs: ChargeRuleInput[] = [];
    for (const rule of pickRulesFor(rules, period)) {
      const contract = rule.contract;
      if (contract.status === ContractStatus.Borrador) continue;
      const end = effectiveEnd(contract);
      if (end && end.getTime() < period.getTime()) continue;
      inputs.push({
        contractId: rule.contractId,
        ruleId: rule.id,
        payer: rule.payer,
        splitMode: rule.splitMode,
        tenantSharePct: rule.tenantSharePct.toString(),
        fixedAmount: rule.fixedAmount?.toString() ?? null,
        paymentPlan: rule.paymentPlan,
        annualRecovery: rule.annualRecovery,
        annualDiscountToTenant: rule.annualDiscountToTenant,
        consumption: units.get(contract.propertyId) ?? null,
        lastBillableMonth: end ? monthStart(end) : null,
      });
    }

    try {
      return splitBill(
        {
          amount: bill.amount.toString(),
          nominalAmount: bill.nominalAmount?.toString() ?? null,
          period,
          consumption: bill.consumption?.toString() ?? null,
        },
        inputs,
      );
    } catch (error) {
      if (error instanceof InvalidChargeRuleError) throw badRequest(error.code, error.message);
      throw error;
    }
  }

  /**
   * Deja guardadas las partes de la boleta: reemplaza las que todavía no se
   * facturaron y respeta las ya facturadas (una parte se factura una sola vez).
   */
  async materialize(tx: Db, bill: any) {
    const tenantId = this.tenantContext.getTenantId()!;
    await tx.serviceBillAllocation.deleteMany({ where: { billId: bill.id, billedAt: null } });
    if (bill.status === ServiceBillStatus.Anulada) return;

    const result = await this.compute(tx, bill);
    const billed = await tx.serviceBillAllocation.findMany({
      where: { billId: bill.id },
      select: { contractId: true, chargePeriod: true },
    });
    const taken = new Set(billed.map((a: any) => `${a.contractId}|${monthStart(a.chargePeriod).getTime()}`));

    const rows = result.allocations
      .filter((a) => !taken.has(`${a.contractId}|${a.chargePeriod.getTime()}`))
      .map((a) => ({
        tenantId,
        billId: bill.id,
        contractId: a.contractId,
        ruleId: a.ruleId,
        payer: a.payer,
        amount: a.amount,
        basis: a.basis,
        chargePeriod: a.chargePeriod,
        installmentNo: a.installmentNo,
        installmentsTotal: a.installmentsTotal,
      }));
    if (rows.length > 0) await tx.serviceBillAllocation.createMany({ data: rows });
    return result;
  }

  /** Rehace las partes no facturadas de las boletas de un servicio desde un mes (al cambiar reglas). */
  async reallocateService(tx: Db, serviceId: string, from: Date) {
    const bills = await tx.serviceBill.findMany({
      where: { serviceId, status: { not: ServiceBillStatus.Anulada }, period: { gte: monthStart(from) } },
    });
    for (const bill of bills) await this.materialize(tx, bill);
    return bills.length;
  }

  private async assertNotBilled(tx: Db, billId: string) {
    const billed = await tx.serviceBillAllocation.count({ where: { billId, billedAt: { not: null } } });
    if (billed > 0) {
      throw conflict('BILL_ALREADY_BILLED', 'The bill already has parts included in a liquidación');
    }
  }

  private async requireBill(id: string, withAllocations: boolean) {
    const bill = await this.prisma.client.serviceBill.findFirst({
      where: { id },
      include: {
        service: { select: { id: true, serviceType: true, providerName: true, propertyId: true, currency: true } },
        ...(withAllocations && { allocations: { orderBy: [{ contractId: 'asc' }, { chargePeriod: 'asc' }] } }),
      },
    });
    if (!bill) throw notFound('BILL_NOT_FOUND', 'Bill not found');
    return bill;
  }

  // ─── Liquidación ────────────────────────────────────

  /**
   * Renglones de la liquidación del contrato en `period`: las partes sin facturar
   * cuyo mes de cobro llegó (también las de meses anteriores: una boleta
   * cargada tarde entra en la próxima liquidación que se genere) y de boletas
   * no anuladas en la moneda de la liquidación.
   */
  async pendingLines(contractId: string, period: Date, currency: string): Promise<LiquidationExtraLine[]> {
    const rows = await this.prisma.client.serviceBillAllocation.findMany({
      where: {
        contractId,
        billedAt: null,
        chargePeriod: { lte: period },
        payer: { not: ChargePayer.Inquilino },
        bill: { status: { not: ServiceBillStatus.Anulada }, currency: currency as any },
      },
      include: { bill: { include: { service: { select: { serviceType: true, providerName: true } } } } },
      orderBy: [{ chargePeriod: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((a: any) => ({
      ...chargeAllocationLine({
        allocationId: a.id,
        payer: a.payer,
        amount: a.amount.toString(),
        serviceType: a.bill.service.serviceType,
        providerName: a.bill.service.providerName,
        installmentLabel: a.bill.installmentLabel,
        installmentNo: a.installmentNo,
        installmentsTotal: a.installmentsTotal,
      }),
    }));
  }

  /**
   * Marca facturadas las partes que la liquidación incluyó, en la misma
   * transacción que la crea. Si alguna ya estaba facturada (otra generación se
   * adelantó) falla y la transacción se deshace: una parte entra en una sola
   * liquidación.
   */
  async markBilled(tx: Db, allocationIds: string[], liquidacionId: string) {
    if (allocationIds.length === 0) return 0;
    const result = await tx.serviceBillAllocation.updateMany({
      where: { id: { in: allocationIds }, billedAt: null },
      data: { billedAt: new Date(), liquidacionId },
    });
    if (result.count !== allocationIds.length) {
      throw conflict('ALLOCATION_ALREADY_BILLED', 'A bill part was already included in another liquidación');
    }
    return result.count;
  }

  /** Libera las partes de una liquidación que se borra o de un renglón que se quita. */
  async release(tx: Db, where: { liquidacionId?: string; ids?: string[] }) {
    const clauses = [];
    if (where.liquidacionId) clauses.push({ liquidacionId: where.liquidacionId });
    if (where.ids?.length) clauses.push({ id: { in: where.ids } });
    if (clauses.length === 0) return 0;
    const result = await tx.serviceBillAllocation.updateMany({
      where: { OR: clauses, billedAt: { not: null } },
      data: { billedAt: null, liquidacionId: null },
    });
    return result.count;
  }
}

// ─── Helpers ──────────────────────────────────────────

/** Por cada contrato, la regla vigente en el mes de la boleta (la de la fecha de inicio si el contrato empieza después). */
export function pickRulesFor(rules: any[], month: Date): any[] {
  const byContract = new Map<string, any[]>();
  for (const rule of rules) {
    const list = byContract.get(rule.contractId) ?? [];
    list.push(rule);
    byContract.set(rule.contractId, list);
  }
  const picked: any[] = [];
  for (const list of byContract.values()) {
    const start: Date | undefined = list[0].contract?.startDate;
    const ref = start && start.getTime() > month.getTime() ? start : month;
    const rule = pickRuleAt(list, ref);
    if (rule) picked.push(rule);
  }
  return picked;
}

/** Fin efectivo del contrato; un contrato Activo sigue rigiendo pasado su fin pactado. */
function effectiveEnd(contract: { status: string; endDate: Date; actualEndDate: Date | null }): Date | null {
  if (contract.actualEndDate) return contract.actualEndDate;
  return contract.status === ContractStatus.Activo ? null : contract.endDate;
}

function sameValues(existing: any, values: Record<string, any>): boolean {
  const num = (v: unknown) => (v == null ? null : Number(v.toString()));
  const day = (v: unknown) => (v ? (v as Date).toISOString().slice(0, 10) : null);
  return (
    num(existing.amount) === num(values.amount) &&
    num(existing.nominalAmount) === num(values.nominalAmount) &&
    num(existing.consumption) === num(values.consumption) &&
    day(existing.dueDate) === day(values.dueDate) &&
    (existing.notes ?? null) === (values.notes ?? null) &&
    JSON.stringify(existing.unitConsumptions ?? null) === JSON.stringify(values.unitConsumptions ?? null)
  );
}

function toRowError(error: unknown): { code: string; message: string } {
  const response = (error as { getResponse?: () => unknown }).getResponse?.() as
    | { error?: string; message?: string }
    | undefined;
  if (response && typeof response === 'object') {
    return { code: response.error ?? 'ERROR', message: String(response.message ?? 'Error') };
  }
  return { code: 'ERROR', message: (error as Error).message };
}
