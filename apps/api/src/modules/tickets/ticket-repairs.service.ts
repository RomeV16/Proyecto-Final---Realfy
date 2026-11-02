import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  CashCategory,
  CashDirection,
  ChargeTarget,
  Currency,
  IMPUTATION_STATUSES,
  ImputeTicketSchema,
  LineBeneficiary,
  PROVIDER_PAYMENT_STATUSES,
  PendingChargeKind,
  RegisterProviderPaymentSchema,
  feeApplies,
  repairManagementFee,
  todayInAR,
  totalPaid,
} from '@realfy/shared';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { parseOrThrow } from '../../common/validation/zod';
import { CashService } from '../cash/cash.service';
import { ChargesService } from '../charges/charges.service';
import { OperationalDefaultsService } from '../tenants/operational-defaults.service';
import Decimal from 'decimal.js';

type Db = any;

const notFound = (error: string, message: string) => new NotFoundException({ error, message });
const conflict = (error: string, message: string) => new ConflictException({ error, message });
const badRequest = (error: string, message: string) => new BadRequestException({ error, message });

const dateOnly = (date: Date): string => date.toISOString().slice(0, 10);

/** Los pagos al proveedor de un ticket son los movimientos del libro con origen en él. */
const PAYMENT_WHERE = (ticketId: string) => ({
  sourceType: 'Ticket',
  sourceId: ticketId,
  category: CashCategory.PagoProveedor,
  direction: CashDirection.Out,
});

/**
 * Pago al proveedor e imputación de una incidencia. El pago sale de una cuenta de
 * la inmobiliaria (movimiento PagoProveedor del libro de caja); la imputación carga
 * lo pagado a quien lo soporta, una sola vez: el inquilino en su próxima
 * liquidación, el locador en su próximo estado, o la inmobiliaria como gasto propio.
 * El honorario por gestión de la reparación, si se cobra, es otro gasto puntual
 * (nunca comisión).
 */
@Injectable()
export class TicketRepairsService {
  private readonly logger = new Logger(TicketRepairsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
    private readonly operationalDefaults: OperationalDefaultsService,
    private readonly cash: CashService,
    private readonly charges: ChargesService,
  ) {}

  // ─── Pagos al proveedor ─────────────────────────────

