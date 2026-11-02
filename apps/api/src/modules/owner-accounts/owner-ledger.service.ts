import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  CashCategory,
  CashDirection,
  FinancialAccountKind,
  OpeningBalanceSchema,
  OwnerLedgerEntryType,
  OwnerLedgerFilterSchema,
  OwnerPayoutSchema,
  OwnerStatementStatus,
  personName,
  propertyLabel,
  statementPeriodFor,
  todayInAR,
} from '@realfy/shared';
import Decimal from 'decimal.js';
import { randomUUID } from 'crypto';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { parseOrThrow } from '../../common/validation/zod';
import { OperationalDefaultsService } from '../tenants/operational-defaults.service';
import { CashService } from '../cash/cash.service';
import { auditJson, dayStart } from '../cash/cash.errors';
import { byLedgerOrder, postPayout, writeEntries } from './ledger-posting';

type Db = any;

const PERSON = { select: { id: true, firstName: true, lastName: true } } as const;
const ISSUED = [OwnerStatementStatus.Emitido, OwnerStatementStatus.Enviado];
/** Campos de la unidad con que se arma su nombre. */
export const PROPERTY_LABEL = { id: true, title: true, street: true, number: true, floor: true, apartment: true } as const;

const notFound = (error: string, message: string) => new NotFoundException({ error, message });

/** Tipo de origen del saldo inicial; el id del origen es la moneda (uno por locador y moneda). */
const OPENING_SOURCE = 'OpeningBalance';

/**
 * Cuenta corriente del locador (ADR-0009): movimientos con saldo corrido,
 * saldos por locador y moneda, saldo inicial y pagos al locador.
 */
@Injectable()
export class OwnerLedgerService {
  private readonly logger = new Logger(OwnerLedgerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
    private readonly operationalDefaults: OperationalDefaultsService,
    private readonly cash: CashService,
  ) {}

