import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CashCategory,
  CashDirection,
  CashMovementFilterSchema,
  CreateCashMovementSchema,
  CreateConversionSchema,
  CreateFinancialAccountSchema,
  DeliverCustodySchema,
  FinancialAccountFilterSchema,
  FinancialAccountKind,
  PaymentMethod,
  UpdateFinancialAccountSchema,
  convertAmount,
  personName,
} from '@realfy/shared';
import Decimal from 'decimal.js';
import { randomUUID } from 'crypto';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { parseOrThrow } from '../../common/validation/zod';
import { OperationalDefaultsService } from '../tenants/operational-defaults.service';
import { auditJson, badRequest, conflict, dayStart, notFound, rethrowSettlement } from './cash.errors';

type Db = any;

export interface MovementInput {
  tenantId: string;
  accountId: string;
  date: Date;
  direction: CashDirection;
  amount: Decimal.Value;
  currency: string;
  category: CashCategory;
  counterpartyId?: string | null;
  contractId?: string | null;
  rate?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  note?: string | null;
}

const PERSON_SELECT = { select: { id: true, firstName: true, lastName: true } } as const;
const ACCOUNT_SELECT = { select: { id: true, name: true, kind: true, currency: true, ownerPersonId: true } } as const;

/**
 * Caja de la inmobiliaria (ADR-0012): cuentas (caja, banco y custodia de cada
 * locador, cada una en una sola moneda), el libro de movimientos, conversiones
 * con tipo de cambio explícito y la entrega del efectivo en custodia. Los
 * movimientos son siempre positivos; el sentido lo da `direction`.
 */
@Injectable()
export class CashService {
  private readonly logger = new Logger(CashService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
    private readonly operationalDefaults: OperationalDefaultsService,
  ) {}

  // ─── Cuentas ────────────────────────────────────────

  /**
   * Cuentas con su saldo y los totales por moneda: lo de la inmobiliaria (caja y
   * banco), lo que guarda en custodia y el total, que suma la custodia solo si la
   * inmobiliaria lo eligió (`cash.custodyInAgencyBalance`).
   */
  async listAccounts(query: unknown) {
    const filters = parseOrThrow(FinancialAccountFilterSchema, query, 'Invalid filter parameters');
    const tenantId = this.tenantContext.getTenantId()!;
    const where: Record<string, unknown> = {};
    if (filters.kind) where.kind = filters.kind;
    if (filters.currency) where.currency = filters.currency;
    if (filters.ownerPersonId) where.ownerPersonId = filters.ownerPersonId;
    if (!filters.includeInactive) where.isActive = true;
    const accounts = await this.prisma.client.financialAccount.findMany({
      where,
      include: { owner: PERSON_SELECT },
      orderBy: [{ kind: 'asc' }, { currency: 'asc' }, { name: 'asc' }],
    });
    const balances = await this.balances(this.prisma.client, accounts.map((a: any) => a.id));
    const { cash } = await this.operationalDefaults.get(tenantId);

    const totals = new Map<string, { agency: Decimal; custody: Decimal }>();
    const items = accounts.map((a: any) => {
      const balance = balances.get(a.id) ?? new Decimal(0);
      const t = totals.get(a.currency) ?? { agency: new Decimal(0), custody: new Decimal(0) };
      if (a.kind === FinancialAccountKind.Custodia) t.custody = t.custody.plus(balance);
      else t.agency = t.agency.plus(balance);
      totals.set(a.currency, t);
      return { ...a, balance: balance.toFixed(2) };
    });
    return {
      items,
      custodyInAgencyBalance: cash.custodyInAgencyBalance,
      totals: [...totals.entries()].map(([currency, t]) => ({
        currency,
        agency: t.agency.toFixed(2),
        custody: t.custody.toFixed(2),
        total: (cash.custodyInAgencyBalance ? t.agency.plus(t.custody) : t.agency).toFixed(2),
      })),
    };
  }

