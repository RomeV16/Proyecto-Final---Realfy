import { Injectable } from '@nestjs/common';
import {
  DATA_QUALITY_CHECKS,
  DataQualityFindingsQuerySchema,
  type DataQualityCheckId,
  type DataQualityFinding,
  type DataQualityPage,
  type DataQualitySummary,
} from '@realfy/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { parseOrThrow } from '../../common/validation/zod';
import {
  detectContractEssentials,
  detectDuplicateCbu,
  detectDuplicateCuit,
  detectDuplicateDni,
  detectDuplicateEmail,
  detectDuplicateName,
  detectDuplicatePhone,
  detectExpiredUndecided,
  detectLessorWithoutTaxId,
  detectLessorsSum,
  detectOwnerWithoutBankAccount,
  detectOwnershipSum,
  detectPropertyWithoutOwner,
  payeeIds,
  type BankAccountRow,
  type ContractRow,
  type LessorRow,
  type OwnershipRow,
  type PersonRow,
  type PropertyRow,
} from './detectors';

const num = (v: { toString(): string } | null | undefined): number | null => (v == null ? null : Number(v.toString()));

/**
 * Lee de la base lo que cada control necesita, una sola vez por pedido, y se
 * lo pasa a los detectores (que son funciones puras). Todo se lee por el
 * cliente con filtro de inmobiliaria.
 */
class DataQualityData {
  private cache = new Map<string, Promise<any>>();

  constructor(
    private readonly prisma: PrismaService,
    readonly now: Date,
  ) {}

  private once<T>(key: string, load: () => Promise<T>): Promise<T> {
    if (!this.cache.has(key)) this.cache.set(key, load());
    return this.cache.get(key) as Promise<T>;
  }

  persons(): Promise<PersonRow[]> {
    return this.once('persons', async () => {
      const rows = await this.prisma.client.person.findMany({
        where: { isActive: true },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          phone2: true,
          cuit: true,
          dni: true,
          personType: true,
          payoutMethod: true,
          roles: { select: { role: true } },
        },
      });
      return rows.map((r) => ({ ...r, roles: r.roles.map((x) => x.role) }));
    });
  }

  accounts(): Promise<BankAccountRow[]> {
    return this.once('accounts', () =>
      this.prisma.client.personBankAccount.findMany({ select: { personId: true, cbu: true, alias: true } }),
    );
  }

  properties(): Promise<PropertyRow[]> {
    return this.once('properties', () =>
      this.prisma.client.property.findMany({ where: { isActive: true }, select: { id: true, title: true } }),
    );
  }

  ownerships(): Promise<OwnershipRow[]> {
    return this.once('ownerships', async () => {
      const rows = await this.prisma.client.propertyOwnership.findMany({
        select: { propertyId: true, personId: true, sharePct: true, since: true, until: true },
      });
      return rows.map((r) => ({ ...r, sharePct: num(r.sharePct) }));
    });
  }

  lessors(): Promise<LessorRow[]> {
    return this.once('lessors', async () => {
      const rows = await this.prisma.client.contractLessor.findMany({
        where: { contract: { status: 'Activo', isActive: true } },
        select: { contractId: true, personId: true, payoutPct: true, validFrom: true, validTo: true },
      });
      return rows.map((r) => ({ ...r, payoutPct: num(r.payoutPct) ?? 0 }));
    });
  }

  contracts(): Promise<ContractRow[]> {
    return this.once('contracts', async () => {
      const rows = await this.prisma.client.contract.findMany({
        where: { status: { in: ['Activo', 'Vencido'] }, isActive: true },
        select: {
          id: true,
          status: true,
          propertyId: true,
          endDate: true,
          actualEndDate: true,
          closedAt: true,
          rentAmount: true,
          adjustmentType: true,
          customAdjustmentPct: true,
          property: { select: { title: true } },
          persons: { where: { role: 'Inquilino' }, select: { id: true } },
          renewals: { select: { id: true } },
          closureSummary: { select: { id: true } },
        },
      });
      return rows.map((r) => ({
        id: r.id,
        status: r.status,
        propertyId: r.propertyId,
        propertyTitle: r.property.title,
        endDate: r.endDate,
        actualEndDate: r.actualEndDate,
        closedAt: r.closedAt,
        rentAmount: num(r.rentAmount) ?? 0,
        adjustmentType: r.adjustmentType,
        customAdjustmentPct: num(r.customAdjustmentPct),
        tenantCount: r.persons.length,
        renewalCount: r.renewals.length,
        hasClosureSummary: !!r.closureSummary,
      }));
    });
  }

  /** Personas que cobran: locadores vigentes de contratos activos y titulares vigentes. */
  async payees(): Promise<Set<string>> {
    const [lessors, ownerships] = await Promise.all([this.lessors(), this.ownerships()]);
    return payeeIds(lessors, ownerships, this.now);
  }
}

