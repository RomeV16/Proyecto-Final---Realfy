import { Injectable } from '@nestjs/common';
import {
  AdjustmentType,
  Currency,
  FeeBasis,
  FeeKind,
  FeePayerChoice,
  FeePayerMode,
  FeePayerRole,
  FeePreviewSchema,
  SaleAsset,
  contractTotal,
  defaultFeePct,
  feeAmounts,
  pctOf,
  personName,
  splitBetweenPayers,
  todayInAR,
} from '@realfy/shared';
import type { OperationalDefaults } from '@realfy/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { parseOrThrow } from '../../common/validation/zod';
import { OperationalDefaultsService } from '../tenants/operational-defaults.service';
import { getLessorsAt, getParty } from '../contracts/contract-parties';
import { pickTermsAt } from '../contracts/contract-terms';
import { notFound } from '../cash/cash.errors';
import { rethrowFeeEngine } from './fees.helpers';

const LOT_TYPES = new Set(['Lote', 'Terreno']);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export interface SuggestedPayer {
  role: FeePayerRole;
  personId: string;
  name: string;
  sharePct: string;
}

/**
 * Propuesta de honorario con los valores por defecto de la inmobiliaria
 * (defecto -> contrato): base, porcentaje, quién paga, IVA, cuotas y comisión
 * del personal. No guarda nada; la pantalla la muestra editable y la envía a
 * `POST /fees`.
 */