  async createAccount(data: unknown) {
    const input = parseOrThrow(CreateFinancialAccountSchema, data, 'Invalid account data');
    const tenantId = this.tenantContext.getTenantId()!;
    if (input.ownerPersonId) {
      const owner = await this.prisma.client.person.findFirst({ where: { id: input.ownerPersonId }, select: { id: true } });
      if (!owner) throw notFound('PERSON_NOT_FOUND', 'Custody owner not found');
    }
    try {
      return await this.prisma.client.$transaction(async (tx: Db) => {
        const account = await tx.financialAccount.create({
          data: {
            tenantId,
            kind: input.kind,
            name: input.name,
            currency: input.currency,
            ownerPersonId: input.ownerPersonId ?? null,
          },
          include: { owner: PERSON_SELECT },
        });
        await this.audit.record(tx, { action: 'CREATE', entity: 'FinancialAccount', entityId: account.id, after: auditJson(account) });
        return { ...account, balance: '0.00' };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw conflict('ACCOUNT_EXISTS', 'The lessor already has a custody account in that currency');
      }
      throw error;
    }
  }

  /** Cambia nombre o estado. No se desactiva una cuenta con saldo. */
  async updateAccount(id: string, data: unknown) {
    const input = parseOrThrow(UpdateFinancialAccountSchema, data, 'Invalid account data');
    const current = await this.findAccount(this.prisma.client, id);
    if (input.isActive === false && current.isActive) {
      const balance = (await this.balances(this.prisma.client, [id])).get(id) ?? new Decimal(0);
      if (!balance.isZero()) {
        throw conflict('ACCOUNT_HAS_BALANCE', `The account still holds ${balance.toFixed(2)} ${current.currency}`);
      }
    }
    return this.prisma.client.$transaction(async (tx: Db) => {
      const updated = await tx.financialAccount.update({ where: { id }, data: input, include: { owner: PERSON_SELECT } });
      await this.audit.record(tx, { action: 'UPDATE', entity: 'FinancialAccount', entityId: id, before: auditJson(current), after: auditJson(updated) });
      return updated;
    });
  }

  // ─── Movimientos ────────────────────────────────────

  async listMovements(query: unknown) {
    const filters = parseOrThrow(CashMovementFilterSchema, query, 'Invalid filter parameters');
    const where: Record<string, unknown> = {};
    if (filters.accountId) where.accountId = filters.accountId;
    if (filters.category) where.category = filters.category;
    if (filters.contractId) where.contractId = filters.contractId;
    if (filters.from || filters.to) {
      where.date = {
        ...(filters.from ? { gte: dayStart(filters.from) } : {}),
        ...(filters.to ? { lte: dayStart(filters.to) } : {}),
      };
    }
    const [items, total] = await Promise.all([
      this.prisma.client.cashMovement.findMany({
        where,
        include: { account: ACCOUNT_SELECT, counterparty: PERSON_SELECT },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      this.prisma.client.cashMovement.count({ where }),
    ]);
    return { items, total, page: filters.page, limit: filters.limit, totalPages: Math.ceil(total / filters.limit) };
  }

  /** Movimiento manual (gasto, honorario, pago a un locador, ente o proveedor, seña). */
  async createMovement(data: unknown) {
    const input = parseOrThrow(CreateCashMovementSchema, data, 'Invalid cash movement');
    const tenantId = this.tenantContext.getTenantId()!;
    const account = await this.findAccount(this.prisma.client, input.accountId);
    this.assertOperational(account);
    await this.assertRefs(input.counterpartyId, input.contractId);
    return this.prisma.client.$transaction(async (tx: Db) => {
      const movement = await this.recordMovement(tx, {
        tenantId,
        accountId: account.id,
        date: dayStart(input.date),
        direction: input.direction,
        amount: input.amount,
        currency: account.currency,
        category: input.category,
        counterpartyId: input.counterpartyId ?? null,
        contractId: input.contractId ?? null,
        sourceType: 'Manual',
        note: input.note ?? null,
      });
      await this.audit.record(tx, { action: 'CREATE', entity: 'CashMovement', entityId: movement.id, after: auditJson(movement) });
      return movement;
    });
  }

  /** Conversión entre dos cuentas de distinta moneda: salida en una y entrada en la otra, con el tipo de cambio. */
  async createConversion(data: unknown) {
    const input = parseOrThrow(CreateConversionSchema, data, 'Invalid conversion');
    const tenantId = this.tenantContext.getTenantId()!;
    const from = await this.findAccount(this.prisma.client, input.fromAccountId);
    const to = await this.findAccount(this.prisma.client, input.toAccountId);
    this.assertOperational(from);
    this.assertOperational(to);
    if (from.currency === to.currency) {
      throw badRequest('CONVERSION_SAME_CURRENCY', 'A conversion moves money between two currencies');
    }
    let converted: Decimal;
    try {
      converted = convertAmount(input.amount, input.rate);
    } catch (error) {
      rethrowSettlement(error);
    }
    const sourceId = randomUUID();
    const date = dayStart(input.date);
    return this.prisma.client.$transaction(async (tx: Db) => {
      const common = { tenantId, date, category: CashCategory.Conversion, rate: input.rate, sourceType: 'Conversion', sourceId, note: input.note ?? null };
      const out = await this.recordMovement(tx, {
        ...common,
        accountId: from.id,
        direction: CashDirection.Out,
        amount: input.amount,
        currency: from.currency,
      });
      const inbound = await this.recordMovement(tx, {
        ...common,
        accountId: to.id,
        direction: CashDirection.In,
        amount: converted,
        currency: to.currency,
      });
      await this.audit.record(tx, {
        action: 'CREATE',
        entity: 'CashMovement',
        entityId: sourceId,
        after: auditJson({ out, in: inbound }),
        metadata: { operation: 'conversion' },
      });
      return { out, in: inbound };
    });
  }

  // ─── Custodia ───────────────────────────────────────

  /**
   * Entrega al locador el efectivo que la inmobiliaria guarda en su custodia
   * (todo el saldo o una parte). La cuenta se bloquea hasta el commit, así que
   * dos entregas simultáneas no sacan más de lo que hay.
   */
  async deliverCustody(accountId: string, data: unknown) {
    const input = parseOrThrow(DeliverCustodySchema, data, 'Invalid custody delivery');
    const tenantId = this.tenantContext.getTenantId()!;
    return this.prisma.client.$transaction(async (tx: Db) => {
      await this.lockAccount(tx, tenantId, accountId);
      const account = await this.findAccount(tx, accountId);
      if (account.kind !== FinancialAccountKind.Custodia) {
        throw badRequest('ACCOUNT_NOT_CUSTODY', 'Only a custody account can be delivered to its owner');
      }
      const balance = (await this.balances(tx, [accountId])).get(accountId) ?? new Decimal(0);
      if (!balance.gt(0)) throw conflict('CUSTODY_EMPTY', 'The custody account has no balance to deliver');
      const amount = new Decimal(input.amount ?? balance);
      if (amount.gt(balance)) {
        throw conflict('CUSTODY_INSUFFICIENT', `Only ${balance.toFixed(2)} ${account.currency} are in custody`);
      }
      const movement = await this.recordMovement(tx, {
        tenantId,
        accountId,
        date: dayStart(input.date),
        direction: CashDirection.Out,
        amount,
        currency: account.currency,
        category: CashCategory.Custodia,
        counterpartyId: account.ownerPersonId,
        sourceType: 'CustodyDelivery',
        note: input.note ?? null,
      });
      await this.audit.record(tx, {
        action: 'CREATE',
        entity: 'CashMovement',
        entityId: movement.id,
        after: auditJson(movement),
        metadata: { operation: 'custody-deliver', balanceBefore: balance.toFixed(2) },
      });
      this.logger.log('Custody delivered', { accountId, amount: amount.toFixed(2) });
      return { movement, balance: balance.minus(amount).toFixed(2) };
    });
  }

  // ─── Uso desde otras transacciones ──────────────────

  /** Escribe un movimiento del libro en la transacción del que llama. */
  async recordMovement(tx: Db, input: MovementInput) {
    const amount = new Decimal(input.amount);
    if (!amount.gt(0)) throw badRequest('INVALID_AMOUNT', 'A cash movement amount must be positive');
    return tx.cashMovement.create({
      data: {
        tenantId: input.tenantId,
        accountId: input.accountId,
        date: input.date,
        direction: input.direction,
        amount: amount.toFixed(2),
        currency: input.currency,
        category: input.category,
        counterpartyId: input.counterpartyId ?? null,
        contractId: input.contractId ?? null,
        rate: input.rate ?? null,
        sourceType: input.sourceType ?? null,
        sourceId: input.sourceId ?? null,
        note: input.note ?? null,
        createdById: this.tenantContext.getUserId() ?? null,
      },
      include: { account: ACCOUNT_SELECT, counterparty: PERSON_SELECT },
    });
  }

  /**
   * Cuenta de la inmobiliaria donde entra un cobro: la indicada (activa, de la
   * misma moneda, no de custodia) o, sin ella, la caja (efectivo) o el banco de
   * la moneda, que se crea la primera vez que se usa.
   */
  async resolveAgencyAccount(
    tx: Db,
    tenantId: string,
    ctx: { accountId?: string | null; currency: string; method: string },
  ) {
    if (ctx.accountId) {
      const account = await this.findAccount(tx, ctx.accountId);
      this.assertOperational(account);
      if (account.currency !== ctx.currency) {
        throw badRequest('CURRENCY_MISMATCH', `The account is in ${account.currency}, the payment in ${ctx.currency}`);
      }
      return account;
    }
    const kind = ctx.method === PaymentMethod.Efectivo ? FinancialAccountKind.Caja : FinancialAccountKind.Banco;
    await this.lockKey(tx, `${tenantId}:${kind}:${ctx.currency}`);
    const existing = await tx.financialAccount.findFirst({
      where: { kind, currency: ctx.currency, ownerPersonId: null, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) return existing;
    return tx.financialAccount.create({
      data: { tenantId, kind, currency: ctx.currency, name: `${kind} ${ctx.currency}` },
    });
  }

  /** Cuenta de custodia de un locador en una moneda; se crea la primera vez. */
  async ensureCustodyAccount(tx: Db, tenantId: string, ownerPersonId: string, currency: string) {
    await this.lockKey(tx, `${tenantId}:Custodia:${ownerPersonId}:${currency}`);
    const existing = await tx.financialAccount.findFirst({
      where: { kind: FinancialAccountKind.Custodia, ownerPersonId, currency },
    });
    if (existing) {
      if (!existing.isActive) {
        return tx.financialAccount.update({ where: { id: existing.id }, data: { isActive: true } });
      }
      return existing;
    }
    const owner = await tx.person.findFirst({ where: { id: ownerPersonId }, select: { firstName: true, lastName: true } });
    return tx.financialAccount.create({
      data: {
        tenantId,
        kind: FinancialAccountKind.Custodia,
        currency,
        ownerPersonId,
        name: `Custodia ${owner ? personName(owner) : ownerPersonId} ${currency}`,
      },
    });
  }

  /** Saldo (entradas menos salidas) de cada cuenta. */
  async balances(db: Db, accountIds: string[]): Promise<Map<string, Decimal>> {
    const out = new Map<string, Decimal>();
    if (accountIds.length === 0) return out;
    const rows: any[] = await db.cashMovement.groupBy({
      by: ['accountId', 'direction'],
      where: { accountId: { in: accountIds } },
      _sum: { amount: true },
    });
    for (const row of rows) {
      const value = new Decimal(String(row._sum.amount ?? 0));
      const signed = row.direction === CashDirection.Out ? value.negated() : value;
      out.set(row.accountId, (out.get(row.accountId) ?? new Decimal(0)).plus(signed));
    }
    return out;
  }

  /** Bloquea la fila de la cuenta hasta el commit (SQL crudo: filtra por tenantId a mano, ADR-0006). */
  async lockAccount(tx: Db, tenantId: string, accountId: string) {
    const rows: { id: string }[] = await tx.$queryRaw(
      Prisma.sql`SELECT id FROM financial_accounts WHERE id = ${accountId} AND "tenantId" = ${tenantId} FOR UPDATE`,
    );
    if (rows.length === 0) throw notFound('ACCOUNT_NOT_FOUND', 'Account not found');
  }

  async findAccount(db: Db, id: string) {
    const account = await db.financialAccount.findFirst({ where: { id } });
    if (!account) throw notFound('ACCOUNT_NOT_FOUND', 'Account not found');
    return account;
  }

  /** Caja o banco activos: la custodia solo se mueve por cobros, entregas y compensaciones. */
  assertOperational(account: { kind: string; isActive: boolean }) {
    if (!account.isActive) throw conflict('ACCOUNT_INACTIVE', 'The account is inactive');
    if (account.kind === FinancialAccountKind.Custodia) {
      throw badRequest('CUSTODY_ACCOUNT_RESERVED', 'A custody account only moves through payments, deliveries and compensations');
    }
  }

  private async assertRefs(counterpartyId?: string | null, contractId?: string | null) {
    if (counterpartyId) {
      const person = await this.prisma.client.person.findFirst({ where: { id: counterpartyId }, select: { id: true } });
      if (!person) throw notFound('PERSON_NOT_FOUND', 'Counterparty not found');
    }
    if (contractId) {
      const contract = await this.prisma.client.contract.findFirst({ where: { id: contractId }, select: { id: true } });
      if (!contract) throw notFound('CONTRACT_NOT_FOUND', 'Contract not found');
    }
  }

  /** Serializa la creación de una cuenta por defecto (dos cobros simultáneos no crean dos cajas). */
  private async lockKey(tx: Db, key: string) {
    await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${key}))::text AS locked`);
  }
}
