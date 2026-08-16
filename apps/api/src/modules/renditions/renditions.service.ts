import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import {
  GenerateRendicionSchema,
  TransitionRendicionSchema,
  RendicionFilterSchema,
  CreateRendicionLineItemSchema,
  UpdateRendicionNotesSchema,
  RendicionStatus,
  LiquidacionStatus,
  PersonRole,
  CommissionType,
  validateRendicionTransition,
  getValidRendicionTransitions,
  buildRendicionFromPayments,
} from '@realfy/shared';
import type { CommissionConfig } from '@realfy/shared';
import { RenditionPdfService } from './rendition-pdf.service';
import { RenditionEmailService } from './rendition-email.service';
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
export class RenditionsService {
  private readonly logger = new Logger(RenditionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly pdfService: RenditionPdfService,
    private readonly emailService: RenditionEmailService,
  ) {}

  // ─── Rendition Generation ───────────────────────────

  async generate(data: unknown) {
    let validated: { contractId: string; month: number; year: number };
    try {
      validated = GenerateRendicionSchema.parse(data);
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

    const { contractId, month, year } = validated;
    const tenantId = this.tenantContext.getTenantId()!;
    const period = new Date(year, month - 1, 1);

    // 1. Verify contract exists and belongs to tenant
    const contract = await this.prisma.client.contract.findFirst({
      where: { id: contractId, tenantId },
      include: { property: true },
    });

    if (!contract) {
      throw new NotFoundException({
        error: 'CONTRACT_NOT_FOUND',
        message: 'Contract not found',
      });
    }

    // 2. Check idempotency — return existing if duplicate
    const existing = await this.prisma.client.ownerRendicion.findFirst({
      where: { contractId, period },
      include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
    });

    if (existing) {
      this.logger.log('Rendition already exists — returning existing', {
        tenantId,
        contractId,
        period: `${month}/${year}`,
        rendicionId: existing.id,
      });
      return existing;
    }

    // 3. Load commission config — required
    const commissionRecord =
      await this.prisma.client.contractCommission.findFirst({
        where: { contractId, tenantId },
      });

    if (!commissionRecord) {
      throw new BadRequestException({
        error: 'COMMISSION_NOT_CONFIGURED',
        message:
          'Commission configuration is required before generating a rendition. Configure it under the contract settings.',
        contractId,
      });
    }

    // 4. Find owner (Propietario) from contract persons
    const ownerRelation = await this.prisma.client.contractPerson.findFirst({
      where: {
        contractId,
        role: PersonRole.Propietario,
      },
      include: { person: true },
    });

    if (!ownerRelation) {
      throw new BadRequestException({
        error: 'NO_OWNER',
        message:
          'No Propietario found for this contract. Add a Propietario before generating a rendition.',
        contractId,
      });
    }

    // 5. Query all paid payments for liquidaciones of this contract in the period
    const payments = await this.prisma.client.payment.findMany({
      where: {
        liquidacion: {
          contractId,
          period,
          status: LiquidacionStatus.Pagada,
        },
      },
      include: {
        liquidacion: true,
      },
    });

    // 6. Build rendition via shared engine
    const commissionConfig: CommissionConfig = {
      type: commissionRecord.type as CommissionType,
      percentage: commissionRecord.percentage
        ? commissionRecord.percentage.toString()
        : null,
      fixedAmount: commissionRecord.fixedAmount
        ? commissionRecord.fixedAmount.toString()
        : null,
      adminFee: commissionRecord.adminFee
        ? commissionRecord.adminFee.toString()
        : null,
    };

    const paymentInputs = payments.map((p: any) => ({
      amount: p.amount.toString(),
      description: `Pago ${p.liquidacion?.period ? new Date(p.liquidacion.period).toLocaleDateString('es-AR', { month: '2-digit', year: 'numeric' }) : p.id}`,
    }));

    const result = buildRendicionFromPayments(
      paymentInputs,
      commissionConfig,
      [], // deductions can be added as line items later
    );

    // 7. Create rendition + line items in transaction
    const rendicion = await this.prisma.client.$transaction(async (tx: any) => {
      const created = await tx.ownerRendicion.create({
        data: {
          tenantId,
          contractId,
          ownerId: ownerRelation.personId,
          period,
          status: RendicionStatus.Borrador,
          rentCollected: result.rentCollected.toFixed(2),
          commissionAmount: result.commissionAmount.toFixed(2),
          adminFeeAmount: result.adminFeeAmount.toFixed(2),
          deductionTotal: result.deductionTotal.toFixed(2),
          netDeposit: result.netDeposit.toFixed(2),
          currency: commissionRecord.currency,
        },
      });

      // Create line items
      for (let i = 0; i < result.lineItems.length; i++) {
        const li = result.lineItems[i];
        await tx.rendicionLineItem.create({
          data: {
            tenantId,
            rendicionId: created.id,
            type: li.type,
            description: li.description,
            amount: li.amount.toFixed(2),
            isDebit: li.type !== 'Alquiler',
            currency: commissionRecord.currency,
            sortOrder: i,
          },
        });
      }

      return tx.ownerRendicion.findFirst({
        where: { id: created.id },
        include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
      });
    });

    this.logger.log('Rendition generated', {
      tenantId,
      contractId,
      period: `${month}/${year}`,
      rendicionId: rendicion!.id,
      rentCollected: result.rentCollected.toFixed(2),
      netDeposit: result.netDeposit.toFixed(2),
    });

    return rendicion;
  }

  // ─── Rendition CRUD ─────────────────────────────────

  async findAll(query: unknown) {
    let filters: any;
    try {
      filters = RendicionFilterSchema.parse(query);
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

    const tenantId = this.tenantContext.getTenantId()!;
    const where: any = { tenantId };

    if (filters.status) where.status = filters.status;
    if (filters.contractId) where.contractId = filters.contractId;
    if (filters.ownerId) where.ownerId = filters.ownerId;
    if (filters.month && filters.year) {
      where.period = new Date(filters.year, filters.month - 1, 1);
    } else if (filters.year) {
      where.period = {
        gte: new Date(filters.year, 0, 1),
        lt: new Date(filters.year + 1, 0, 1),
      };
    } else if (filters.month) {
      const currentYear = new Date().getFullYear();
      where.period = new Date(currentYear, filters.month - 1, 1);
    }

    const skip = (filters.page - 1) * filters.limit;

    const [items, total] = await Promise.all([
      this.prisma.client.ownerRendicion.findMany({
        where,
        include: {
          contract: { include: { property: true } },
          owner: true,
          lineItems: { orderBy: { sortOrder: 'asc' } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: filters.limit,
      }),
      this.prisma.client.ownerRendicion.count({ where }),
    ]);

    return {
      items,
      total,
      page: filters.page,
      limit: filters.limit,
      totalPages: Math.ceil(total / filters.limit),
    };
  }

  async findOne(id: string) {
    const tenantId = this.tenantContext.getTenantId()!;

    const rendicion = await this.prisma.client.ownerRendicion.findFirst({
      where: { id, tenantId },
      include: {
        lineItems: { orderBy: { sortOrder: 'asc' } },
        contract: {
          include: {
            property: true,
            persons: { include: { person: true } },
          },
        },
        owner: true,
      },
    });

    if (!rendicion) {
      throw new NotFoundException({
        error: 'RENDICION_NOT_FOUND',
        message: 'Rendición not found',
      });
    }

    return rendicion;
  }

  async updateNotes(id: string, data: unknown) {
    let validated: { notes: string };
    try {
      validated = UpdateRendicionNotesSchema.parse(data);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid notes data',
          details: err.errors,
        });
      }
      throw err;
    }

    const rendicion = await this.findOne(id);

    await this.prisma.client.ownerRendicion.update({
      where: { id: rendicion.id },
      data: { notes: validated.notes },
    });

    this.logger.log('Rendition notes updated', {
      rendicionId: id,
      tenantId: this.tenantContext.getTenantId(),
    });

    return this.findOne(id);
  }

  // ─── State Transitions ──────────────────────────────

  async transition(id: string, data: unknown) {
    let validated: { status: RendicionStatus };
    try {
      validated = TransitionRendicionSchema.parse(data);
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

    const rendicion = await this.findOne(id);
    const fromStatus = rendicion.status as RendicionStatus;
    const toStatus = validated.status;

    if (!validateRendicionTransition(fromStatus, toStatus)) {
      const validTargets = getValidRendicionTransitions(fromStatus);
      throw new BadRequestException({
        error: 'INVALID_TRANSITION',
        message: `Cannot transition from ${fromStatus} to ${toStatus}`,
        validTransitions: validTargets,
      });
    }

    const updateData: any = { status: toStatus };

    if (toStatus === RendicionStatus.Enviada) {
      updateData.sentAt = new Date();
    }
    if (toStatus === RendicionStatus.Depositada) {
      updateData.depositedAt = new Date();
    }

    await this.prisma.client.ownerRendicion.update({
      where: { id: rendicion.id },
      data: updateData,
    });

    this.logger.log('Rendition transitioned', {
      rendicionId: id,
      from: fromStatus,
      to: toStatus,
      userId: this.tenantContext.getUserId(),
    });

    return this.findOne(id);
  }

  // ─── Line Item Management ───────────────────────────

  async addLineItem(rendicionId: string, data: unknown) {
    let validated: any;
    try {
      validated = CreateRendicionLineItemSchema.parse(data);
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

    const rendicion = await this.ensureDraft(rendicionId);
    const tenantId = this.tenantContext.getTenantId()!;

    // Get max sort order
    const maxSort = await this.prisma.client.rendicionLineItem.findFirst({
      where: { rendicionId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });

    const lineItem = await this.prisma.client.rendicionLineItem.create({
      data: {
        tenantId,
        rendicionId,
        type: validated.type,
        description: validated.description,
        amount: validated.amount,
        isDebit: validated.isDebit ?? false,
        currency: validated.currency ?? rendicion.currency,
        sortOrder: (maxSort?.sortOrder ?? 0) + 1,
      },
    });

    await this.recalculateTotals(rendicionId);

    this.logger.log('Rendition line item added', {
      rendicionId,
      lineItemId: lineItem.id,
      type: validated.type,
      amount: validated.amount,
    });

    return this.findOne(rendicionId);
  }

  async removeLineItem(rendicionId: string, itemId: string) {
    await this.ensureDraft(rendicionId);

    const lineItem = await this.prisma.client.rendicionLineItem.findFirst({
      where: { id: itemId, rendicionId },
    });

    if (!lineItem) {
      throw new NotFoundException({
        error: 'LINE_ITEM_NOT_FOUND',
        message: 'Line item not found',
      });
    }

    await this.prisma.client.rendicionLineItem.delete({
      where: { id: itemId },
    });

    await this.recalculateTotals(rendicionId);

    this.logger.log('Rendition line item removed', {
      rendicionId,
      lineItemId: itemId,
    });

    return this.findOne(rendicionId);
  }

  // ─── PDF Generation ─────────────────────────────────

  async generatePdf(id: string): Promise<Buffer> {
    const rendicion = await this.findOne(id);
    const tenantId = this.tenantContext.getTenantId()!;

    const tenant = await this.prisma.client.tenant.findFirst({
      where: { id: tenantId },
    });

    const pdfBuffer = await this.pdfService.generateRenditionPdf(rendicion, {
      name: tenant?.name ?? 'Inmobiliaria',
      cuit: (tenant as any)?.cuit ?? null,
    });

    this.logger.log('Rendition PDF generated', {
      rendicionId: id,
      tenantId,
    });

    return pdfBuffer;
  }

  // ─── Email ──────────────────────────────────────────

  async sendEmail(id: string) {
    const rendicion = await this.findOne(id);
    const tenantId = this.tenantContext.getTenantId()!;

    const tenant = await this.prisma.client.tenant.findFirst({
      where: { id: tenantId },
    });

    const pdfBuffer = await this.pdfService.generateRenditionPdf(rendicion, {
      name: tenant?.name ?? 'Inmobiliaria',
      cuit: (tenant as any)?.cuit ?? null,
    });

    const ownerEmail = rendicion.owner?.email;
    if (!ownerEmail) {
      this.logger.warn('No owner email found — skipping email', {
        rendicionId: id,
        ownerId: rendicion.ownerId,
      });
      return { sent: false, reason: 'No owner email' };
    }

    try {
      const result = await this.emailService.sendRendicionEmail(
        ownerEmail,
        rendicion,
        pdfBuffer,
        tenant?.name ?? 'Inmobiliaria',
      );

      // Update sentAt
      await this.prisma.client.ownerRendicion.update({
        where: { id: rendicion.id },
        data: { sentAt: new Date() },
      });

      this.logger.log('Rendition email sent', {
        rendicionId: id,
        to: ownerEmail,
        resendId: result?.id ?? null,
      });

      return { sent: true, to: ownerEmail, resendId: result?.id };
    } catch (error) {
      this.logger.error('Rendition email delivery failed', {
        rendicionId: id,
        to: ownerEmail,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  // ─── Private Helpers ────────────────────────────────

  private async ensureDraft(rendicionId: string) {
    const rendicion = await this.findOne(rendicionId);
    const status = rendicion.status as RendicionStatus;

    if (status !== RendicionStatus.Borrador) {
      throw new BadRequestException({
        error: 'NOT_EDITABLE',
        message: `Line items can only be modified when status is Borrador (current: ${status})`,
      });
    }

    return rendicion;
  }

  private async recalculateTotals(rendicionId: string) {
    const lineItems = await this.prisma.client.rendicionLineItem.findMany({
      where: { rendicionId },
    });

    let rentCollected = new Decimal(0);
    let commissionAmount = new Decimal(0);
    let adminFeeAmount = new Decimal(0);
    let deductionTotal = new Decimal(0);

    for (const li of lineItems) {
      const amt = new Decimal(li.amount.toString());
      switch (li.type) {
        case 'Alquiler':
          rentCollected = rentCollected.plus(amt);
          break;
        case 'Comision':
          commissionAmount = commissionAmount.plus(amt);
          break;
        case 'AdminFee':
          adminFeeAmount = adminFeeAmount.plus(amt);
          break;
        case 'Deduccion':
        case 'Ajuste':
          deductionTotal = deductionTotal.plus(amt);
          break;
      }
    }

    const netDeposit = rentCollected
      .minus(commissionAmount)
      .minus(adminFeeAmount)
      .minus(deductionTotal)
      .toDecimalPlaces(2);

    await this.prisma.client.ownerRendicion.update({
      where: { id: rendicionId },
      data: {
        rentCollected: rentCollected.toFixed(2),
        commissionAmount: commissionAmount.toFixed(2),
        adminFeeAmount: adminFeeAmount.toFixed(2),
        deductionTotal: deductionTotal.toFixed(2),
        netDeposit: netDeposit.toFixed(2),
      },
    });
  }
}
