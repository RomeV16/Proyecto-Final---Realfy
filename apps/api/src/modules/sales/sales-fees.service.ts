import { Injectable } from '@nestjs/common';
import {
  CreateSalesFeeSchema,
  FeeBasis,
  FeeKind,
  FeePayerMode,
  FeePayerRole,
  FeeStatus,
  SalesOperationStatus,
  SalesPartyRole,
  todayInAR,
} from '@realfy/shared';
import type { CreateFeeInput } from '@realfy/shared';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { parseOrThrow } from '../../common/validation/zod';
import { badRequest, conflict } from '../cash/cash.errors';
import { FeeProposalService } from '../fees/fee-proposal.service';
import { FeesService } from '../fees/fees.service';
import { OperationalDefaultsService } from '../tenants/operational-defaults.service';
import { Db, findOperation, lockOperation } from './sales.helpers';
import { SalesService } from './sales.service';

/** Etapas en las que ya se puede pactar el honorario de la venta (con la reserva en marcha y hasta después de escriturar). */
const FEE_STAGES: string[] = [
  SalesOperationStatus.Reservada,
  SalesOperationStatus.SenaRecibida,
  SalesOperationStatus.Boleto,
  SalesOperationStatus.Escriturada,
];

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Quien paga por cada lado: el de mayor parte y, a igualdad, el cargado primero. */
export function primaryPayers(parties: Array<{ role: string; personId: string; sharePct: unknown; createdAt: Date | string }>) {
  const out: Array<{ role: SalesPartyRole.Comprador | SalesPartyRole.Vendedor; personId: string }> = [];
  for (const role of [SalesPartyRole.Comprador, SalesPartyRole.Vendedor] as const) {
    const side = parties
      .filter((p) => p.role === role)
      .sort((a, b) => Number(b.sharePct) - Number(a.sharePct) || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    if (side[0]) out.push({ role, personId: side[0].personId });
  }
  return out;
}

/**
 * Honorario de la venta (4.5): cada parte paga un porcentaje sobre el valor real, por defecto el de la
 * inmobiliaria según el tipo de inmueble (3 % construido, 5 % lote). Lo crea `FeesService` con el
 * vínculo a la operación; el cobro, el coorretaje y las comisiones se manejan en Honorarios.
 */
@Injectable()
export class SalesFeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
    private readonly fees: FeesService,
    private readonly proposal: FeeProposalService,
    private readonly defaults: OperationalDefaultsService,
    private readonly sales: SalesService,
  ) {}

  /** Propuesta con los valores por defecto (porcentaje según el inmueble, base, pagadores); no guarda nada. */
  async preview(opId: string) {
    const op = await findOperation(this.prisma.client, opId, { parties: true, property: { select: { id: true, type: true } } });
    const base = this.baseOf(op);
    const suggestion: any = await this.proposal.preview({
      kind: FeeKind.Venta,
      propertyId: op.propertyId,
      baseAmount: base ?? '0',
      currency: op.currency,
    });
    return {
      ...suggestion,
      salesOpId: opId,
      baseAmount: base,
      payers: primaryPayers(op.parties),
      firstDueDate: op.escrituraDate ? isoDay(new Date(op.escrituraDate)) : isoDay(todayInAR()),
    };
  }

  /** Crea el honorario (uno por cada parte que paga) vinculado a la operación. Uno solo por operación. */
  async create(opId: string, data: unknown) {
    const input = parseOrThrow(CreateSalesFeeSchema, data, 'Invalid sales fee');
    const tenantId = this.tenantContext.getTenantId()!;
    const defaults = await this.defaults.get(tenantId);
    await this.prisma.client.$transaction(async (tx: Db) => {
      await lockOperation(tx, tenantId, opId);
      const op = await findOperation(tx, opId, { parties: true });
      if (!FEE_STAGES.includes(op.status)) {
        throw conflict('INVALID_STAGE_FOR_FEE', 'The sale fee is agreed once the operation is reserved');
      }
      const existing = await tx.fee.count({ where: { salesOpId: opId, status: { not: FeeStatus.Anulado } } });
      if (existing > 0) throw conflict('SALES_FEE_EXISTS', 'The operation already has a sale fee');
      const baseAmount = input.baseAmount ?? this.baseOf(op);
      if (!baseAmount) throw badRequest('PRICE_REQUIRED', 'Set the price of the operation before agreeing the fee');
      const payers = input.payers ?? primaryPayers(op.parties);
      if (payers.length === 0) throw badRequest('PAYERS_REQUIRED', 'The operation has no buyer or seller to charge');
      for (const payer of payers) {
        if (!op.parties.some((p: any) => p.role === payer.role && p.personId === payer.personId)) {
          throw badRequest('PAYER_NOT_PARTY', 'The payer must be a buyer or seller of the operation');
        }
      }
      const pct = input.pct ?? ((await this.proposal.preview({ kind: FeeKind.Venta, propertyId: op.propertyId, baseAmount, currency: op.currency })) as any).pct;
      const fee: CreateFeeInput = {
        kind: FeeKind.Venta,
        salesOpId: opId,
        propertyId: op.propertyId,
        basis: FeeBasis.ValorOperacion,
        baseAmount,
        pct,
        currency: op.currency,
        payers: payers.map((p) => ({ role: FeePayerRole[p.role], personId: p.personId })),
        payerMode: FeePayerMode.CadaParte,
        vatMode: defaults.fees.vatMode,
        vatPct: String(defaults.fees.vatPct),
        installments: input.installments ?? defaults.fees.installments,
        firstDueDate: input.firstDueDate ?? (op.escrituraDate ? isoDay(new Date(op.escrituraDate)) : isoDay(todayInAR())),
        adjustInstallments: false,
        shares: [],
        staff: [],
        notes: input.notes ?? null,
      };
      const ids = await this.fees.createInTx(tx, tenantId, fee);
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'SalesOperation',
        entityId: opId,
        metadata: { operation: 'sales-fee-create', feeIds: ids, pct, baseAmount },
      });
    });
    return this.sales.findOne(opId);
  }

  /** Base del honorario: el precio pactado y, sin él, el de publicación. */
  private baseOf(op: { agreedPrice?: unknown; price?: unknown }): string | null {
    const value = op.agreedPrice ?? op.price;
    return value === null || value === undefined ? null : String(value);
  }
}