@Injectable()
export class FeeProposalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly operationalDefaults: OperationalDefaultsService,
  ) {}

  async preview(query: unknown) {
    const input = parseOrThrow(FeePreviewSchema, query, 'Invalid fee preview');
    const defaults = await this.operationalDefaults.get(this.tenantContext.getTenantId()!);
    const common = {
      kind: input.kind,
      vatMode: defaults.fees.vatMode,
      vatPct: String(defaults.fees.vatPct),
      installments: defaults.fees.installments,
      staffCommissionPct: String(defaults.fees.staffCommissionPct),
      staffCommissionBase: defaults.fees.staffCommissionBase,
    };
    try {
      if (input.kind === FeeKind.AltaAlquiler || input.kind === FeeKind.Renovacion) {
        return { ...common, ...(await this.rental(input, defaults)) };
      }
      if (input.kind === FeeKind.Venta) return { ...common, ...(await this.sale(input, defaults)) };
      return { ...common, ...(await this.fixed(input, defaults)) };
    } catch (error) {
      rethrowFeeEngine(error);
    }
  }

  /** Alta o renovación: porcentaje del total del contrato (o del período renovado). */
  private async rental(input: { kind: FeeKind; contractId?: string; contractPeriodId?: string }, defaults: OperationalDefaults) {
    const period = input.contractPeriodId
      ? await this.prisma.client.contractPeriod.findFirst({ where: { id: input.contractPeriodId } })
      : null;
    if (input.contractPeriodId && !period) throw notFound('CONTRACT_PERIOD_NOT_FOUND', 'Contract period not found');
    const contractId = period?.contractId ?? input.contractId!;
    const contract: any = await this.prisma.client.contract.findFirst({
      where: { id: contractId },
      include: {
        persons: { include: { person: true } },
        periods: { orderBy: { seq: 'asc' } },
        termsVersions: true,
      },
    });
    if (!contract) throw notFound('CONTRACT_NOT_FOUND', 'Contract not found');
    const tramo = period ?? contract.periods[0] ?? null;
    const start: Date = tramo ? new Date(tramo.startDate) : new Date(contract.startDate);
    const end: Date = tramo ? new Date(tramo.endDate) : new Date(contract.endDate);
    const initialRent = String(tramo ? tramo.initialRent : contract.rentAmount);
    const terms: any = pickTermsAt(contract.termsVersions ?? [], start);
    const total = contractTotal({
      startDate: start,
      endDate: end,
      initialRent,
      mode: defaults.fees.contractTotalMode,
      rule: {
        adjustmentType: (terms?.adjustmentType ?? contract.adjustmentType) as AdjustmentType,
        adjustmentPeriod: terms?.adjustmentPeriod ?? contract.adjustmentPeriod,
        adjustmentBase: terms?.adjustmentBase ?? null,
        fixedInitialMonths: terms?.fixedInitialMonths ?? 0,
        customPct: terms ? terms.customPct : contract.customAdjustmentPct,
        customSteps: (terms?.customSteps as any) ?? null,
      },
    });
    const pct = defaultFeePct(input.kind, defaults)!;
    const payers = await this.rentalPayers(contract, start, defaults);
    const gross = pctOf(total.total, pct);
    const parts = splitBetweenPayers(gross, payers.length ? payers.map((p) => p.sharePct) : ['100']);
    return {
      basis: FeeBasis.TotalContrato,
      contractId: contract.id,
      contractPeriodId: period?.id ?? null,
      baseAmount: total.total.toFixed(2),
      pct: String(pct),
      currency: contract.rentCurrency,
      payerMode: FeePayerMode.Reparto,
      payerChoice: defaults.fees.payer,
      payers,
      firstDueDate: isoDay(start),
      adjustInstallments: defaults.fees.adjustInstallments,
      contractTotal: {
        mode: defaults.fees.contractTotalMode,
        months: total.months,
        projected: total.projected,
        indexBased: total.indexBased,
        initialRent,
        start: isoDay(start),
        end: isoDay(end),
      },
      estimate: parts.map((part) => feeAmounts(part, defaults.fees.vatMode, defaults.fees.vatPct).total.toFixed(2)),
    };
  }

  /** Quién paga un alquiler según la inmobiliaria: inquilino, locador principal o los dos con su parte. */
  private async rentalPayers(contract: any, at: Date, defaults: OperationalDefaults): Promise<SuggestedPayer[]> {
    const tenantParty = getParty<any>(contract, 'Inquilino');
    const lessors: any[] = await getLessorsAt(this.prisma.client, contract.id, at);
    const lessor = lessors[0];
    const out: SuggestedPayer[] = [];
    const choice = defaults.fees.payer;
    const lessorShare = choice === FeePayerChoice.Ambos ? defaults.fees.lessorSharePct : 100;
    if (choice !== FeePayerChoice.Locador && tenantParty?.person) {
      out.push({
        role: FeePayerRole.Inquilino,
        personId: tenantParty.personId,
        name: personName(tenantParty.person),
        sharePct: String(choice === FeePayerChoice.Ambos ? 100 - lessorShare : 100),
      });
    }
    if (choice !== FeePayerChoice.Inquilino && lessor?.person) {
      out.push({ role: FeePayerRole.Locador, personId: lessor.personId, name: personName(lessor.person), sharePct: String(lessorShare) });
    }
    if (out.length === 1) out[0].sharePct = '100';
    return out;
  }

  /** Venta: cada parte paga su porcentaje sobre el valor real (construido o lote). */
  private async sale(input: { propertyId?: string; saleAsset?: SaleAsset; baseAmount?: string; currency?: Currency }, defaults: OperationalDefaults) {
    const property = input.propertyId
      ? await this.prisma.client.property.findFirst({ where: { id: input.propertyId }, select: { id: true, type: true } })
      : null;
    if (input.propertyId && !property) throw notFound('PROPERTY_NOT_FOUND', 'Property not found');
    const saleAsset = input.saleAsset ?? (property && LOT_TYPES.has(property.type) ? SaleAsset.Lote : SaleAsset.Construido);
    const pct = defaultFeePct(FeeKind.Venta, defaults, saleAsset)!;
    const base = input.baseAmount ?? '0';
    return {
      basis: FeeBasis.ValorOperacion,
      propertyId: property?.id ?? null,
      saleAsset,
      baseAmount: base,
      pct: String(pct),
      currency: input.currency ?? Currency.USD,
      payerMode: FeePayerMode.CadaParte,
      payers: [] as SuggestedPayer[],
      firstDueDate: isoDay(todayInAR()),
      adjustInstallments: false,
      estimate: [feeAmounts(pctOf(base, pct), defaults.fees.vatMode, defaults.fees.vatPct).total.toFixed(2)],
    };
  }

  /** Tasación (monto fijo de la inmobiliaria, en dólares) y gestión de reparación (a cargar). */
  private async fixed(input: { kind: FeeKind; propertyId?: string; valuationId?: string }, defaults: OperationalDefaults) {
    const valuation = input.valuationId
      ? await this.prisma.client.propertyValuation.findFirst({ where: { id: input.valuationId }, select: { id: true, propertyId: true } })
      : null;
    if (input.valuationId && !valuation) throw notFound('VALUATION_NOT_FOUND', 'Valuation not found');
    const propertyId = valuation?.propertyId ?? input.propertyId ?? null;
    const owners: any[] = propertyId
      ? await this.prisma.client.propertyOwnership.findMany({
          where: { propertyId, until: null },
          include: { person: true },
          orderBy: [{ sharePct: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
        })
      : [];
    const amount = input.kind === FeeKind.Tasacion ? String(defaults.valuationUsd) : '0';
    return {
      basis: FeeBasis.MontoFijo,
      propertyId,
      valuationId: valuation?.id ?? null,
      baseAmount: amount,
      pct: null,
      currency: input.kind === FeeKind.Tasacion ? Currency.USD : Currency.ARS,
      payerMode: FeePayerMode.Reparto,
      payers: owners.slice(0, 1).map((o) => ({
        role: FeePayerRole.Otro,
        personId: o.personId,
        name: personName(o.person),
        sharePct: '100',
      })),
      firstDueDate: isoDay(todayInAR()),
      adjustInstallments: false,
      estimate: [feeAmounts(amount, defaults.fees.vatMode, defaults.fees.vatPct).total.toFixed(2)],
    };
  }
}
