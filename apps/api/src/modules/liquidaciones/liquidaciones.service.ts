import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getParty } from '../contracts/contract-parties';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import {
  GenerateLiquidacionesSchema,
  CreateLiquidacionLineItemSchema,
  UpdateLiquidacionLineItemSchema,
  TransitionLiquidacionSchema,
  CreatePaymentSchema,
  LiquidacionFilterSchema,
  LiquidacionStatus,
  LineItemType,
  ContractStatus,
  validateLiquidacionTransition,
  liquidacionMachine,
  calculateLineItemsTotal,
  calculateRemainingBalance,
  isFullyPaid,
  monthStartUTC,
  periodFilter,
  todayInAR,
  InvalidLineAmountError,
} from '@realfy/shared';
import type { LineItemInput, PaymentInput } from '@realfy/shared';
import { PdfService } from './pdf.service';
import { EmailService } from './email.service';
import Decimal from 'decimal.js';
import { assertTransition } from '../../common/errors/assert-transition';
import { parseOrThrow } from '../../common/validation/zod';

@Injectable()
export class LiquidacionesService {
  private readonly logger = new Logger(LiquidacionesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly pdfService: PdfService,
    private readonly emailService: EmailService,
  ) {}

  // ─── Auto-Generation ────────────────────────────────

  async generate(data: unknown) {
    const validated: { month: number; year: number } = parseOrThrow(GenerateLiquidacionesSchema, data, 'Invalid generation parameters');

    const { month, year } = validated;
    const tenantId = this.tenantContext.getTenantId()!;

    // Period is the first day of the month
    const period = monthStartUTC(year, month);
    // Due date is the 10th of the month
    const dueDate = new Date(Date.UTC(year, month - 1, 10));

    // Query active contracts (status Activo, isActive true)
    const contracts = await this.prisma.client.contract.findMany({
      where: {
        status: ContractStatus.Activo,
        isActive: true,
      },
      include: {
        property: true,
      },
    });

    let created = 0;
    let skipped = 0;

    for (const contract of contracts) {
      // Check if liquidación already exists for this contract+period
      const existing = await this.prisma.client.liquidacion.findFirst({
        where: {
          contractId: contract.id,
          period,
        },
      });

      if (existing) {
        skipped++;
        continue;
      }

      const rentAmount = new Decimal(contract.rentAmount.toString());
      const total = rentAmount;

      await this.prisma.client.liquidacion.create({
        data: {
          tenantId,
          contractId: contract.id,
          period,
          dueDate,
          status: LiquidacionStatus.Borrador,
          subtotal: rentAmount.toFixed(2),
          total: total.toFixed(2),
          currency: contract.rentCurrency,
          lineItems: {
            create: [
              {
                tenantId,
                type: LineItemType.Alquiler,
                description: `Alquiler ${month.toString().padStart(2, '0')}/${year}`,
                amount: rentAmount.toFixed(2),
                currency: contract.rentCurrency,
                sortOrder: 0,
              },
            ],
          },
        },
      });

      created++;
    }

    this.logger.log('Liquidaciones generated', {
      tenantId,
      month,
      year,
      contractsFound: contracts.length,
      created,
      skipped,
    });

    return { created, skipped, total: contracts.length };
  }

  // ─── List ───────────────────────────────────────────

