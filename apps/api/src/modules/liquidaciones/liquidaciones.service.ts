import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
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
  getValidLiquidacionTransitions,
  calculateLineItemsTotal,
  calculateRemainingBalance,
  isFullyPaid,
} from '@realfy/shared';
import type { LineItemInput, PaymentInput } from '@realfy/shared';
import { PdfService } from './pdf.service';
import { EmailService } from './email.service';
import Decimal from 'decimal.js';

/**
 * Checks if an error is a Zod validation error (K006 pattern — no direct zod import).
 */
function isZodError(err: unknown): err is { errors: any[] } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as any).name === 'ZodError' &&
    'errors' in err
  );
}

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
    let validated: { month: number; year: number };
    try {
      validated = GenerateLiquidacionesSchema.parse(data);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid generation parameters',
          details: err.errors,
        });
      }
      throw err;
    }

    const { month, year } = validated;
    const tenantId = this.tenantContext.getTenantId()!;

    // Period is the first day of the month
    const period = new Date(year, month - 1, 1);
    // Due date is the 10th of the month
    const dueDate = new Date(year, month - 1, 10);

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
    let filters: any;
    try {
      filters = LiquidacionFilterSchema.parse(query);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid filter parameters',
          details: err.errors,
        });
      }
      throw err;
    }

    const where: any = {};
    if (filters.status) where.status = filters.status;
    if (filters.contractId) where.contractId = filters.contractId;
    if (filters.month || filters.year) {
      // Filter by period month/year
      if (filters.month && filters.year) {
        where.period = new Date(filters.year, filters.month - 1, 1);
      } else if (filters.year) {
        where.period = {
          gte: new Date(filters.year, 0, 1),
          lt: new Date(filters.year + 1, 0, 1),
        };
      } else if (filters.month) {
        // Month without year — current year
        const currentYear = new Date().getFullYear();
        where.period = new Date(currentYear, filters.month - 1, 1);
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
    let validated: any;
    try {
      validated = CreateLiquidacionLineItemSchema.parse(data);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid line item data',
          details: err.errors,
        });
      }
      throw err;
    }

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
    let validated: any;
    try {
      validated = UpdateLiquidacionLineItemSchema.parse(data);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid line item data',
          details: err.errors,
        });
      }
      throw err;
    }

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
    let validated: any;
    try {
      validated = TransitionLiquidacionSchema.parse(data);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid transition data',
          details: err.errors,
        });
      }
      throw err;
    }

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

    if (!validateLiquidacionTransition(fromStatus, toStatus)) {
      const validTargets = getValidLiquidacionTransitions(fromStatus);
      throw new BadRequestException({
        error: 'INVALID_TRANSITION',
        message: `Cannot transition from ${fromStatus} to ${toStatus}`,
        validTransitions: validTargets,
      });
    }

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
    let validated: any;
    try {
      validated = CreatePaymentSchema.parse(data);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid payment data',
          details: err.errors,
        });
      }
      throw err;
    }

    const liquidacion = await this.prisma.client.liquidacion.findFirst({
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
    if (
      status !== LiquidacionStatus.Enviada &&
      status !== LiquidacionStatus.Vencida
    ) {
      throw new BadRequestException({
        error: 'INVALID_STATUS_FOR_PAYMENT',
        message: `Cannot register payment when status is ${status}. Must be Enviada or Vencida.`,
      });
    }

    const tenantId = this.tenantContext.getTenantId()!;

    const payment = await this.prisma.client.payment.create({
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
    const allPayments: PaymentInput[] = [
      ...liquidacion.payments.map((p: any) => ({ amount: p.amount.toString() })),
      { amount: validated.amount },
    ];

    const fullyPaid = isFullyPaid(liquidacion.total.toString(), allPayments);
    const remaining = calculateRemainingBalance(
      liquidacion.total.toString(),
      allPayments,
    );

    if (fullyPaid) {
      // Auto-transition to Pagada.
      await this.prisma.client.liquidacion.update({
        where: { id: liquidacionId },
        data: {
          status: LiquidacionStatus.Pagada,
          paidAt: new Date(),
        },
      });

      this.logger.log('Liquidación auto-transitioned to Pagada', {
        liquidacionId,
        paymentId: payment.id,
        totalPaid: new Decimal(liquidacion.total.toString())
          .minus(remaining)
          .toFixed(2),
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
      { property: liquidacion.contract?.property ? { address: (liquidacion.contract.property as any).address, name: (liquidacion.contract.property as any).name } : null },
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

    const result = calculateLineItemsTotal(inputs);

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
        { property: liquidacion.contract?.property ? { address: (liquidacion.contract.property as any).address, name: (liquidacion.contract.property as any).name } : null },
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
      const inquilino = liquidacion.contract?.persons?.find(
        (p: any) => p.role === 'Inquilino',
      );
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