  async listPayments(ticketId: string) {
    await this.findTicket(this.prisma.client, ticketId);
    const items = await this.prisma.client.cashMovement.findMany({
      where: PAYMENT_WHERE(ticketId),
      include: {
        account: { select: { id: true, name: true, kind: true, currency: true } },
        counterparty: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    const currency = items[0]?.currency ?? null;
    return { items, total: totalPaid(items.map((m: any) => m.amount.toString())), currency };
  }

  /**
   * Paga al proveedor desde una cuenta de la inmobiliaria (`assertOperational` descarta las de custodia, y de la
   * moneda del trabajo). Se puede pagar en partes (anticipo y saldo) mientras no se
   * pase de lo aprobado ni se haya imputado.
   */
  async registerPayment(ticketId: string, body: unknown) {
    const input = parseOrThrow(RegisterProviderPaymentSchema, body, 'Invalid provider payment');
    const tenantId = this.tenantContext.getTenantId()!;
    const ticket = await this.findTicket(this.prisma.client, ticketId);
    if (!PROVIDER_PAYMENT_STATUSES.includes(ticket.status)) {
      throw conflict('TICKET_NOT_PAYABLE', `A ticket in ${ticket.status} can not be paid yet`);
    }
    if (!ticket.providerId) throw conflict('TICKET_WITHOUT_PROVIDER', 'The ticket has no provider to pay');
    if (ticket.imputedAt) throw conflict('TICKET_ALREADY_IMPUTED', 'The ticket was already charged');

    return this.prisma.client.$transaction(async (tx: Db) => {
      // Toma el ticket (fila bloqueada hasta el final): serializa pagos e imputación.
      const locked = await tx.ticket.updateMany({
        where: { id: ticketId, imputedAt: null },
        data: { updatedAt: new Date() },
      });
      if (locked.count !== 1) throw conflict('TICKET_ALREADY_IMPUTED', 'The ticket was already charged');
      const account = await this.cash.findAccount(tx, input.accountId);
      this.cash.assertOperational(account);
      const currency = (ticket.costCurrency ?? account.currency) as Currency;
      if (account.currency !== currency) {
        throw badRequest('CURRENCY_MISMATCH', `The account is in ${account.currency}, the job in ${currency}`);
      }
      const paid = await this.paidSoFar(tx, ticketId);
      const after = paid.plus(input.amount);
      if (ticket.costAmount && after.gt(new Decimal(ticket.costAmount.toString()))) {
        throw conflict(
          'PAYMENT_EXCEEDS_APPROVED',
          `The payments (${after.toFixed(2)}) would exceed the approved amount (${ticket.costAmount.toString()})`,
        );
      }
      const movement = await this.cash.recordMovement(tx, {
        tenantId,
        accountId: account.id,
        date: input.date ? new Date(`${input.date}T00:00:00.000Z`) : todayInAR(),
        direction: CashDirection.Out,
        amount: input.amount,
        currency,
        category: CashCategory.PagoProveedor,
        counterpartyId: ticket.providerId,
        contractId: ticket.contractId ?? null,
        sourceType: 'Ticket',
        sourceId: ticketId,
        note: input.note ?? `Pago al proveedor: ${ticket.title}`,
      });
      if (!ticket.costCurrency) await tx.ticket.update({ where: { id: ticketId }, data: { costCurrency: currency } });
      await this.audit.record(tx, {
        action: 'CREATE',
        entity: 'CashMovement',
        entityId: movement.id,
        after: { amount: movement.amount?.toString(), category: movement.category, accountId: account.id },
        metadata: { operation: 'ticket-provider-payment', ticketId },
      });
      this.logger.log('Provider payment recorded', { ticketId, movementId: movement.id });
      return { movement, paid: after.toFixed(2) };
    });
  }

  // ─── Imputación ─────────────────────────────────────

  /**
   * Imputa lo pagado al proveedor a quien lo soporta, una sola vez. Crea el cargo
   * Reparación (sourceType 'Ticket') y, si se pide, el honorario por gestión como
   * otro cargo. Si paga la inmobiliaria, el cargo nace Imputado (el pago al proveedor
   * ya es su gasto en la caja) y no hay honorario.
   */
  async impute(ticketId: string, body: unknown) {
    const input = parseOrThrow(ImputeTicketSchema, body, 'Invalid imputation');
    const tenantId = this.tenantContext.getTenantId()!;
    const ticket = await this.findTicket(this.prisma.client, ticketId);
    if (ticket.imputedAt) throw conflict('TICKET_ALREADY_IMPUTED', 'The ticket was already charged');
    if (!IMPUTATION_STATUSES.includes(ticket.status)) {
      throw conflict('TICKET_NOT_IMPUTABLE', `A ticket in ${ticket.status} can not be charged yet`);
    }
    const payer = (input.chargedTo ?? ticket.costPayer) as ChargeTarget | null;
    if (!payer) throw badRequest('PAYER_REQUIRED', 'Say who pays: tenant, lessor or agency');
    const fee = input.managementFee ?? { mode: 'None' as const };
    if (fee.mode !== 'None' && !feeApplies(payer)) {
      throw badRequest('FEE_NOT_APPLICABLE', 'The agency does not charge a management fee to itself');
    }
    const defaults = await this.operationalDefaults.get(tenantId);
    const contract = await this.resolveContract(ticket);
    if (payer === ChargeTarget.Inquilino && !contract) {
      throw badRequest('CONTRACT_REQUIRED', 'A charge to the tenant needs the ticket to have a contract');
    }
    const lessorPersonId = payer === ChargeTarget.Locador && contract ? await this.soleLessor(contract.id) : null;
    // Honorario por gestión: el porcentaje del contrato (su comisión) y, sin él, el de la inmobiliaria.
    const contractFeePct = contract ? await this.contractFeePct(contract.id) : null;
    // Si paga el locador y el contrato pacta el honorario, lo asienta el estado del locador con ese
    // porcentaje al descontar la reparación; cargarlo acá lo duplicaría.
    const feeBySt = payer === ChargeTarget.Locador && contractFeePct !== null;
    if (feeBySt && fee.mode !== 'None' && !(fee.mode === 'Percent' && (fee.pct === undefined || fee.pct === null))) {
      throw badRequest('FEE_SET_BY_CONTRACT', `The contract sets the management fee (${contractFeePct} %); the lessor statement applies it`);
    }

    return this.prisma.client.$transaction(async (tx: Db) => {
      // Se reclama el ticket primero: una segunda imputación espera acá y ve imputedAt.
      const claimed = await tx.ticket.updateMany({
        where: { id: ticketId, imputedAt: null },
        data: { imputedAt: new Date(), costPayer: payer },
      });
      if (claimed.count !== 1) throw conflict('TICKET_ALREADY_IMPUTED', 'The ticket was already charged');

      const payments = await tx.cashMovement.findMany({
        where: PAYMENT_WHERE(ticketId),
        select: { amount: true, currency: true, date: true },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      });
      if (payments.length === 0) throw conflict('NO_PROVIDER_PAYMENTS', 'Register the payment to the provider before charging');
      const total = totalPaid(payments.map((p: any) => p.amount.toString()));
      const currency = payments[0].currency as Currency;
      const lastPayment = dateOnly(payments[payments.length - 1].date);
      const common = {
        propertyId: ticket.propertyId,
        contractId: contract?.id ?? null,
        chargedTo: payer,
        lessorPersonId,
        currency,
        incurredAt: lastPayment,
        targetPeriod: input.targetPeriod ?? null,
        installments: 1,
        sourceType: 'Ticket',
        sourceId: ticketId,
        notes: input.notes ?? null,
      };
      const settled = payer === ChargeTarget.Inmobiliaria;
      const [repair] = await this.charges.createIn(
        tx,
        {
          ...common,
          kind: PendingChargeKind.Reparacion,
          description: ticket.title,
          amount: total,
          // El dinero lo adelantó la inmobiliaria desde su caja: a ella vuelve.
          beneficiary: LineBeneficiary.Inmobiliaria,
        },
        { settled },
      );

      let feeCharge: any = null;
      const feeAmount = feeBySt
        ? null
        : repairManagementFee(total, {
            mode: fee.mode,
            pct: fee.pct ?? contractFeePct ?? defaults.repairs.managementFeePct,
            amount: fee.amount,
          });
      if (feeAmount) {
        [feeCharge] = await this.charges.createIn(tx, {
          ...common,
          kind: PendingChargeKind.HonorarioGestion,
          description: `Honorario por gestión: ${ticket.title}`,
          amount: feeAmount,
          beneficiary: LineBeneficiary.Inmobiliaria,
        });
      }

      const updated = await tx.ticket.findUnique({ where: { id: ticketId } });
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'Ticket',
        entityId: ticketId,
        before: { imputedAt: null, costPayer: ticket.costPayer },
        after: { imputedAt: updated.imputedAt, costPayer: updated.costPayer },
        metadata: {
          operation: 'ticket-impute',
          chargedTo: payer,
          total,
          chargeId: repair.id,
          feeChargeId: feeCharge?.id ?? null,
        },
      });
      this.logger.log('Ticket charged', { ticketId, chargedTo: payer, total });
      return { ticket: updated, charge: repair, feeCharge, feeAppliedByStatement: feeBySt ? contractFeePct : null, total, currency };
    });
  }

  // ─── Apoyo ──────────────────────────────────────────

  private async findTicket(db: Db, id: string) {
    const ticket = await db.ticket.findUnique({ where: { id } });
    if (!ticket) throw notFound('TICKET_NOT_FOUND', `Ticket ${id} not found`);
    return ticket;
  }

  private async paidSoFar(tx: Db, ticketId: string): Promise<Decimal> {
    const rows = await tx.cashMovement.findMany({ where: PAYMENT_WHERE(ticketId), select: { amount: true } });
    return rows.reduce((acc: Decimal, r: any) => acc.plus(r.amount.toString()), new Decimal(0));
  }

  /** Porcentaje del honorario por gestión de reparaciones pactado en el contrato; null si no lo pacta. */
  private async contractFeePct(contractId: string): Promise<number | null> {
    const commission: any = await this.prisma.client.contractCommission.findFirst({ where: { contractId } });
    const pct = commission?.repairMgmtFeePct;
    return pct === null || pct === undefined ? null : Number(pct.toString());
  }

  /** El contrato del ticket o, sin él, el único vigente de la propiedad. */
  private async resolveContract(ticket: any): Promise<{ id: string } | null> {
    if (ticket.contractId) return { id: ticket.contractId };
    const active = await this.prisma.client.contract.findMany({
      where: { propertyId: ticket.propertyId, status: 'Activo' },
      select: { id: true },
      orderBy: [{ startDate: 'desc' }, { id: 'asc' }],
      take: 2,
    });
    return active.length === 1 ? active[0] : null;
  }

  /** El locador de un cargo a su nombre: solo si el contrato tiene uno vigente; con varios, el estado reparte. */
  private async soleLessor(contractId: string): Promise<string | null> {
    const today = todayInAR();
    const lessors = await this.prisma.client.contractLessor.findMany({
      where: { contractId, validFrom: { lte: today }, OR: [{ validTo: null }, { validTo: { gt: today } }] },
      select: { personId: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 2,
    });
    return lessors.length === 1 ? lessors[0].personId : null;
  }
}