  /**
   * Movimientos de un locador en una moneda, del más viejo al más nuevo, con el
   * saldo después de cada uno; el saldo anterior a `from` abre la lista.
   */
  async ledger(personId: string, query: unknown) {
    const filters = parseOrThrow(OwnerLedgerFilterSchema, query, 'Invalid filter parameters');
    const person = await this.requirePerson(personId);
    const base = { personId, currency: filters.currency };
    const before = filters.from
      ? await this.prisma.client.ownerLedgerEntry.aggregate({
          where: { ...base, date: { lt: dayStart(filters.from) } },
          _sum: { amount: true },
        })
      : null;
    const opening = new Decimal(String(before?._sum.amount ?? 0));
    const rows: any[] = await this.prisma.client.ownerLedgerEntry.findMany({
      where: {
        ...base,
        ...(filters.from || filters.to
          ? {
              date: {
                ...(filters.from ? { gte: dayStart(filters.from) } : {}),
                ...(filters.to ? { lte: dayStart(filters.to) } : {}),
              },
            }
          : {}),
      },
      include: {
        property: { select: PROPERTY_LABEL },
        statement: { select: { id: true, period: true, status: true } },
      },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    rows.sort(byLedgerOrder);
    let running = opening;
    const all = rows.map((r) => {
      running = running.plus(String(r.amount));
      return {
        id: r.id,
        date: r.date,
        period: r.period,
        type: r.type,
        amount: new Decimal(String(r.amount)).toFixed(2),
        balance: running.toFixed(2),
        description: r.description,
        contractId: r.contractId,
        propertyId: r.propertyId,
        property: r.property ? propertyLabel(r.property) : null,
        sourceType: r.sourceType,
        sourceId: r.sourceId,
        statement: r.statement,
      };
    });
    const start = (filters.page - 1) * filters.limit;
    const currencies = await this.currenciesOf(personId);
    const custody = await this.custodyBalance(personId, filters.currency);
    return {
      person: { id: person.id, name: personName(person) },
      currency: filters.currency,
      currencies,
      opening: opening.toFixed(2),
      closing: running.toFixed(2),
      custody: custody.toFixed(2),
      items: all.slice(start, start + filters.limit),
      total: all.length,
      page: filters.page,
      limit: filters.limit,
      totalPages: Math.max(1, Math.ceil(all.length / filters.limit)),
    };
  }

  /**
   * Saldo de cada locador en cada moneda: lo que la inmobiliaria le debe
   * (positivo) o lo que él le debe (negativo), cuánto de eso guarda en
   * custodia y el último estado emitido. Lo que falta pagarle es el saldo
   * positivo; si hay custodia, esa parte ya está separada. Los locadores de
   * algún contrato que todavía no tienen movimientos aparecen con saldo cero en
   * pesos, para poder cargarles el saldo inicial.
   */
  async balances(query: { currency?: string }) {
    const where: Record<string, unknown> = query.currency ? { currency: query.currency } : {};
    const sums: any[] = await this.prisma.client.ownerLedgerEntry.groupBy({
      by: ['personId', 'currency'],
      where,
      _sum: { amount: true },
      _max: { date: true },
    });
    if (!query.currency || query.currency === 'ARS') {
      const lessors: any[] = await this.prisma.client.contractLessor.findMany({ select: { personId: true }, distinct: ['personId'] });
      const known = new Set(sums.map((s) => s.personId));
      for (const personId of new Set(lessors.map((l) => l.personId))) {
        if (!known.has(personId)) sums.push({ personId, currency: 'ARS', _sum: { amount: 0 }, _max: { date: null } });
      }
    }
    if (sums.length === 0) return { items: [] };
    const personIds = [...new Set(sums.map((s) => s.personId))];
    const [persons, custodies, statements] = await Promise.all([
      this.prisma.client.person.findMany({ where: { id: { in: personIds } }, ...PERSON }),
      this.prisma.client.financialAccount.findMany({
        where: { kind: FinancialAccountKind.Custodia, ownerPersonId: { in: personIds } },
        select: { id: true, ownerPersonId: true, currency: true },
      }),
      this.prisma.client.ownerStatement.findMany({
        where: { personId: { in: personIds }, status: { in: ISSUED } },
        select: { id: true, personId: true, currency: true, period: true, closing: true, status: true },
        orderBy: { period: 'desc' },
      }),
    ]);
    const custodyBalances = await this.cash.balances(this.prisma.client, custodies.map((c: any) => c.id));
    const byId = new Map(persons.map((p: any) => [p.id, p]));
    const items = sums
      .map((s) => {
        const custody = custodies.find((c: any) => c.ownerPersonId === s.personId && c.currency === s.currency);
        const last = statements.find((st: any) => st.personId === s.personId && st.currency === s.currency);
        const balance = new Decimal(String(s._sum.amount ?? 0));
        const custodyBalance = custody ? (custodyBalances.get(custody.id) ?? new Decimal(0)) : new Decimal(0);
        const due = Decimal.max(balance.minus(Decimal.max(custodyBalance, 0)), 0);
        return {
          personId: s.personId,
          name: personName(byId.get(s.personId) as any),
          currency: s.currency,
          balance: balance.toFixed(2),
          custody: custodyBalance.toFixed(2),
          /** Lo que falta pagarle fuera de la custodia. */
          payoutDue: due.toFixed(2),
          lastMovement: s._max.date,
          lastStatement: last ? { id: last.id, period: last.period, closing: new Decimal(String(last.closing)).toFixed(2), status: last.status } : null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'es') || a.currency.localeCompare(b.currency));
    return { items };
  }

  /**
   * Saldo inicial de un locador en una moneda (uno por moneda): se crea o se
   * corrige, con el motivo en la auditoría. No se corrige si ya está en un
   * estado emitido: hay que anularlo antes.
   */
  async setOpeningBalance(personId: string, data: unknown) {
    const input = parseOrThrow(OpeningBalanceSchema, data, 'Invalid opening balance');
    await this.requirePerson(personId);
    const tenantId = this.tenantContext.getTenantId()!;
    const { ownerAccounts } = await this.operationalDefaults.get(tenantId);
    const date = input.date ? dayStart(input.date) : todayInAR();
    return this.prisma.client.$transaction(async (tx: Db) => {
      const key = { sourceType: OPENING_SOURCE, sourceId: input.currency, personId, type: OwnerLedgerEntryType.SaldoInicial };
      const current = await tx.ownerLedgerEntry.findFirst({ where: key });
      if (current?.statementId) {
        throw new ConflictException({
          error: 'OPENING_BALANCE_LOCKED',
          message: 'The opening balance is part of an issued statement: annul it first',
        });
      }
      const description = 'Saldo inicial';
      let entry: any;
      if (current) {
        entry = await tx.ownerLedgerEntry.update({
          where: { id: current.id },
          data: {
            amount: new Decimal(input.amount).toFixed(2),
            date,
            period: statementPeriodFor(date, ownerAccounts.statementCloseDay),
          },
        });
      } else {
        await writeEntries(tx, { tenantId, closeDay: ownerAccounts.statementCloseDay, userId: this.tenantContext.getUserId() }, [
          { ...key, amount: input.amount, currency: input.currency, date, description },
        ]);
        entry = await tx.ownerLedgerEntry.findFirst({ where: key });
        if (!entry) {
          // Un saldo inicial de cero no deja asiento.
          entry = { personId, currency: input.currency, amount: '0.00', date, type: OwnerLedgerEntryType.SaldoInicial };
        }
      }
      await this.audit.record(tx, {
        action: current ? 'UPDATE' : 'CREATE',
        entity: 'OwnerLedgerEntry',
        entityId: entry.id ?? null,
        before: current ? auditJson(current) : undefined,
        after: auditJson(entry),
        metadata: { operation: 'owner-opening-balance', reason: input.reason, currency: input.currency },
      });
      this.logger.log('Opening balance set', { personId, currency: input.currency });
      return { ...entry, amount: new Decimal(String(entry.amount)).toFixed(2) };
    });
  }

  /**
   * Pago al locador desde una cuenta de la inmobiliaria (transferencia o
   * entrega de efectivo): un egreso `PagoLocador` en la cuenta y el asiento que
   * baja su saldo, en una transacción y con su fila de auditoría. Puede dejar
   * el saldo negativo (un adelanto).
   */
  async payout(personId: string, data: unknown) {
    const input = parseOrThrow(OwnerPayoutSchema, data, 'Invalid payout');
    const person = await this.requirePerson(personId);
    const tenantId = this.tenantContext.getTenantId()!;
    const { ownerAccounts } = await this.operationalDefaults.get(tenantId);
    const account = await this.cash.findAccount(this.prisma.client, input.accountId);
    this.cash.assertOperational(account);
    const date = dayStart(input.date);
    const entryId = randomUUID();
    return this.prisma.client.$transaction(async (tx: Db) => {
      await this.cash.lockAccount(tx, tenantId, account.id);
      const movement = await this.cash.recordMovement(tx, {
        tenantId,
        accountId: account.id,
        date,
        direction: CashDirection.Out,
        amount: input.amount,
        currency: account.currency,
        category: CashCategory.PagoLocador,
        counterpartyId: personId,
        sourceType: 'OwnerPayout',
        sourceId: entryId,
        note: input.note ?? null,
      });
      const label = input.method === OwnerLedgerEntryType.Transferencia ? 'Transferencia' : 'Entrega de efectivo';
      await postPayout(
        tx,
        { tenantId, closeDay: ownerAccounts.statementCloseDay, userId: this.tenantContext.getUserId() },
        {
          personId,
          type: input.method,
          amount: input.amount,
          currency: account.currency,
          date,
          movementId: movement.id,
          description: `${label} desde ${account.name}${input.note ? ` — ${input.note}` : ''}`,
        },
      );
      const entry = await tx.ownerLedgerEntry.findFirst({ where: { sourceType: 'CashMovement', sourceId: movement.id, personId } });
      await this.audit.record(tx, {
        action: 'CREATE',
        entity: 'OwnerLedgerEntry',
        entityId: entry?.id ?? null,
        after: auditJson({ movement, entry }),
        metadata: { operation: 'owner-payout', method: input.method },
      });
      const balance = await tx.ownerLedgerEntry.aggregate({ where: { personId, currency: account.currency }, _sum: { amount: true } });
      this.logger.log('Owner payout', { personId, amount: input.amount, currency: account.currency });
      return {
        movement,
        entry: entry ? { ...entry, amount: new Decimal(String(entry.amount)).toFixed(2) } : null,
        person: { id: person.id, name: personName(person) },
        balance: new Decimal(String(balance._sum.amount ?? 0)).toFixed(2),
      };
    });
  }

  private async requirePerson(personId: string) {
    const person = await this.prisma.client.person.findFirst({ where: { id: personId }, ...PERSON });
    if (!person) throw notFound('PERSON_NOT_FOUND', 'Lessor not found');
    return person;
  }

  private async currenciesOf(personId: string): Promise<string[]> {
    const rows: any[] = await this.prisma.client.ownerLedgerEntry.groupBy({ by: ['currency'], where: { personId } });
    return rows.map((r) => r.currency).sort((a: string, b: string) => a.localeCompare(b));
  }

  private async custodyBalance(personId: string, currency: string): Promise<Decimal> {
    const account = await this.prisma.client.financialAccount.findFirst({
      where: { kind: FinancialAccountKind.Custodia, ownerPersonId: personId, currency: currency as any },
      select: { id: true },
    });
    if (!account) return new Decimal(0);
    return (await this.cash.balances(this.prisma.client, [account.id])).get(account.id) ?? new Decimal(0);
  }
}