type Detector = (d: DataQualityData) => Promise<DataQualityFinding[]>;

const DETECTORS: Record<DataQualityCheckId, Detector> = {
  'duplicate-cuit': async (d) => detectDuplicateCuit(await d.persons()),
  'duplicate-dni': async (d) => detectDuplicateDni(await d.persons()),
  'duplicate-cbu': async (d) => detectDuplicateCbu(await d.accounts(), await d.persons()),
  'duplicate-phone': async (d) => detectDuplicatePhone(await d.persons()),
  'duplicate-email': async (d) => detectDuplicateEmail(await d.persons()),
  'duplicate-name': async (d) => detectDuplicateName(await d.persons()),
  'lessors-sum': async (d) => detectLessorsSum(await d.contracts(), await d.lessors(), d.now),
  'ownership-sum': async (d) => detectOwnershipSum(await d.properties(), await d.ownerships(), d.now),
  'property-no-owner': async (d) => detectPropertyWithoutOwner(await d.properties(), await d.ownerships(), d.now),
  'owner-no-bank-account': async (d) =>
    detectOwnerWithoutBankAccount(await d.persons(), await d.accounts(), await d.payees()),
  'lessor-no-tax-id': async (d) => detectLessorWithoutTaxId(await d.persons(), await d.payees()),
  'contract-expired-undecided': async (d) => detectExpiredUndecided(await d.contracts(), d.now),
  'contract-essentials': async (d) => detectContractEssentials(await d.contracts()),
};

const SEVERITY: Record<DataQualityCheckId, 'error' | 'warning'> = {
  'duplicate-cuit': 'error',
  'duplicate-dni': 'error',
  'duplicate-cbu': 'error',
  'duplicate-phone': 'warning',
  'duplicate-email': 'warning',
  'duplicate-name': 'warning',
  'lessors-sum': 'error',
  'ownership-sum': 'warning',
  'property-no-owner': 'warning',
  'owner-no-bank-account': 'error',
  'lessor-no-tax-id': 'error',
  'contract-expired-undecided': 'warning',
  'contract-essentials': 'error',
};

@Injectable()
export class DataQualityService {
  constructor(private readonly prisma: PrismaService) {}

  /** Cantidad de hallazgos por control. */
  async summary(now = new Date()): Promise<DataQualitySummary> {
    const data = new DataQualityData(this.prisma, now);
    const checks = await Promise.all(
      DATA_QUALITY_CHECKS.map(async ({ id, group }) => ({
        check: id,
        group,
        severity: SEVERITY[id],
        count: (await DETECTORS[id](data)).length,
      })),
    );
    return {
      generatedAt: now.toISOString(),
      total: checks.reduce((s, c) => s + c.count, 0),
      checks,
    };
  }

  /** Hallazgos de un control, paginados. */
  async findings(check: DataQualityCheckId, query: unknown, now = new Date()): Promise<DataQualityPage> {
    const { page, limit } = parseOrThrow(DataQualityFindingsQuerySchema, query, 'Invalid pagination');
    const all = await DETECTORS[check](new DataQualityData(this.prisma, now));
    return {
      check,
      items: all.slice((page - 1) * limit, page * limit),
      total: all.length,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(all.length / limit)),
    };
  }
}