  async findAll(query: unknown) {
    const filters: any = parseOrThrow(LiquidacionFilterSchema, query, 'Invalid filter parameters');

    const where: any = {};
    if (filters.status) where.status = filters.status;
    if (filters.contractId) where.contractId = filters.contractId;
    if (filters.month || filters.year) {
      // Filter by period month/year
      if (filters.month && filters.year) {
        where.period = monthStartUTC(filters.year, filters.month);
      } else if (filters.year) {
        where.period = periodFilter(filters.year);
      } else if (filters.month) {
        // Month without year — current year
        const currentYear = todayInAR().getUTCFullYear();
        where.period = monthStartUTC(currentYear, filters.month);
      }
    }

    const skip = (filters.page - 1) * filters.limit;

    const [items, total] = await Promise.all([
      this.prisma.client.liquidacion.findMany({
        where,
        include: {
          contract: {
            include: { property: true },
          },
          lineItems: { orderBy: { sortOrder: 'asc' } },
          _count: { select: { payments: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: filters.limit,
      }),
      this.prisma.client.liquidacion.count({ where }),
    ]);

    return {
      items,
      total,
      page: filters.page,
      limit: filters.limit,
      totalPages: Math.ceil(total / filters.limit),
    };
  }

  // ─── Detail ─────────────────────────────────────────

  async findOne(id: string) {
    const liquidacion = await this.prisma.client.liquidacion.findFirst({
      where: { id },
      include: {
        lineItems: { orderBy: { sortOrder: 'asc' } },
        payments: { orderBy: { paidAt: 'asc' } },
        contract: {
          include: {
            property: true,
            persons: { include: { person: true } },
          },
        },
      },
    });

    if (!liquidacion) {
      throw new NotFoundException({
        error: 'LIQUIDACION_NOT_FOUND',
        message: 'Liquidación not found',
      });
    }

    return liquidacion;
  }

  // ─── Line Item CRUD ─────────────────────────────────

  async addLineItem(liquidacionId: string, data: unknown) {
    const validated: any = parseOrThrow(CreateLiquidacionLineItemSchema, data, 'Invalid line item data');

    const liquidacion = await this.ensureEditable(liquidacionId);
    const tenantId = this.tenantContext.getTenantId()!;

    // Get max sort order
    const maxSort = await this.prisma.client.liquidacionLineItem.findFirst({
      where: { liquidacionId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });

    const lineItem = await this.prisma.client.liquidacionLineItem.create({
      data: {
        tenantId,
        liquidacionId,
        type: validated.type,
        description: validated.description,
        amount: validated.amount,
        currency: validated.currency ?? liquidacion.currency,
        sortOrder: (maxSort?.sortOrder ?? 0) + 1,
      },
    });

    await this.recalculateTotals(liquidacionId);

    this.logger.log('Line item added', {
      liquidacionId,
      lineItemId: lineItem.id,
      type: validated.type,
      amount: validated.amount,
    });

    return this.findOne(liquidacionId);
  }

  async updateLineItem(lineItemId: string, data: unknown) {
    const validated: any = parseOrThrow(UpdateLiquidacionLineItemSchema, data, 'Invalid line item data');

    const lineItem = await this.prisma.client.liquidacionLineItem.findFirst({
      where: { id: lineItemId },
    });

    if (!lineItem) {
      throw new NotFoundException({
        error: 'LINE_ITEM_NOT_FOUND',
        message: 'Line item not found',
      });
    }

    await this.ensureEditable(lineItem.liquidacionId);

    await this.prisma.client.liquidacionLineItem.update({
      where: { id: lineItemId },
      data: validated,
    });

    await this.recalculateTotals(lineItem.liquidacionId);

    this.logger.log('Line item updated', {
      lineItemId,
      liquidacionId: lineItem.liquidacionId,
      fieldsUpdated: Object.keys(validated),
    });

    return this.findOne(lineItem.liquidacionId);
  }

  async removeLineItem(lineItemId: string) {
    const lineItem = await this.prisma.client.liquidacionLineItem.findFirst({
      where: { id: lineItemId },
    });

    if (!lineItem) {
      throw new NotFoundException({
        error: 'LINE_ITEM_NOT_FOUND',
        message: 'Line item not found',
      });
    }

    await this.ensureEditable(lineItem.liquidacionId);

    await this.prisma.client.liquidacionLineItem.delete({
      where: { id: lineItemId },
    });

    await this.recalculateTotals(lineItem.liquidacionId);

    this.logger.log('Line item removed', {
      lineItemId,
      liquidacionId: lineItem.liquidacionId,
    });

    return this.findOne(lineItem.liquidacionId);
  }

  // ─── State Transitions ──────────────────────────────

  async transition(id: string, data: unknown) {
    const validated: any = parseOrThrow(TransitionLiquidacionSchema, data, 'Invalid transition data');

    const liquidacion = await this.prisma.client.liquidacion.findFirst({
      where: { id },
      include: {
        contract: {
          include: {
            property: true,
            persons: { include: { person: true } },
          },
        },
        lineItems: { orderBy: { sortOrder: 'asc' } },
        payments: true,
      },
    });

    if (!liquidacion) {
      throw new NotFoundException({
        error: 'LIQUIDACION_NOT_FOUND',
        message: 'Liquidación not found',
      });
    }

    const fromStatus = liquidacion.status as LiquidacionStatus;
    const toStatus = validated.status as LiquidacionStatus;

    assertTransition(liquidacionMachine, fromStatus, toStatus);

    const updateData: any = { status: toStatus };

    // On transition to Enviada: trigger PDF + email
    if (toStatus === LiquidacionStatus.Enviada) {
      updateData.sentAt = new Date();
    }

    await this.prisma.client.liquidacion.update({
      where: { id },
      data: updateData,
    });

    this.logger.log('Liquidación transitioned', {
      liquidacionId: id,
      fromStatus,
      toStatus,
      userId: this.tenantContext.getUserId(),
    });

    // On transition to Enviada: generate PDF and send email
    if (toStatus === LiquidacionStatus.Enviada) {
      await this.sendPdfEmail(liquidacion);
    }

    return this.findOne(id);
  }

  // ─── Payments ───────────────────────────────────────

  async registerPayment(liquidacionId: string, data: unknown) {
    const validated: any = parseOrThrow(CreatePaymentSchema, data, 'Invalid payment data');
    const tenantId = this.tenantContext.getTenantId()!;

    // Validar el saldo, crear el pago y pasar a Pagada es una sola unidad: la
    // fila de la liquidación se bloquea (SELECT ... FOR UPDATE) hasta el commit,
    // así que dos pagos simultáneos se serializan y el segundo ve el saldo que
    // dejó el primero. El SQL crudo no pasa por la extensión de inmobiliaria,
    // por eso filtra por tenantId a mano (ADR-0006).
    const { payment, remaining, fullyPaid, totalPaid } = await this.prisma.client.$transaction(
      async (tx: any) => {
        const locked: { id: string }[] = await tx.$queryRaw(
          Prisma.sql`SELECT id FROM liquidaciones WHERE id = ${liquidacionId} AND "tenantId" = ${tenantId} FOR UPDATE`,
        );
        if (locked.length === 0) {
          throw new NotFoundException({
            error: 'LIQUIDACION_NOT_FOUND',
            message: 'Liquidación not found',
          });
        }

        const liquidacion = await tx.liquidacion.findFirst({
          where: { id: liquidacionId },
          include: { payments: true },
        });

        if (!liquidacion) {
          throw new NotFoundException({
            error: 'LIQUIDACION_NOT_FOUND',
            message: 'Liquidación not found',
          });
        }

        // Payments are only allowed when status is Enviada or Vencida
        const status = liquidacion.status as LiquidacionStatus;
        if (status !== LiquidacionStatus.Enviada && status !== LiquidacionStatus.Vencida) {
          throw new BadRequestException({
            error: 'INVALID_STATUS_FOR_PAYMENT',
            message: `Cannot register payment when status is ${status}. Must be Enviada or Vencida.`,
          });
        }

        // Un pago no puede superar lo que falta saldar: el excedente no tiene a qué
        // imputarse y dejaría la liquidación con saldo negativo.
        const priorPayments: PaymentInput[] = liquidacion.payments.map((p: any) => ({
          amount: p.amount.toString(),
        }));
        const balanceBefore = calculateRemainingBalance(liquidacion.total.toString(), priorPayments);
        if (new Decimal(validated.amount).gt(balanceBefore)) {
          throw new BadRequestException({
            error: 'PAYMENT_EXCEEDS_BALANCE',
            message: `Payment amount exceeds the remaining balance of ${balanceBefore.toFixed(2)}`,
            remainingBalance: balanceBefore.toFixed(2),
          });
        }

        const created = await tx.payment.create({
          data: {
            tenantId,
            liquidacionId,
            amount: validated.amount,
            method: validated.method,
            reference: validated.reference ?? null,
            notes: validated.notes ?? null,
            paidAt: new Date(validated.paidAt),
            currency: liquidacion.currency,
          },
        });

        // Check if fully paid using shared engine
        const allPayments: PaymentInput[] = [...priorPayments, { amount: validated.amount }];
        const isPaid = isFullyPaid(liquidacion.total.toString(), allPayments);
        const left = calculateRemainingBalance(liquidacion.total.toString(), allPayments);

        if (isPaid) {
          // Auto-transition to Pagada. La fecha de saldado es la del último pago que
          // la completó, no el momento en que se cargó en el sistema: una cobranza
          // del día 5 registrada el día 20 se saldó el 5, y de esa fecha dependen la
          // puntualidad, el puntaje del inquilino y el resumen de cierre.
          const settledOn = [
            ...liquidacion.payments.map((p: { paidAt: Date }) => p.paidAt),
            created.paidAt,
          ].reduce((latest, date) => (date > latest ? date : latest));

          await tx.liquidacion.update({
            where: { id: liquidacionId },
            data: {
              status: LiquidacionStatus.Pagada,
              paidAt: settledOn,
            },
          });
        }

        return {
          payment: created,
          remaining: left,
          fullyPaid: isPaid,
          totalPaid: new Decimal(liquidacion.total.toString()).minus(left).toFixed(2),
        };
      },
    );

    if (fullyPaid) {
      this.logger.log('Liquidación auto-transitioned to Pagada', {
        liquidacionId,
        paymentId: payment.id,
        totalPaid,
      });
    }

    this.logger.log('Payment registered', {
      liquidacionId,
      paymentId: payment.id,
      amount: validated.amount,
      method: validated.method,
      remainingBalance: remaining.toFixed(2),
      fullyPaid,
    });

    return this.findOne(liquidacionId);
  }

  async findPayments(liquidacionId: string) {
    const liquidacion = await this.prisma.client.liquidacion.findFirst({
      where: { id: liquidacionId },
    });

    if (!liquidacion) {
      throw new NotFoundException({
        error: 'LIQUIDACION_NOT_FOUND',
        message: 'Liquidación not found',
      });
    }

    return this.prisma.client.payment.findMany({
      where: { liquidacionId },
      orderBy: { paidAt: 'asc' },
    });
  }

  // ─── PDF Generation ─────────────────────────────────

  async generatePdf(id: string): Promise<Buffer> {
    const liquidacion = await this.prisma.client.liquidacion.findFirst({
      where: { id },
      include: {
        lineItems: { orderBy: { sortOrder: 'asc' } },
        payments: { orderBy: { paidAt: 'asc' } },
        contract: { include: { property: true } },
      },
    });

    if (!liquidacion) {
      throw new NotFoundException({
        error: 'LIQUIDACION_NOT_FOUND',
        message: 'Liquidación not found',
      });
    }

    const tenantId = this.tenantContext.getTenantId()!;
    const tenant = await this.prisma.client.tenant.findFirst({
      where: { id: tenantId },
    });

    return this.pdfService.generateReceipt(
      {
        id: liquidacion.id,
        period: liquidacion.period,
        subtotal: liquidacion.subtotal.toString(),
        total: liquidacion.total.toString(),
        currency: liquidacion.currency,
        dueDate: liquidacion.dueDate,
      },
      {
        name: tenant?.name ?? 'Inmobiliaria',
        cuit: (tenant as any)?.cuit ?? null,
        logoUrl: (tenant as any)?.logoUrl ?? null,
      },
      { property: liquidacion.contract?.property ?? null },
      liquidacion.lineItems.map((li: any) => ({
        type: li.type,
        description: li.description,
        amount: li.amount.toString(),
      })),
      liquidacion.payments.map((p: any) => ({
        method: p.method,
        amount: p.amount.toString(),
        paidAt: p.paidAt,
        reference: p.reference,
      })),
    );
  }

  // ─── Bulk Operations ────────────────────────────────

  async bulkApprove(ids: string[]) {
    if (!ids || ids.length === 0) {
      throw new BadRequestException({
        error: 'VALIDATION_ERROR',
        message: 'ids array is required and must not be empty',
      });
    }

    return this.processBulkApprove(ids);
  }

  async bulkSend(ids: string[]) {
    if (!ids || ids.length === 0) {
      throw new BadRequestException({
        error: 'VALIDATION_ERROR',
        message: 'ids array is required and must not be empty',
      });
    }

    return this.processBulkSend(ids);
  }

  // ─── Delete / Annul ─────────────────────────────────

  async remove(id: string) {
    const liquidacion = await this.prisma.client.liquidacion.findFirst({
      where: { id },
    });

    if (!liquidacion) {
      throw new NotFoundException({
        error: 'LIQUIDACION_NOT_FOUND',
        message: 'Liquidación not found',
      });
    }

    const status = liquidacion.status as LiquidacionStatus;

    // If in Borrador or Revision, hard delete; otherwise annul
    if (
      status === LiquidacionStatus.Borrador ||
      status === LiquidacionStatus.Revision
    ) {
      await this.prisma.client.liquidacion.delete({
        where: { id },
      });
      this.logger.log('Liquidación deleted', { liquidacionId: id, status });
      return { deleted: true, id };
    }

    // For other states, transition to Anulada
    if (!validateLiquidacionTransition(status, LiquidacionStatus.Anulada)) {
      throw new BadRequestException({
        error: 'CANNOT_ANNUL',
        message: `Cannot annul liquidación in status ${status}`,
      });
    }

    await this.prisma.client.liquidacion.update({
      where: { id },
      data: { status: LiquidacionStatus.Anulada },
    });

    this.logger.log('Liquidación annulled', {
      liquidacionId: id,
      fromStatus: status,
    });

    return this.findOne(id);
  }

  // ─── Private Helpers ────────────────────────────────

  private async ensureEditable(liquidacionId: string) {
    const liquidacion = await this.prisma.client.liquidacion.findFirst({
      where: { id: liquidacionId },
    });

    if (!liquidacion) {
      throw new NotFoundException({
        error: 'LIQUIDACION_NOT_FOUND',
        message: 'Liquidación not found',
      });
    }

    const status = liquidacion.status as LiquidacionStatus;
    if (
      status !== LiquidacionStatus.Borrador &&
      status !== LiquidacionStatus.Revision
    ) {
      throw new BadRequestException({
        error: 'NOT_EDITABLE',
        message: `Line items can only be modified when status is Borrador or Revision (current: ${status})`,
      });
    }

    return liquidacion;
  }

  private async recalculateTotals(liquidacionId: string) {
    const lineItems = await this.prisma.client.liquidacionLineItem.findMany({
      where: { liquidacionId },
    });

    const inputs: LineItemInput[] = lineItems.map((li: any) => ({
      type: li.type as LineItemType,
      amount: li.amount.toString(),
    }));

    let result: ReturnType<typeof calculateLineItemsTotal>;
    try {
      result = calculateLineItemsTotal(inputs);
    } catch (err) {
      if (err instanceof InvalidLineAmountError) {
        throw new BadRequestException({
          error: err.code,
          message: err.message,
        });
      }
      throw err;
    }

    await this.prisma.client.liquidacion.update({
      where: { id: liquidacionId },
      data: {
        subtotal: result.subtotal.toFixed(2),
        total: result.total.toFixed(2),
      },
    });
  }

  private async sendPdfEmail(liquidacion: any) {
    try {
      const tenantId = this.tenantContext.getTenantId()!;
      const tenant = await this.prisma.client.tenant.findFirst({
        where: { id: tenantId },
      });

      const pdfBuffer = await this.pdfService.generateReceipt(
        {
          id: liquidacion.id,
          period: liquidacion.period,
          subtotal: liquidacion.subtotal.toString(),
          total: liquidacion.total.toString(),
          currency: liquidacion.currency,
          dueDate: liquidacion.dueDate,
        },
        {
          name: tenant?.name ?? 'Inmobiliaria',
          cuit: (tenant as any)?.cuit ?? null,
          logoUrl: (tenant as any)?.logoUrl ?? null,
        },
        { property: liquidacion.contract?.property ?? null },
        (liquidacion.lineItems ?? []).map((li: any) => ({
          type: li.type,
          description: li.description,
          amount: li.amount.toString(),
        })),
        (liquidacion.payments ?? []).map((p: any) => ({
          method: p.method,
          amount: p.amount.toString(),
          paidAt: p.paidAt,
          reference: p.reference,
        })),
      );

      // Find tenant (inquilino) email from contract persons
      const inquilino = liquidacion.contract
        ? getParty<any>(liquidacion.contract, 'Inquilino')
        : undefined;
      const email = inquilino?.person?.email;

      if (email) {
        await this.emailService.sendLiquidacionEmail(
          email,
          {
            id: liquidacion.id,
            period: liquidacion.period,
            total: liquidacion.total.toString(),
          },
          pdfBuffer,
          tenant?.name ?? 'Inmobiliaria',
        );
      } else {
        this.logger.warn('No inquilino email found — skipping email', {
          liquidacionId: liquidacion.id,
          contractId: liquidacion.contractId,
        });
      }
    } catch (error) {
      // Don't fail the transition if email/PDF fails
      this.logger.error('Failed to send PDF email', {
        liquidacionId: liquidacion.id,
        error: (error as Error).message,
      });
    }
  }

  private async processBulkApprove(ids: string[]) {
    let processed = 0;
    let failed = 0;

    for (const id of ids) {
      try {
        await this.transition(id, { status: LiquidacionStatus.Aprobada });
        processed++;
      } catch (error) {
        failed++;
        this.logger.error('Bulk approve failed for item', {
          liquidacionId: id,
          error: (error as Error).message,
        });
      }
    }

    this.logger.log('Bulk approve completed', { processed, failed, total: ids.length });
    return { processed, failed, total: ids.length };
  }

  private async processBulkSend(ids: string[]) {
    let processed = 0;
    let failed = 0;

    for (const id of ids) {
      try {
        await this.transition(id, { status: LiquidacionStatus.Enviada });
        processed++;
      } catch (error) {
        failed++;
        this.logger.error('Bulk send failed for item', {
          liquidacionId: id,
          error: (error as Error).message,
        });
      }
    }

    this.logger.log('Bulk send completed', { processed, failed, total: ids.length });
    return { processed, failed, total: ids.length };
  }
}
